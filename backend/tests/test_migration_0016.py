"""Migration 0016: `firms.truth_guard_mode` and its CHECK go (no claim states, 2026-11-05); and the way back."""
from sqlalchemy import inspect, text

from backend.tests.test_migration_0002 import _alembic, _ok, scratch_db  # noqa: F401

CHECK = "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'ck_firms_truth_guard_mode'"
DEFAULT = ("SELECT column_default FROM information_schema.columns "
           "WHERE table_name = 'firms' AND column_name = 'truth_guard_mode'")


def _columns(engine) -> set[str]:
    return {c["name"] for c in inspect(engine).get_columns("firms")}


def test_the_column_and_its_check_go_and_come_back_on_balanced(scratch_db):
    name, engine = scratch_db
    _ok(_alembic(name, "upgrade", "0015"))
    assert "truth_guard_mode" in _columns(engine)

    _ok(_alembic(name, "upgrade", "0016"))
    assert "truth_guard_mode" not in _columns(engine)
    with engine.connect() as conn:
        assert conn.execute(text(CHECK)).scalar() is None

    _ok(_alembic(name, "downgrade", "0015"))
    assert "truth_guard_mode" in _columns(engine)
    with engine.connect() as conn:
        assert "BALANCED" in conn.execute(text(DEFAULT)).scalar_one()
        check = conn.execute(text(CHECK)).scalar_one()
    assert all(mode in check for mode in ("STRICT", "BALANCED", "LENIENT"))

    _ok(_alembic(name, "upgrade", "0016"))
