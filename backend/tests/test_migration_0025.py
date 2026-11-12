"""Migration 0025 (07 Q64-Q66): a price per BDE on plans and firms, and the billing periods table. A firm copies its
plan's price; existing firms get no period; the database refuses an amount that isn't count times price."""
import pytest
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError

from backend.tests.test_migration_0002 import _alembic, _ok, scratch_db  # noqa: F401


def _columns(engine, table) -> set[str]:
    return {column["name"] for column in inspect(engine).get_columns(table)}


def test_upgrade_adds_prices_and_periods_and_downgrade_removes_them(scratch_db):
    name, engine = scratch_db
    _ok(_alembic(name, "upgrade", "0024"))
    assert "price_cents_per_seat" not in _columns(engine, "plans")
    assert "firm_billing_periods" not in inspect(engine).get_table_names()
    _ok(_alembic(name, "upgrade", "0025"))
    assert "price_cents_per_seat" in _columns(engine, "plans") and "price_cents_per_seat" in _columns(engine, "firms")
    assert "firm_billing_periods" in inspect(engine).get_table_names()
    _ok(_alembic(name, "downgrade", "0024"))
    assert "price_cents_per_seat" not in _columns(engine, "firms")
    assert "firm_billing_periods" not in inspect(engine).get_table_names()
    _ok(_alembic(name, "upgrade", "0025"))


def test_existing_firms_copy_their_plans_price_and_start_with_no_period(scratch_db):
    name, engine = scratch_db
    _ok(_alembic(name, "upgrade", "0024"))
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO plans (id, name, seat_limit, candidate_limit) "
                          "VALUES ('00000000-0000-4000-8000-0000000000a1', 'Old', 4, 40)"))
        conn.execute(text("INSERT INTO firms (id, name, slug, plan_id, seat_limit, candidate_limit) "
                          "VALUES ('00000000-0000-4000-8000-0000000000b1', 'Old Co', 'oldco', "
                          "'00000000-0000-4000-8000-0000000000a1', 4, 40)"))
    _ok(_alembic(name, "upgrade", "0025"))
    with engine.connect() as conn:
        assert conn.execute(text("SELECT price_cents_per_seat FROM firms WHERE slug = 'oldco'")).scalar() == 3500
        assert conn.execute(text("SELECT count(*) FROM firm_billing_periods")).scalar() == 0


@pytest.mark.parametrize("values", [
    "10, 100, 100, 3500, 1, 'UNPAID', NULL",                       # amount is not count x price
    "10, 100, 100, 3500, 35000, 'PAID', NULL",                     # paid without a paid date
    "10, 100, 100, 3500, 35000, 'UNPAID', '2026-11-12'",           # a paid date without paying
])
def test_the_database_refuses_inconsistent_periods(scratch_db, values):
    name, engine = scratch_db
    _ok(_alembic(name, "upgrade", "0025"))
    with engine.connect() as conn:
        firm = conn.execute(text("SELECT id FROM firms LIMIT 1")).scalar()
        assert firm is not None
        with pytest.raises(IntegrityError):
            conn.execute(text(
                "INSERT INTO firm_billing_periods (firm_id, starts_on, ends_on, seat_limit, candidate_limit, "
                "jobs_per_candidate_per_day, price_cents_per_seat, amount_cents, status, paid_on) "
                f"VALUES (:f, '2026-11-12', '2026-12-12', {values})"), {"f": firm})
