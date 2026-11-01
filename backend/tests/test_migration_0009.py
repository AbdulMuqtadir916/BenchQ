"""Upgrade/rollback safety for the Applications foundation revision, on scratch test databases."""
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
    _ok(_alembic(name, "upgrade", "0008"))
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
        _ok(_alembic(name, "downgrade", "0008"))
        with engine.connect() as conn:
            row = conn.execute(text("SELECT status, status_transitions FROM applications WHERE id=:id"),
                               {"id": application_id}).one()
            assert tuple(row) == ("interview_scheduled", history)
        assert "base_resumes" in inspect(engine).get_table_names()
        assert "base_resume_id" in {column["name"] for column in inspect(engine).get_columns("resumes")}
        assert not {"application_reviews", "application_status_events", "candidate_google_oauth_attempts",
                    "email_classifications"}.intersection(inspect(engine).get_table_names())



def test_tracking_downgrade_refuses_to_discard_pending_reviews(scratch_db):
    name, engine = scratch_db
    _ok(_alembic(name, "upgrade", "head"))
    with Session(engine) as db:
        make_world(db, seed_accounts(db))
        db.commit()
    with engine.connect() as conn:
        count = conn.execute(text("SELECT count(*) FROM application_reviews")).scalar_one()
        starting_revision = conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
    assert count > 0
    result = _alembic(name, "downgrade", "0008")
    assert result.returncode != 0
    assert "preserve application review history" in result.stderr
    with engine.connect() as conn:
        assert conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == starting_revision
        assert conn.execute(text("SELECT count(*) FROM application_reviews")).scalar_one() == count
