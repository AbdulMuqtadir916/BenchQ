"""Migration 0023 (job search PR 2): `scrape_jobs.kind`, the candidate-safe target on `job_postings`, and what named an
old job pointing at `job_postings`; nothing is copied, so a cover letter or tailored résumé naming an old job stops
the upgrade."""
import uuid

from sqlalchemy import inspect, text

from backend.tests.migration_support import down_to_0026, upgrade_head
from backend.tests.test_migration_0002 import _alembic, scratch_db  # noqa: F401
from backend.tests.test_migration_0020 import _firm_and_candidate, _rejected
from backend.tests.test_migration_0022 import _owner_id


def _ok(result):
    assert result.returncode == 0, f"alembic failed:\n{result.stdout}\n{result.stderr}"


def _fks(engine, table) -> dict:
    return {fk["name"]: fk["referred_table"] for fk in inspect(engine).get_foreign_keys(table)}


def test_what_named_an_old_job_names_a_job_posting(scratch_db):
    name, engine = scratch_db
    _ok(_alembic(name, "upgrade", "0023"))
    assert _fks(engine, "resumes")["fk_resumes_job_posting"] == "job_postings"
    assert _fks(engine, "cover_letters")["cover_letters_job_id_fkey"] == "job_postings"
    assert _fks(engine, "job_runs")["job_runs_target_job_id_fkey"] == "job_postings"
    assert _fks(engine, "llm_call_log")["llm_call_log_job_id_fkey"] == "job_postings"
    assert "uq_job_postings_firm_candidate_id" in {u["name"] for u in inspect(engine).get_unique_constraints("job_postings")}


def test_a_batch_is_a_search_or_a_capture(scratch_db):
    name, engine = scratch_db
    _ok(_alembic(name, "upgrade", "0023"))
    firm_id, candidate_id, _ = _firm_and_candidate(engine)
    sql = ("INSERT INTO scrape_jobs (id, firm_id, candidate_id, user_id, batch_id, state, finished_at, kind) VALUES "
           "(:id, :firm_id, :candidate_id, :user_id, :batch_id, 'success', now(), :kind)")
    row = {"firm_id": firm_id, "candidate_id": candidate_id, "user_id": _owner_id(engine, firm_id)}
    assert not _rejected(engine, sql, {**row, "id": uuid.uuid4(), "batch_id": uuid.uuid4(), "kind": "capture"})
    assert _rejected(engine, sql, {**row, "id": uuid.uuid4(), "batch_id": uuid.uuid4(), "kind": "other"})


def test_a_cover_letter_naming_an_old_job_stops_the_upgrade(scratch_db):
    name, engine = scratch_db
    _ok(_alembic(name, "upgrade", "0022"))
    firm_id, _, _ = _firm_and_candidate(engine)
    job_id = uuid.uuid4()
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO jobs (id, external_id, title, company, source) VALUES "
                          "(:id, 'old-1', 'Old job', 'Old Corp', 'manual')"), {"id": job_id})
        conn.execute(text("INSERT INTO cover_letters (id, firm_id, name, job_id) VALUES (:id, :firm, 'Old', :job)"),
                     {"id": uuid.uuid4(), "firm": firm_id, "job": job_id})
    result = _alembic(name, "upgrade", "0023")
    assert result.returncode != 0 and "clear these local test rows" in (result.stdout + result.stderr)


def test_downgrade_points_back_at_jobs_and_drops_captures(scratch_db):
    name, engine = scratch_db
    _ok(_alembic(name, "upgrade", "0023"))
    _ok(_alembic(name, "downgrade", "0022"))
    assert _fks(engine, "cover_letters")["cover_letters_job_id_fkey"] == "jobs"
    assert "resumes_job_id_fkey" in _fks(engine, "resumes")
    assert "kind" not in {c["name"] for c in inspect(engine).get_columns("scrape_jobs")}


