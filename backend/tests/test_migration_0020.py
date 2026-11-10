"""Migration 0020: the job search tables, `job_postings` and `scrape_jobs`."""
import json
import uuid

from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.tests.auth_support import make_firm, make_user, seed_accounts
from backend.tests.test_migration_0002 import _alembic, _ok, scratch_db  # noqa: F401

_HASH = "a" * 64


def _firm_and_candidate(engine):
    """A firm with one candidate, plus a second firm (for the cross-firm checks)."""
    with Session(engine) as db:
        accounts = seed_accounts(db)
        from backend.models.tenancy import Firm, Plan
        firm = db.get(Firm, accounts.firm_id)
        manager = make_user(db, firm, email="m@acme.test", role="MANAGER")
        other = make_firm(db, db.get(Plan, firm.plan_id), slug="globex")
        db.commit()
        firm_id, owner_id, manager_id, other_firm_id = accounts.firm_id, accounts.user_id, manager.id, other.id
    candidate_id = uuid.uuid4()
    with engine.begin() as conn:
        conn.execute(text(
            "INSERT INTO candidates (id, firm_id, manager_id, created_by_user_id, work_auth, needs_sponsorship, "
            "rate_target, rate_min, contact_notes) VALUES (:id, :firm_id, :manager_id, :owner_id, 'H1B', true, 85, "
            "70, 'internal')"),
            {"id": candidate_id, "firm_id": firm_id, "manager_id": manager_id, "owner_id": owner_id})
    return firm_id, candidate_id, other_firm_id


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


def _scrape(engine, firm_id, candidate_id, state="success", error=None):
    batch_id = uuid.uuid4()
    with engine.begin() as conn:
        conn.execute(text(_SCRAPE), {"id": uuid.uuid4(), "firm_id": firm_id, "candidate_id": candidate_id,
                                     "batch_id": batch_id, "state": state, "error": error})
    return batch_id


def test_job_postings_one_row_per_candidate_job(scratch_db):
    name, engine = scratch_db
    _ok(_alembic(name, "upgrade", "0020"))
    firm_id, candidate_id, _ = _firm_and_candidate(engine)
    batch_id = _scrape(engine, firm_id, candidate_id)

    posting = {"id": uuid.uuid4(), "firm_id": firm_id, "candidate_id": candidate_id, "batch_id": batch_id,
               "job_id": _HASH, "content": json.dumps({"title": "Senior Developer", "company": "Acme"})}
    with engine.begin() as conn:
        conn.execute(text(_POSTING), posting)
    with engine.connect() as conn:
        assert conn.execute(text("SELECT content FROM job_postings WHERE id = :id"),
                            {"id": posting["id"]}).scalar_one() == {"title": "Senior Developer", "company": "Acme"}
    columns = {c["name"] for c in inspect(engine).get_columns("job_postings")}
    assert "status" not in columns   # saved/applied live in applications

    # Same candidate, same job_id -> rejected; ingestion updates the existing row instead of inserting.
    assert _rejected(engine, _POSTING, {**posting, "id": uuid.uuid4()})


def test_job_postings_job_id_is_a_sha256_hex_digest(scratch_db):
    name, engine = scratch_db
    _ok(_alembic(name, "upgrade", "0020"))
    firm_id, candidate_id, _ = _firm_and_candidate(engine)
    batch_id = _scrape(engine, firm_id, candidate_id)
    base = {"firm_id": firm_id, "candidate_id": candidate_id, "batch_id": batch_id, "content": "{}"}

    for bad in ("A" * 64, "a" * 63, "board-12345", "g" * 64):
        assert _rejected(engine, _POSTING, {**base, "id": uuid.uuid4(), "job_id": bad}), bad
    assert not _rejected(engine, _POSTING, {**base, "id": uuid.uuid4(), "job_id": "0123456789abcdef" * 4})


def test_job_postings_batch_must_be_logged_first(scratch_db):
    name, engine = scratch_db
    _ok(_alembic(name, "upgrade", "0020"))
    firm_id, candidate_id, _ = _firm_and_candidate(engine)
    assert _rejected(engine, _POSTING, {"id": uuid.uuid4(), "firm_id": firm_id, "candidate_id": candidate_id,
                                        "batch_id": uuid.uuid4(), "job_id": _HASH, "content": "{}"})


def test_both_tables_refuse_a_firm_other_than_the_candidates(scratch_db):
    name, engine = scratch_db
    _ok(_alembic(name, "upgrade", "0020"))
    firm_id, candidate_id, other_firm_id = _firm_and_candidate(engine)
    batch_id = _scrape(engine, firm_id, candidate_id)

    assert _rejected(engine, _SCRAPE, {"id": uuid.uuid4(), "firm_id": other_firm_id, "candidate_id": candidate_id,
                                       "batch_id": uuid.uuid4(), "state": "success", "error": None})
    assert _rejected(engine, _POSTING, {"id": uuid.uuid4(), "firm_id": other_firm_id, "candidate_id": candidate_id,
                                        "batch_id": batch_id, "job_id": _HASH, "content": "{}"})


def test_scrape_jobs_states_error_detail_and_one_row_per_batch(scratch_db):
    name, engine = scratch_db
    _ok(_alembic(name, "upgrade", "0020"))
    firm_id, candidate_id, _ = _firm_and_candidate(engine)
    base = {"firm_id": firm_id, "candidate_id": candidate_id}

    batch_id = _scrape(engine, firm_id, candidate_id, "success")
    _scrape(engine, firm_id, candidate_id, "empty")
    _scrape(engine, firm_id, candidate_id, "error", "timeout")

    with engine.connect() as conn:
        assert conn.execute(text("SELECT metadata FROM scrape_jobs WHERE batch_id = :b"),
                            {"b": batch_id}).scalar_one() == {}
    meta_batch = uuid.uuid4()
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO scrape_jobs (firm_id, candidate_id, batch_id, state, metadata) VALUES "
                          "(:firm_id, :candidate_id, :batch_id, 'success', CAST(:meta AS jsonb))"),
                     {**base, "batch_id": meta_batch, "meta": json.dumps({"total": 161, "limit": 100})})
        assert conn.execute(text("SELECT metadata FROM scrape_jobs WHERE batch_id = :b"),
                            {"b": meta_batch}).scalar_one() == {"total": 161, "limit": 100}

    def rejected(state, error, batch=None):
        return _rejected(engine, _SCRAPE, {**base, "id": uuid.uuid4(), "batch_id": batch or uuid.uuid4(),
                                           "state": state, "error": error})

    assert rejected("pending", None)                 # no in-progress state
    assert rejected("success", "boom")               # a detail only on an error row
    assert rejected("empty", "boom")
    assert rejected("error", None)                   # an error row must say why
    assert rejected("success", None, batch_id)       # one row per batch


def test_downgrade_drops_both_tables(scratch_db):
    name, engine = scratch_db
    _ok(_alembic(name, "upgrade", "0020"))
    _ok(_alembic(name, "downgrade", "0019"))
    inspector = inspect(engine)
    tables = inspector.get_table_names()
    assert "job_postings" not in tables and "scrape_jobs" not in tables
    assert "uq_candidates_firm_id" not in {u["name"] for u in inspector.get_unique_constraints("candidates")}
