"""Classification upgrade/downgrade does not rewrite historical application states."""
from sqlalchemy import text
from backend.db_schema import head_revision
from backend.tests.test_migration_0002 import _alembic, _ok, scratch_db


def test_empty_classification_revision_roundtrip(scratch_db):
    name,engine=scratch_db
    _ok(_alembic(name,'upgrade','head'))
    _ok(_alembic(name,'downgrade','0013'))
    _ok(_alembic(name,'upgrade','head'))
    with engine.connect() as conn:
        assert conn.execute(text('SELECT version_num FROM alembic_version')).scalar_one()==head_revision()


def test_downgrade_refuses_live_classification_claim(scratch_db):
    from backend.tests.test_migration_0012 import populated
    name,engine=scratch_db
    populated(scratch_db)
    with engine.begin() as conn:
        conn.execute(text("UPDATE inbox_messages SET classification_state='PROCESSING', classification_attempts=1"))
    result=_alembic(name,'downgrade','0013')
    assert result.returncode!=0
    assert 'Refusing to discard email classification' in result.stderr
    with engine.connect() as conn:
        assert conn.execute(text('SELECT version_num FROM alembic_version')).scalar_one()==head_revision()
        assert conn.execute(text("SELECT count(*) FROM inbox_messages WHERE classification_state='PROCESSING'")).scalar_one()>0
