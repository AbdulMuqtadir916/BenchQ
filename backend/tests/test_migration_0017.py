"""Migration 0017 (07 Q57): name, email, phone, LinkedIn, city, state and country leave `candidates` for the résumé,
nothing lost; and the way back."""
import uuid

from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from backend.tests.test_migration_0002 import _alembic, _ok, scratch_db  # noqa: F401
from backend.tests.auth_support import make_user, seed_accounts

FIELDS = {"full_name", "email", "phone", "linkedin_url", "city", "state", "country"}


def _columns(engine) -> set[str]:
    return {c["name"] for c in inspect(engine).get_columns("candidates")}


def _world(engine) -> dict:
    """At 0016: one candidate with no base (the demo seed's kind), one whose v1 lacks a phone."""
    from backend.models.tenancy import Firm
    with Session(engine) as db:
        accounts = seed_accounts(db)
        manager = make_user(db, db.get(Firm, accounts.firm_id), email="m@acme.test", role="MANAGER")
        db.commit()
        ids = {"firm": accounts.firm_id, "owner": accounts.user_id, "manager": manager.id}
    ids.update(bare=uuid.uuid4(), based=uuid.uuid4(), base=uuid.uuid4(), v1=uuid.uuid4())
    insert = ("INSERT INTO candidates (id, firm_id, manager_id, created_by_user_id, full_name, email, phone, "
              "linkedin_url, city, state, country, work_auth, primary_role) "
              "VALUES (:id, :f, :m, :o, :n, :e, :p, :l, 'Dallas', 'TX', 'US', 'H1B', 'Java Developer')")
    with engine.begin() as conn:
        for key, name in (("bare", "Bare Candidate"), ("based", "Based Candidate")):
            conn.execute(text(insert), {"id": ids[key], "f": ids["firm"], "m": ids["manager"], "o": ids["owner"],
                                        "n": name, "e": f"{key}@example.test", "p": "+1 555 0100",
                                        "l": f"https://linkedin.com/in/{key}"})
        conn.execute(text("INSERT INTO base_resumes (id, firm_id, candidate_id, source, is_active, created_by_user_id) "
                          "VALUES (:id, :f, :c, 'PROMOTED', true, :o)"),
                     {"id": ids["base"], "f": ids["firm"], "c": ids["based"], "o": ids["owner"]})
        conn.execute(text("INSERT INTO resumes (id, firm_id, candidate_id, name, base_resume_id, category, version, "
                          "created_by_user_id, full_name, email, city) "
                          "VALUES (:id, :f, :c, 'Base', :b, 'BASE', 1, :o, 'Based On Resume', 'resume@example.test', 'Austin')"),
                     {"id": ids["v1"], "f": ids["firm"], "c": ids["based"], "b": ids["base"], "o": ids["owner"]})
    return ids


def test_the_fields_move_to_the_resume_and_come_back(scratch_db):
    name, engine = scratch_db
    _ok(_alembic(name, "upgrade", "0016"))
    ids = _world(engine)

    _ok(_alembic(name, "upgrade", "0017"))
    assert not FIELDS & _columns(engine)
    with engine.connect() as conn:
        # The candidate with no base gets a MANUAL one, active, whose v1 holds what `candidates` held.
        bare = conn.execute(text(
            "SELECT b.source, b.is_active, r.version, r.full_name, r.email, r.phone, r.linkedin, r.city, r.state, "
            "r.country, r.title FROM base_resumes b JOIN resumes r ON r.base_resume_id = b.id "
            "WHERE b.candidate_id = :c"), {"c": ids["bare"]}).one()
        assert tuple(bare) == ("MANUAL", True, 1, "Bare Candidate", "bare@example.test", "+1 555 0100",
                               "https://linkedin.com/in/bare", "Dallas", "TX", "US", "Java Developer")
        # The résumé's own values win; only its empty fields are filled.
        based = conn.execute(text("SELECT full_name, email, phone, linkedin, city, state, country FROM resumes "
                                  "WHERE id = :id"), {"id": ids["v1"]}).one()
        assert tuple(based) == ("Based On Resume", "resume@example.test", "+1 555 0100",
                                "https://linkedin.com/in/based", "Austin", "TX", "US")
        assert conn.execute(text("SELECT count(*) FROM base_resumes WHERE candidate_id = :c"),
                            {"c": ids["based"]}).scalar() == 1           # had a base: no new one

    _ok(_alembic(name, "downgrade", "0016"))
    assert FIELDS <= _columns(engine)
    with engine.connect() as conn:
        rows = dict(conn.execute(text("SELECT id, full_name || '|' || email || '|' || city FROM candidates")).all())
    assert rows[ids["bare"]] == "Bare Candidate|bare@example.test|Dallas"
    assert rows[ids["based"]] == "Based On Resume|resume@example.test|Austin"   # from the active base's newest version

    _ok(_alembic(name, "upgrade", "0017"))
