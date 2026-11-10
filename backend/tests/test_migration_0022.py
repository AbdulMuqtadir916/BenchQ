"""Migration 0022: who ran a job search, `scrape_jobs.user_id` (job search PR 1), and the indexes for the daily caps."""
import uuid

from sqlalchemy import inspect, text

from backend.tests.test_migration_0002 import _alembic, _ok, scratch_db  # noqa: F401
from backend.tests.test_migration_0020 import _firm_and_candidate, _rejected

_SCRAPE = ("INSERT INTO scrape_jobs (id, firm_id, candidate_id, batch_id, state, user_id, finished_at) VALUES "
           "(:id, :firm_id, :candidate_id, :batch_id, 'empty', :user_id, now())")
_RUNNING = ("INSERT INTO scrape_jobs (id, firm_id, candidate_id, batch_id, state, user_id, finished_at) VALUES "
            "(:id, :firm_id, :candidate_id, :batch_id, :state, :user_id, :finished_at)")


def _owner_id(engine, firm_id):
    with engine.connect() as conn:
        return conn.execute(text("SELECT id FROM users WHERE firm_id = :f AND role = 'OWNER'"), {"f": firm_id}).scalar()


def test_a_search_names_who_ran_it(scratch_db):
    name, engine = scratch_db
    _ok(_alembic(name, "upgrade", "0022"))
    firm_id, candidate_id, _ = _firm_and_candidate(engine)
    row = {"id": uuid.uuid4(), "firm_id": firm_id, "candidate_id": candidate_id, "batch_id": uuid.uuid4()}
    assert _rejected(engine, _SCRAPE, {**row, "user_id": None})                 # NOT NULL
    assert _rejected(engine, _SCRAPE, {**row, "user_id": uuid.uuid4()})        # a real user
    assert not _rejected(engine, _SCRAPE, {**row, "user_id": _owner_id(engine, firm_id)})
    indexes = {i["name"] for i in inspect(engine).get_indexes("scrape_jobs")}
    assert {"ix_scrape_jobs_user_created", "ix_scrape_jobs_candidate_created"} <= indexes
    assert "ix_job_postings_candidate_discovered" in {i["name"] for i in inspect(engine).get_indexes("job_postings")}


def test_a_search_is_running_until_it_finishes(scratch_db):
    name, engine = scratch_db
    _ok(_alembic(name, "upgrade", "0022"))
    firm_id, candidate_id, _ = _firm_and_candidate(engine)
    user_id = _owner_id(engine, firm_id)

    def row(state, finished):
        return {"id": uuid.uuid4(), "firm_id": firm_id, "candidate_id": candidate_id, "batch_id": uuid.uuid4(),
                "user_id": user_id, "state": state, "finished_at": finished}
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    assert not _rejected(engine, _RUNNING, row("running", None))
    assert _rejected(engine, _RUNNING, row("running", now))       # a running search hasn't finished
    assert _rejected(engine, _RUNNING, row("success", None))      # a finished one says when
    assert not _rejected(engine, _RUNNING, row("success", now))


def test_downgrade_ends_a_running_search_as_an_error(scratch_db):
    name, engine = scratch_db
    _ok(_alembic(name, "upgrade", "0022"))
    firm_id, candidate_id, _ = _firm_and_candidate(engine)
    with engine.begin() as conn:
        conn.execute(text(_RUNNING), {"id": uuid.uuid4(), "firm_id": firm_id, "candidate_id": candidate_id,
                                      "batch_id": uuid.uuid4(), "user_id": _owner_id(engine, firm_id),
                                      "state": "running", "finished_at": None})
    _ok(_alembic(name, "downgrade", "0021"))
    with engine.connect() as conn:
        assert conn.execute(text("SELECT state FROM scrape_jobs")).scalar() == "error"


def test_downgrade_drops_the_column_and_indexes(scratch_db):
    name, engine = scratch_db
    _ok(_alembic(name, "upgrade", "0022"))
    _ok(_alembic(name, "downgrade", "0021"))
    inspector = inspect(engine)
    assert not {"user_id", "finished_at"} & {c["name"] for c in inspector.get_columns("scrape_jobs")}
    assert "ix_job_postings_candidate_discovered" not in {i["name"] for i in inspector.get_indexes("job_postings")}
