"""Migration 0019 (decided 2026-11-07; the built answers aren't stored, 2026-11-08): every version, deleted ones too,
starts with no autofill entries, and `candidates.qa_bank` goes; the downgrade puts it back empty."""
import uuid

from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from backend.tests.auth_support import make_user, seed_accounts
from backend.tests.test_migration_0002 import _alembic, _ok, scratch_db  # noqa: F401


def _columns(engine, table) -> dict:
    return {c["name"]: c for c in inspect(engine).get_columns(table)}


def test_every_version_starts_with_no_entries_and_the_answer_bank_leaves_candidates(scratch_db):
    name, engine = scratch_db
    _ok(_alembic(name, "upgrade", "0018"))
    from backend.models.tenancy import Firm
    with Session(engine) as db:
        accounts = seed_accounts(db)
        manager = make_user(db, db.get(Firm, accounts.firm_id), email="m@acme.test", role="MANAGER")
        db.commit()
        firm, owner, manager_id = accounts.firm_id, accounts.user_id, manager.id
    cand, base = uuid.uuid4(), uuid.uuid4()
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO candidates (id, firm_id, manager_id, created_by_user_id, work_auth, "
                          "needs_sponsorship, rate_target, rate_min, contact_notes, qa_bank) VALUES (:id, :f, :m, :o, "
                          "'H1B', true, 85, 70, 'internal', '[{\"question\": \"q\", \"answer\": \"a\"}]')"),
                     {"id": cand, "f": firm, "m": manager_id, "o": owner})
        conn.execute(text("INSERT INTO base_resumes (id, firm_id, candidate_id, source, is_active, created_by_user_id) "
                          "VALUES (:id, :f, :c, 'PROMOTED', true, :o)"), {"id": base, "f": firm, "c": cand, "o": owner})
        for number, deleted in ((1, False), (2, True)):
            conn.execute(text("INSERT INTO resumes (id, firm_id, candidate_id, name, base_resume_id, category, version, "
                              "created_by_user_id, full_name, email, work_authorization, experiences, deleted_at) "
                              "VALUES (:id, :f, :c, 'Base', :b, 'BASE', :n, :o, 'Ravi Teja', 'r@example.test', 'H-1B', "
                              "'[{\"company\": \"Acme\", \"job_title\": \"Dev\", \"start\": \"2018\", \"end\": \"2021\"}]', "
                              "CASE WHEN :deleted THEN now() END)"),
                         {"id": uuid.uuid4(), "f": firm, "c": cand, "b": base, "o": owner, "n": number,
                          "deleted": deleted})

    _ok(_alembic(name, "upgrade", "0019"))
    with engine.connect() as conn:
        stored = conn.execute(text("SELECT autofill FROM resumes ORDER BY version")).scalars().all()
    assert stored == [{}, {}]                              # nothing built or copied in: the answers are built on read
    assert _columns(engine, "resumes")["autofill"]["nullable"] is False
    assert "qa_bank" not in _columns(engine, "candidates")

    _ok(_alembic(name, "downgrade", "0018"))
    assert "autofill" not in _columns(engine, "resumes")
    with engine.connect() as conn:
        assert conn.execute(text("SELECT qa_bank FROM candidates WHERE id = :id"), {"id": cand}).scalar_one() == []
