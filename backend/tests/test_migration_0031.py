"""Migration 0031 (decided 2026-11-17, Q152–Q174): firm work hours, required, every existing firm 18:30–04:00; a
candidate with a BDE gets their creation time as the assignment and its Day 1; each search its work date. Made-up
rows only."""
import uuid

from sqlalchemy import text

from backend.tests.test_migration_0002 import _alembic, _ok, scratch_db  # noqa: F401


def _seed(engine, created_at: str, with_bde: bool) -> dict:
    """One firm, its owner, one candidate (with or without a BDE) and one search, at 0030."""
    from backend.models.candidates import WORK_AUTHS
    ids = {k: uuid.uuid4() for k in ("plan", "firm", "owner", "candidate", "batch")}
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO plans (id, name, seat_limit, candidate_limit) VALUES (:plan, 'Plan', 5, 5)"), ids)
        conn.execute(text("INSERT INTO firms (id, name, slug, plan_id, seat_limit, candidate_limit) "
                          "VALUES (:firm, 'Acme', 'acme', :plan, 5, 5)"), ids)
        conn.execute(text("INSERT INTO users (id, firm_id, role, name, email, password_hash) "
                          "VALUES (:owner, :firm, 'OWNER', 'Owner', 'owner@acme.test', 'x')"), ids)
        conn.execute(text("INSERT INTO candidates (id, firm_id, manager_id, bde_id, created_by_user_id, work_auth, "
                          "employment_types, created_at) VALUES (:candidate, :firm, :owner, :bde, :owner, :auth, "
                          "'{W2}', :at)"),
                     {**ids, "bde": ids["owner"] if with_bde else None, "auth": WORK_AUTHS[0], "at": created_at})
        conn.execute(text("INSERT INTO scrape_jobs (firm_id, candidate_id, batch_id, state, user_id, created_at, "
                          "finished_at) VALUES (:firm, :candidate, :batch, 'success', :owner, :at, :at)"),
                     {**ids, "at": created_at})
    return ids


def test_0031_fills_the_hours_the_assignment_and_each_searchs_work_date(scratch_db):
    name, engine = scratch_db
    _ok(_alembic(name, "upgrade", "0030"))
    ids = _seed(engine, "2026-11-12 07:30:00+00", with_bde=True)    # 1 PM IST: between shifts
    _ok(_alembic(name, "upgrade", "0031"))
    with engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM firms WHERE work_start <> '18:30' OR work_end <> '04:00'")
                            ).scalar() == 0                         # every firm (Q163)
        assigned, day_one = conn.execute(text("SELECT bde_assigned_at, bde_day_one::text FROM candidates "
                                              "WHERE id = :candidate"), ids).one()
        assert assigned is not None and day_one == "2026-11-12"     # the next shift (Q164)
        assert conn.execute(text("SELECT work_date::text FROM scrape_jobs WHERE batch_id = :batch"), ids
                            ).scalar() == "2026-11-11"              # Q161


def test_0031_leaves_a_candidate_without_a_bde_without_days_and_downgrades(scratch_db):
    name, engine = scratch_db
    _ok(_alembic(name, "upgrade", "0030"))
    ids = _seed(engine, "2026-11-12 14:00:00+00", with_bde=False)   # 7:30 PM IST: inside the hours
    _ok(_alembic(name, "upgrade", "0031"))
    with engine.connect() as conn:
        assert conn.execute(text("SELECT bde_assigned_at, bde_day_one FROM candidates WHERE id = :candidate"), ids
                            ).one() == (None, None)
        assert conn.execute(text("SELECT work_date::text FROM scrape_jobs WHERE batch_id = :batch"), ids
                            ).scalar() == "2026-11-12"
    _ok(_alembic(name, "downgrade", "0030"))
    _ok(_alembic(name, "upgrade", "0031"))
