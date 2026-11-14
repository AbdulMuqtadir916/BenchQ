"""0025 (renumbered from 0016, 0022, 0026; follows main's 0024) adds the AUTO_APPLIED outcome; downgrade refuses to discard automatic status evidence.

The Activity logs migrations (0028 and later) sit on top of it, so "the newest migration" is `head_revision()`, not 0025."""
from sqlalchemy import text
from backend.db_schema import head_revision
from backend.tests.test_migration_0002 import _alembic, _ok, scratch_db  # noqa: F401 (fixture)


def _insert_result(engine, outcome):
    with engine.begin() as conn:
        message = conn.execute(text('SELECT id, firm_id, candidate_id FROM inbox_messages LIMIT 1')).one()
        conn.execute(text(
            "INSERT INTO email_classifications (id, firm_id, candidate_id, inbox_message_id, result_version, content_revision,"
            " category, confidence, probabilities, model, provider, prompt_version, category_version, sender_auth_result,"
            " receive_time_verified, outcome, reason) VALUES (gen_random_uuid(), :f, :c, :m, 1, 0, 'assessment', 0.9,"
            " '{}', 'synthetic', 'openrouter', 'p', 'c', 'PASS', true, :o, 'AUTO_STATUS_DISABLED')"),
            {'f': message.firm_id, 'c': message.candidate_id, 'm': message.id, 'o': outcome})


def test_auto_applied_is_allowed_and_the_revision_roundtrips(scratch_db):
    name, engine = scratch_db
    _ok(_alembic(name, 'upgrade', 'head'))
    _ok(_alembic(name, 'downgrade', '0024'))
    _ok(_alembic(name, 'upgrade', 'head'))
    with engine.connect() as conn:
        assert conn.execute(text('SELECT version_num FROM alembic_version')).scalar_one() == head_revision()


def test_downgrade_refuses_while_automatic_evidence_exists(scratch_db):
    from backend.tests.test_migration_0012 import populated
    name, engine = scratch_db
    populated(scratch_db)
    _insert_result(engine, 'AUTO_APPLIED')
    from backend.tests.migration_support import down_to_0026
    down_to_0026(name, engine)  # #129's 0027 and its local move go first
    result = _alembic(name, 'downgrade', '0024')
    assert result.returncode != 0 and 'Refusing to discard automatic status evidence' in result.stderr
    with engine.connect() as conn:       # the refused downgrade leaves the database where it was (one transaction)
        assert conn.execute(text('SELECT version_num FROM alembic_version')).scalar_one() == '0026'