def test_upgrade_runs_again_after_a_downgrade_that_kept_searches(scratch_db):
    """Abdul's review of PR 1 (P2), for 0023 and 0022 together: searches and their jobs kept by a downgrade (to 0022,
    and on to 0021) upgrade again; a capture doesn't survive the way down."""
    name, engine = scratch_db
    _ok(_alembic(name, "upgrade", "0023"))
    firm_id, candidate_id, _ = _firm_and_candidate(engine)
    search, captured = uuid.uuid4(), uuid.uuid4()
    with engine.begin() as conn:
        for batch_id, kind, n in ((search, "search", "a"), (captured, "capture", "b")):
            conn.execute(text(
                "INSERT INTO scrape_jobs (id, firm_id, candidate_id, user_id, batch_id, state, finished_at, kind) "
                "VALUES (:id, :firm_id, :candidate_id, :user_id, :batch_id, 'success', now(), :kind)"),
                {"id": uuid.uuid4(), "firm_id": firm_id, "candidate_id": candidate_id,
                 "user_id": _owner_id(engine, firm_id), "batch_id": batch_id, "kind": kind})
            conn.execute(text(
                "INSERT INTO job_postings (id, firm_id, candidate_id, batch_id, source, first_source, job_id, content) "
                "VALUES (:id, :firm_id, :candidate_id, :batch_id, 'freehire', 'freehire', :job_id, '{}'::jsonb)"),
                {"id": uuid.uuid4(), "firm_id": firm_id, "candidate_id": candidate_id, "batch_id": batch_id,
                 "job_id": n * 64})
    for down in ("0022", "0021"):
        _ok(_alembic(name, "downgrade", down))
        _ok(_alembic(name, "upgrade", "0023"))
        with engine.connect() as conn:
            assert conn.execute(text("SELECT batch_id, kind FROM scrape_jobs")).all() == [(search, "search")]
            assert conn.execute(text("SELECT count(*) FROM job_postings")).scalar() == 1


def test_downgrade_unlinks_what_names_a_posting_and_upgrades_again(scratch_db):
    """Decided 2026-11-11 (a): with a full world at head (tailored résumés and letters naming postings), the downgrade
    doesn't stop: the letters are unlinked, the tailored résumés go, everything else stays; then up again."""
    from sqlalchemy.orm import Session

    from backend.tests.auth_support import seed_accounts
    from backend.tests.isolation_support import make_world
    name, engine = scratch_db
    _ok(_alembic(name, "upgrade", "head"))
    with Session(engine) as db:
        make_world(db, seed_accounts(db))
        db.commit()

    def counts():
        with engine.connect() as conn:
            return {sql: conn.execute(text(sql)).scalar() for sql in (
                "SELECT count(*) FROM resumes WHERE job_id IS NOT NULL",
                "SELECT count(*) FROM resumes WHERE job_id IS NULL",
                "SELECT count(*) FROM cover_letters WHERE job_id IS NOT NULL",
                "SELECT count(*) FROM cover_letters")}
    before = counts()
    assert before["SELECT count(*) FROM resumes WHERE job_id IS NOT NULL"] > 0
    assert before["SELECT count(*) FROM cover_letters WHERE job_id IS NOT NULL"] > 0
    down_to_0026(name, engine)          # past 0026 the applications name their old jobs again (the move's undo)
    _ok(_alembic(name, "downgrade", "0022"))
    after = counts()
    assert after["SELECT count(*) FROM resumes WHERE job_id IS NOT NULL"] == 0
    assert after["SELECT count(*) FROM cover_letters WHERE job_id IS NOT NULL"] == 0
    assert after["SELECT count(*) FROM resumes WHERE job_id IS NULL"] == before[
        "SELECT count(*) FROM resumes WHERE job_id IS NULL"]                       # base résumés untouched
    assert after["SELECT count(*) FROM cover_letters"] == before["SELECT count(*) FROM cover_letters"]
    upgrade_head(name, engine)


def test_a_posting_remembers_how_it_was_first_saved(scratch_db):
    """Abdul's comment on PR 2: `first_source`, filled from `source` for rows already there, required after."""
    name, engine = scratch_db
    _ok(_alembic(name, "upgrade", "0022"))
    firm_id, candidate_id, _ = _firm_and_candidate(engine)
    batch_id = uuid.uuid4()
    with engine.begin() as conn:
        conn.execute(text(
            "INSERT INTO scrape_jobs (id, firm_id, candidate_id, user_id, batch_id, state, finished_at) VALUES "
            "(:id, :firm_id, :candidate_id, :user_id, :batch_id, 'success', now())"),
            {"id": uuid.uuid4(), "firm_id": firm_id, "candidate_id": candidate_id,
             "user_id": _owner_id(engine, firm_id), "batch_id": batch_id})
        conn.execute(text(
            "INSERT INTO job_postings (id, firm_id, candidate_id, batch_id, source, job_id, content) VALUES "
            "(:id, :firm_id, :candidate_id, :batch_id, 'manual', :job_id, '{}'::jsonb)"),
            {"id": uuid.uuid4(), "firm_id": firm_id, "candidate_id": candidate_id, "batch_id": batch_id,
             "job_id": "d" * 64})
    _ok(_alembic(name, "upgrade", "0023"))
    with engine.connect() as conn:
        assert conn.execute(text("SELECT first_source FROM job_postings")).scalar() == "manual"
    assert _rejected(engine, "UPDATE job_postings SET first_source = NULL", {})
