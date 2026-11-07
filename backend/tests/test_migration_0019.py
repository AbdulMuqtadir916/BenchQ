"""Migration 0019 (decided 2026-11-07): every existing version gets its `autofill`, and `candidates.qa_bank` goes."""
import uuid

from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from backend.tests.auth_support import make_user, seed_accounts
from backend.tests.test_migration_0002 import _alembic, _ok, scratch_db  # noqa: F401


def test_existing_versions_are_filled_and_the_answer_bank_leaves_candidates(scratch_db):
    name, engine = scratch_db
    _ok(_alembic(name, "upgrade", "0018"))
    from backend.models.tenancy import Firm
    with Session(engine) as db:
        accounts = seed_accounts(db)
        manager = make_user(db, db.get(Firm, accounts.firm_id), email="m@acme.test", role="MANAGER")
        db.commit()
        firm, owner, manager_id = accounts.firm_id, accounts.user_id, manager.id
    cand, base, version = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO candidates (id, firm_id, manager_id, created_by_user_id, work_auth, "
                          "needs_sponsorship, rate_target, rate_min, contact_notes, qa_bank) VALUES (:id, :f, :m, :o, "
                          "'H1B', true, 85, 70, 'internal', '[{\"question\": \"q\", \"answer\": \"a\"}]')"),
                     {"id": cand, "f": firm, "m": manager_id, "o": owner})
        conn.execute(text("INSERT INTO base_resumes (id, firm_id, candidate_id, source, is_active, created_by_user_id) "
                          "VALUES (:id, :f, :c, 'PROMOTED', true, :o)"), {"id": base, "f": firm, "c": cand, "o": owner})
        conn.execute(text("INSERT INTO resumes (id, firm_id, candidate_id, name, base_resume_id, category, version, "
                          "created_by_user_id, full_name, email, work_authorization, experiences) VALUES (:id, :f, :c, "
                          "'Base', :b, 'BASE', 1, :o, 'Ravi Teja', 'r@example.test', 'H-1B', "
                          "'[{\"company\": \"Acme\", \"job_title\": \"Dev\", \"start\": \"2018\", \"end\": \"2021\"}]')"),
                     {"id": version, "f": firm, "c": cand, "b": base, "o": owner})

    _ok(_alembic(name, "upgrade", "0019"))
    with engine.connect() as conn:
        answers = conn.execute(text("SELECT autofill FROM resumes WHERE id = :id"), {"id": version}).scalar_one()
    assert answers["What is your full name?"] == "Ravi Teja"
    assert answers["What is your work authorization?"] == "H-1B"
    assert answers["Will you now or in the future require visa sponsorship?"] is True
    assert answers["What is your expected rate?"] == 85
    assert answers["How many years of experience do you have?"] == 3        # 2018-01 to 2021-01, as the form counts
    assert "internal" not in str(answers) and 70 not in answers.values()
    assert "qa_bank" not in {c["name"] for c in inspect(engine).get_columns("candidates")}

    _ok(_alembic(name, "downgrade", "0018"))
    assert "autofill" not in {c["name"] for c in inspect(engine).get_columns("resumes")}
    assert "qa_bank" in {c["name"] for c in inspect(engine).get_columns("candidates")}
