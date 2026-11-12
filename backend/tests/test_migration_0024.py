"""Migration 0024 (07 Q63): no per-BDE capacity. `firms.bde_capacity` and its 1-50 check go; the downgrade puts the
column back at the default (10)."""
from sqlalchemy import inspect, text

from backend.tests.test_migration_0002 import _alembic, _ok, scratch_db  # noqa: F401


def _firm_columns(engine) -> set[str]:
    return {column["name"] for column in inspect(engine).get_columns("firms")}


def test_the_capacity_column_and_its_check_go_and_come_back_on_downgrade(scratch_db):
    name, engine = scratch_db
    _ok(_alembic(name, "upgrade", "0023"))
    assert "bde_capacity" in _firm_columns(engine)
    _ok(_alembic(name, "upgrade", "0024"))
    assert "bde_capacity" not in _firm_columns(engine)
    with engine.connect() as conn:
        left = conn.execute(text("SELECT count(*) FROM pg_constraint WHERE conname = 'ck_firms_bde_capacity_range'")).scalar()
    assert left == 0
    _ok(_alembic(name, "downgrade", "0023"))
    assert "bde_capacity" in _firm_columns(engine)
    _ok(_alembic(name, "upgrade", "0024"))
