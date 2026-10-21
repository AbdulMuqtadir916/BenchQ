"""Revision 0004 deletes the shared dashboard API key setting: cookie sessions replaced it (07 Q37, Q38), and a
stored key is a secret that opened every firm's data."""
import uuid

from sqlalchemy import text

from backend.tests.test_migration_0002 import _alembic, _ok, scratch_db  # noqa: F401


def _keys(engine):
    with engine.connect() as conn:
        return {row[0] for row in conn.execute(text("SELECT key FROM settings"))}


def test_upgrade_deletes_the_key_and_nothing_else(scratch_db):  # noqa: F811
    name, engine = scratch_db
    _ok(_alembic(name, "upgrade", "0003"))
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO settings (key, value) VALUES ('dashboard_api_key', :v), ('proxy_url', '')"),
                     {"v": uuid.uuid4().hex})
    _ok(_alembic(name, "upgrade", "0004"))
    assert _keys(engine) == {"proxy_url"}


def test_downgrade_runs(scratch_db):  # noqa: F811
    name, engine = scratch_db
    _ok(_alembic(name, "upgrade", "0004"))
    _ok(_alembic(name, "downgrade", "0003"))
