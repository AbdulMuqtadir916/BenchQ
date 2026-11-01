"""PR 2 migration: OAuth storage and retained account identity, one linear revision."""
import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.tests.auth_support import seed_accounts
from backend.tests.isolation_support import make_world
from backend.tests.test_migration_0002 import _alembic, _ok, scratch_db  # noqa: F401


def populated(scratch_db):
    name, engine = scratch_db
    _ok(_alembic(name, 'upgrade', 'head'))
    with Session(engine) as db:
        world = make_world(db, seed_accounts(db))
        db.commit()
    return world.a.ids['candidate']


def test_namespace_backfill_and_roundtrip_preserve_emails_and_application_history(scratch_db):
    name, engine = scratch_db
    populated(scratch_db)
    _ok(_alembic(name, 'downgrade', '0009'))
    with engine.connect() as conn:
        before = conn.execute(text('SELECT id, body, provider_message_id FROM inbox_messages ORDER BY id')).all()
        reviews = conn.execute(text('SELECT count(*) FROM application_reviews')).scalar_one()
    for _ in range(2):
        _ok(_alembic(name, 'upgrade', 'head'))
        with engine.connect() as conn:
            assert conn.execute(text('SELECT id, body, provider_message_id FROM inbox_messages ORDER BY id')).all() == before
            assert conn.execute(text('SELECT count(*) FROM inbox_messages m JOIN candidate_mailboxes b ON b.id=m.mailbox_id WHERE m.source_address <> lower(trim(b.address))')).scalar_one() == 0
            assert conn.execute(text('SELECT count(*) FROM application_reviews')).scalar_one() == reviews
        _ok(_alembic(name, 'downgrade', '0009'))


@pytest.mark.parametrize('protected', ['credential', 'retained-account', 'active-oauth'])
def test_downgrade_refuses_to_discard_credentials_or_account_provenance(scratch_db, protected):
    name, engine = scratch_db
    candidate_id = populated(scratch_db)
    if protected == 'active-oauth':
        from datetime import timedelta
        from backend.models.candidates import Candidate, CandidateGoogleOAuthAttempt
        from backend.models.db import utcnow
        with Session(engine) as db:
            candidate = db.get(Candidate, candidate_id)
            db.add(CandidateGoogleOAuthAttempt(firm_id=candidate.firm_id, candidate_id=candidate.id,
                initiated_by_user_id=candidate.created_by_user_id, state_hash='synthetic-state-hash',
                code_verifier_ciphertext=b'synthetic-verifier', return_to='/', expires_at=utcnow()+timedelta(minutes=5)))
            db.commit()
    with engine.begin() as conn:
        if protected == 'credential':
            conn.execute(text('UPDATE candidate_mailboxes SET refresh_token_ciphertext=:value'), {'value': b'synthetic-ciphertext'})
        elif protected == 'retained-account':
            conn.execute(text("UPDATE inbox_messages SET source_address='older-account@example.test'"))
    result = _alembic(name, 'downgrade', '0009')
    assert result.returncode != 0
    expected = {'credential':'Disconnect candidate mailboxes', 'retained-account':'preserve retained mailbox account provenance', 'active-oauth':'active OAuth attempts'}
    assert expected[protected] in result.stderr
    with engine.connect() as conn:
        assert conn.execute(text('SELECT version_num FROM alembic_version')).scalar_one() == '0010'
        assert conn.execute(text('SELECT count(*) FROM inbox_messages')).scalar_one() > 0
