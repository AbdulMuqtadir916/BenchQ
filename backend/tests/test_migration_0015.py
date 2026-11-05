"""Migration 0015 (docs/team/zuhair.md §1.1 and §1.3; docs/team/resume-versioning.md §3.2): `candidates.persona`, `skills`
and `summary_state` go and industries and deal breakers become flat columns; a base can come from the form alone
(`MANUAL`); and the way back."""
import json
import uuid

import pytest
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.tests.auth_support import make_user, seed_accounts
from backend.tests.test_migration_0002 import _alembic, _ok, scratch_db  # noqa: F401

PERSONA = {"summary": "Nine years of Java.", "tone_notes": "formal", "will_relocate": True, "notice_period_days": 14,
           "preferred_industries": ["fintech", "healthcare"], "deal_breakers": ["no travel"]}


def _world(engine) -> dict:
    """At 0013: a firm, a manager, a candidate with a persona, skills, an active base and its v1; one without."""
    from backend.models.tenancy import Firm
    with Session(engine) as db:
        accounts = seed_accounts(db)
        manager = make_user(db, db.get(Firm, accounts.firm_id), email="m@acme.test", role="MANAGER")
        db.commit()
        ids = {"firm": accounts.firm_id, "owner": accounts.user_id, "manager": manager.id}
    ids.update(asha=uuid.uuid4(), plain=uuid.uuid4(), base=uuid.uuid4(), v1=uuid.uuid4())
    insert = ("INSERT INTO candidates (id, firm_id, manager_id, created_by_user_id, full_name, email, work_auth, "
              "willing_to_relocate, notice_period_days, persona) VALUES (:id, :f, :m, :o, :n, :e, 'H1B', :w, :d, "
              "CAST(:p AS jsonb))")
    with engine.begin() as conn:
        for key, name, persona, willing, days in (("asha", "Asha", PERSONA, True, 14), ("plain", "Plain", None, False, None)):
            conn.execute(text(insert), {"id": ids[key], "f": ids["firm"], "m": ids["manager"], "o": ids["owner"],
                                        "n": name, "e": f"{name.lower()}@example.test", "w": willing, "d": days,
                                        "p": json.dumps(persona) if persona else None})
        conn.execute(text("INSERT INTO base_resumes (id, firm_id, candidate_id, source, is_active, created_by_user_id) "
                          "VALUES (:id, :f, :c, 'PROMOTED', true, :o)"),
                     {"id": ids["base"], "f": ids["firm"], "c": ids["asha"], "o": ids["owner"]})
        conn.execute(text("INSERT INTO resumes (id, firm_id, candidate_id, name, base_resume_id, category, version, "
                          "created_by_user_id, full_name, summary) "
                          "VALUES (:id, :f, :c, 'Base', :b, 'BASE', 1, :o, 'Asha', 'The base summary.')"),
                     {"id": ids["v1"], "f": ids["firm"], "c": ids["asha"], "b": ids["base"], "o": ids["owner"]})
    return ids


def _manual_base(engine, ids, source="MANUAL", candidate="plain") -> None:
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO base_resumes (id, firm_id, candidate_id, source, is_active, created_by_user_id) "
                          "VALUES (gen_random_uuid(), :f, :c, :s, true, :o)"),
                     {"f": ids["firm"], "c": ids[candidate], "s": source, "o": ids["owner"]})


def test_industries_and_deal_breakers_are_copied_out_and_the_old_columns_go(scratch_db):
    name, engine = scratch_db
    _ok(_alembic(name, "upgrade", "0013"))
    ids = _world(engine)
    _ok(_alembic(name, "upgrade", "0015"))

    columns = {c["name"] for c in inspect(engine).get_columns("candidates")}
    assert not {"persona", "skills", "summary_state"} & columns and {"preferred_industries", "deal_breakers"} <= columns
    assert not next(c for c in inspect(engine).get_columns("candidates") if c["name"] == "needs_sponsorship")["nullable"]
    assert not {"claims", "evidence"} & set(inspect(engine).get_table_names())          # BenchQ has no claim states
    with engine.connect() as conn:
        row = conn.execute(text("SELECT preferred_industries, deal_breakers FROM candidates WHERE id = :id"),
                           {"id": ids["asha"]}).one()
        assert (row.preferred_industries, row.deal_breakers) == (["fintech", "healthcare"], ["no travel"])
        row = conn.execute(text("SELECT preferred_industries, deal_breakers FROM candidates WHERE id = :id"),
                           {"id": ids["plain"]}).one()
        assert (row.preferred_industries, row.deal_breakers) == ([], [])          # no persona: empty, not null


def test_a_base_may_come_from_the_form_alone_but_an_upload_needs_its_parse(scratch_db):
    name, engine = scratch_db
    _ok(_alembic(name, "upgrade", "0013"))
    ids = _world(engine)
    with pytest.raises(IntegrityError):                                           # MANUAL is not a source before 0015
        _manual_base(engine, ids)
    _ok(_alembic(name, "upgrade", "0015"))
    _manual_base(engine, ids)                                                     # now it is, with no parse
    with pytest.raises(IntegrityError):
        _manual_base(engine, ids, source="UPLOAD", candidate="asha")              # an upload still needs its parse
    with pytest.raises(IntegrityError):
        _manual_base(engine, ids, source="WHATEVER", candidate="asha")


def test_the_way_back_rebuilds_the_columns_from_the_base_brings_the_empty_tables_back_and_up_again_works(scratch_db):
    name, engine = scratch_db
    _ok(_alembic(name, "upgrade", "0013"))
    ids = _world(engine)
    _ok(_alembic(name, "upgrade", "0015"))
    _manual_base(engine, ids)
    with engine.begin() as conn:                                                  # the active base's v1 holds the skills
        conn.execute(text("UPDATE resumes SET skills = CAST(:s AS jsonb) WHERE id = :id"),
                     {"id": ids["v1"], "s": json.dumps([{"id": "s1", "category": "Core", "name": "Java"},
                                                         {"id": "s2", "category": "", "name": "Go"}])})
    _ok(_alembic(name, "downgrade", "0013"))

    columns = {c["name"] for c in inspect(engine).get_columns("candidates")}
    assert not next(c for c in inspect(engine).get_columns("candidates") if c["name"] == "needs_sponsorship")["nullable"]
    assert {"persona", "skills", "summary_state"} <= columns and not {"preferred_industries", "deal_breakers"} & columns
    with engine.connect() as conn:
        row = conn.execute(text("SELECT persona, skills, summary_state FROM candidates WHERE id = :id"),
                           {"id": ids["asha"]}).one()
        assert row.persona == {"summary": "The base summary.", "tone_notes": None, "will_relocate": True,
                               "notice_period_days": 14, "preferred_industries": ["fintech", "healthcare"],
                               "deal_breakers": ["no travel"]}
        assert row.skills == [{"name": "Java", "family": "Core", "source": "MANUAL", "state": "UNVERIFIED"},
                              {"name": "Go", "family": None, "source": "MANUAL", "state": "UNVERIFIED"}]
        assert conn.execute(text("SELECT count(*) FROM claims")).scalar() == 0              # the tables are back, empty
        assert conn.execute(text("SELECT count(*) FROM evidence")).scalar() == 0
        assert row.summary_state == "UNVERIFIED"
        assert {r.source for r in conn.execute(text("SELECT source FROM base_resumes"))} == {"PROMOTED"}
    _ok(_alembic(name, "upgrade", "0015"))
    assert "persona" not in {c["name"] for c in inspect(engine).get_columns("candidates")}
    assert not {"claims", "evidence"} & set(inspect(engine).get_table_names())
