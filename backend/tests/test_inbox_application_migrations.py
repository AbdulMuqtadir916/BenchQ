"""Upgrade/rollback safety for the Inbox/Application revisions, on scratch test databases."""
import json
import uuid

import pytest
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from backend.models.tenancy import DEFAULT_FIRM_ID
from backend.tests.auth_support import seed_accounts
from backend.tests.isolation_support import make_world
from backend.tests.test_migration_0002 import _alembic, _ok, scratch_db  # noqa: F401


def test_tracking_upgrade_and_rollback_preserve_legacy_status_and_history(scratch_db):
    name, engine = scratch_db
    _ok(_alembic(name, "upgrade", "0007"))
    job_id, application_id = uuid.uuid4(), uuid.uuid4()
    history = [
        {"from": "applied", "to": "screening", "at": "2026-10-28T10:00:00Z", "source": "legacy",
         "custom_field": "keep original payload"},
        "malformed legacy entry retained",
        {"from": "screening", "to": "interview_scheduled", "at": "2026-10-29T10:00:00Z", "source": "ui",
         "actor_user_id": str(uuid.uuid4())},
    ]
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO jobs (id, external_id, title, company, source) "
                          "VALUES (:id, 'migration-review-test', 'Engineer', 'Synthetic Corp', 'manual')"),
                     {"id": job_id})
        conn.execute(text("INSERT INTO applications (id, firm_id, job_id, status, status_transitions) "
                          "VALUES (:id, :firm, :job, 'interview_scheduled', CAST(:history AS json))"),
                     {"id": application_id, "firm": DEFAULT_FIRM_ID, "job": job_id, "history": json.dumps(history)})

    for _ in range(2):
        _ok(_alembic(name, "upgrade", "head"))
        with engine.connect() as conn:
            app = conn.execute(text("SELECT status, status_transitions, status_revision, last_manual_change_at "
                                    "FROM applications WHERE id=:id"), {"id": application_id}).mappings().one()
            assert app["status"] == "interview_scheduled"
            assert app["status_transitions"] == history
            assert app["status_revision"] == 2
            assert app["last_manual_change_at"].isoformat() == "2026-10-29T10:00:00+00:00"
            events = conn.execute(text("SELECT original_payload, actor_user_id FROM application_status_events "
                                       "WHERE application_id=:id ORDER BY revision"), {"id": application_id}).all()
            assert [row.original_payload for row in events] == [history[0], history[2]]
            assert all(row.actor_user_id is None for row in events)
        _ok(_alembic(name, "downgrade", "0007"))
        with engine.connect() as conn:
            row = conn.execute(text("SELECT status, status_transitions FROM applications WHERE id=:id"),
                               {"id": application_id}).one()
            assert tuple(row) == ("interview_scheduled", history)
        assert not {"application_reviews", "application_status_events", "candidate_google_oauth_attempts",
                    "email_classifications"}.intersection(inspect(engine).get_table_names())


@pytest.mark.parametrize(("revision", "target", "message"), [
    ("0010", "0009", "preserve classifier decisions"),
    ("0009", "0008", "Disconnect candidate mailboxes"),
    ("0008", "0007", "preserve application review history"),
])
def test_downgrade_refuses_to_discard_decisions_reviews_or_live_credentials(scratch_db, revision, target, message):
    name, engine = scratch_db
    _ok(_alembic(name, "upgrade", "head"))
    with Session(engine) as db:
        world = make_world(db, seed_accounts(db))
        candidate_id = world.a.ids["candidate"]
        db.commit()
    if revision != "0010":
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM email_classifications"))
    _ok(_alembic(name, "downgrade", revision))
    if revision == "0009":
        with engine.begin() as conn:
            conn.execute(text("UPDATE candidate_mailboxes SET refresh_token_ciphertext=:token WHERE candidate_id=:id"),
                         {"id": candidate_id, "token": b"synthetic-encrypted-test-token"})

    tables = ["applications", "application_reviews", "inbox_messages", "candidate_mailboxes"]
    if revision == "0010":
        tables.append("email_classifications")
    with engine.connect() as conn:
        before = {table: conn.execute(text(f"SELECT count(*) FROM {table}")).scalar_one() for table in tables}
    result = _alembic(name, "downgrade", target)
    assert result.returncode != 0
    assert message in result.stderr
    with engine.connect() as conn:
        assert conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == revision
        assert {table: conn.execute(text(f"SELECT count(*) FROM {table}")).scalar_one() for table in tables} == before
        if revision == "0009":
            assert bytes(conn.execute(text("SELECT refresh_token_ciphertext FROM candidate_mailboxes "
                                           "WHERE candidate_id=:id"), {"id": candidate_id}).scalar_one()) == \
                b"synthetic-encrypted-test-token"


def test_account_namespace_backfill_and_safe_roundtrip(scratch_db):
    name, engine = scratch_db
    _ok(_alembic(name, 'upgrade', 'head'))
    with Session(engine) as db:
        world = make_world(db, seed_accounts(db))
        db.commit()
    _ok(_alembic(name, 'downgrade', '0010'))
    with engine.connect() as conn:
        before = conn.execute(text('SELECT id, provider_message_id, thread_id, body FROM inbox_messages ORDER BY id')).all()
    _ok(_alembic(name, 'upgrade', 'head'))
    with engine.connect() as conn:
        assert conn.execute(text('SELECT id, provider_message_id, thread_id, body FROM inbox_messages ORDER BY id')).all() == before
        assert conn.execute(text("SELECT count(*) FROM inbox_messages m JOIN candidate_mailboxes b ON b.id=m.mailbox_id "
                                 "WHERE m.source_address <> lower(trim(b.address))")).scalar_one() == 0
    _ok(_alembic(name, 'downgrade', '0010'))
    _ok(_alembic(name, 'upgrade', 'head'))


def test_account_namespace_downgrade_preserves_retained_other_account(scratch_db):
    name, engine = scratch_db
    _ok(_alembic(name, 'upgrade', 'head'))
    with Session(engine) as db:
        make_world(db, seed_accounts(db))
        db.commit()
    with engine.begin() as conn:
        conn.execute(text("UPDATE inbox_messages SET source_address='retained-other@example.test'"))
    result = _alembic(name, 'downgrade', '0010')
    assert result.returncode != 0
    assert 'preserve retained mailbox account provenance' in result.stderr
    with engine.connect() as conn:
        assert conn.execute(text('SELECT version_num FROM alembic_version')).scalar_one() == '0011'
        assert conn.execute(text("SELECT count(*) FROM inbox_messages WHERE source_address='retained-other@example.test'")).scalar_one() > 0
