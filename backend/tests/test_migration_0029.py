"""Migration 0029 (decided 2026-11-16, Q76, Q82): LinkedIn's pace in Postgres: 4 slots, filled, and who waits."""
from sqlalchemy import inspect, text

from backend.tests.test_migration_0002 import _alembic, _ok, scratch_db  # noqa: F401


def test_0029_adds_the_four_slots_and_the_waiting_table(scratch_db):
    name, engine = scratch_db
    _ok(_alembic(name, "upgrade", "0029"))
    tables = set(inspect(engine).get_table_names())
    assert {"linkedin_slots", "linkedin_waiting"} <= tables
    with engine.connect() as conn:
        assert conn.execute(text("SELECT array_agg(slot ORDER BY slot) FROM linkedin_slots")).scalar() == [0, 1, 2, 3]


def test_0029_downgrades_cleanly(scratch_db):
    name, engine = scratch_db
    _ok(_alembic(name, "upgrade", "0029"))
    _ok(_alembic(name, "downgrade", "0028"))
    assert not {"linkedin_slots", "linkedin_waiting"} & set(inspect(engine).get_table_names())
    _ok(_alembic(name, "upgrade", "0029"))
