"""Migration 0020: the job search tables, `job_postings` and `scrape_jobs`."""
import json
import uuid

from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.tests.auth_support import make_user, seed_accounts
from backend.tests.test_migration_0002 import _alembic, _ok, scratch_db  # noqa: F401


def _firm_and_candidate(engine):
    with Session(engine) as db:
        accounts = seed_accounts(db)
        from backend.models.tenancy import Firm
        manager = make_user(db, db.get(Firm, accounts.firm_id), email="m@acme.test", role="MANAGER")
        db.commit()
        firm_id, owner_id, manager_id = accounts.firm_id, accounts.user_id, manager.id
    candidate_id = uuid.uuid4()
    with engine.begin() as conn:
        conn.execute(text(
            "INSERT INTO candidates (id, firm_id, manager_id, created_by_user_id, work_auth, needs_sponsorship, "
            "rate_target, rate_min, contact_notes) VALUES (:id, :firm_id, :manager_id, :owner_id, 'H1B', true, 85, "
            "70, 'internal')"),
            {"id": candidate_id, "firm_id": firm_id, "manager_id": manager_id, "owner_id": owner_id})
    return firm_id, candidate_id


def _rejected(engine, sql, params) -> bool:
    with engine.connect() as conn:
        try:
            with conn.begin():
                conn.execute(text(sql), params)
        except IntegrityError:
            return True
    return False


_POSTING = ("INSERT INTO job_postings (id, firm_id, candidate_id, batch_id, source, job_id, content) VALUES "
            "(:id, :firm_id, :candidate_id, :batch_id, 'freehire', :job_id, CAST(:content AS jsonb))")
_SCRAPE = ("INSERT INTO scrape_jobs (id, firm_id, candidate_id, batch_id, state, error) VALUES "
           "(:id, :firm_id, :candidate_id, :batch_id, :state, :error)")


def test_job_postings_defaults_and_one_row_per_candidate_job(scratch_db):
    name, engine = scratch_db
    _ok(_alembic(name, "upgrade", "0020"))
    firm_id, candidate_id = _firm_and_candidate(engine)

    posting = {"id": uuid.uuid4(), "firm_id": firm_id, "candidate_id": candidate_id, "batch_id": uuid.uuid4(),
               "job_id": "a" * 64, "content": json.dumps({"title": "Senior Developer", "company": "Acme"})}
    with engine.begin() as conn:
        conn.execute(text(_POSTING), posting)
    with engine.connect() as conn:
        row = conn.execute(text("SELECT status, content FROM job_postings WHERE id = :id"),
                           {"id": posting["id"]}).mappings().one()
    assert row["status"] == "new"
    assert row["content"] == {"title": "Senior Developer", "company": "Acme"}

    # Same candidate, same job_id -> rejected; ingestion updates the existing row instead of inserting.
    assert _rejected(engine, _POSTING, {**posting, "id": uuid.uuid4(), "batch_id": uuid.uuid4()})


def test_scrape_jobs_error_only_on_error_and_one_row_per_batch(scratch_db):
    name, engine = scratch_db
    _ok(_alembic(name, "upgrade", "0020"))
    firm_id, candidate_id = _firm_and_candidate(engine)
    base = {"firm_id": firm_id, "candidate_id": candidate_id}

    batch_id = uuid.uuid4()
    with engine.begin() as conn:
        conn.execute(text(_SCRAPE), {**base, "id": uuid.uuid4(), "batch_id": batch_id, "state": "success",
                                     "error": None})
        conn.execute(text(_SCRAPE), {**base, "id": uuid.uuid4(), "batch_id": uuid.uuid4(), "state": "error",
                                     "error": "timeout"})

    assert _rejected(engine, _SCRAPE, {**base, "id": uuid.uuid4(), "batch_id": uuid.uuid4(), "state": "success",
                                       "error": "boom"})
    assert _rejected(engine, _SCRAPE, {**base, "id": uuid.uuid4(), "batch_id": batch_id, "state": "success",
                                       "error": None})


def test_downgrade_drops_both_tables(scratch_db):
    name, engine = scratch_db
    _ok(_alembic(name, "upgrade", "0020"))
    _ok(_alembic(name, "downgrade", "0019"))
    tables = inspect(engine).get_table_names()
    assert "job_postings" not in tables and "scrape_jobs" not in tables
