"""Migration 0012 (docs/team/resume-versioning.md §3.3; PR 6): old résumé rows converted or deleted, the approved
drops, every résumé on a base; and the way back."""
import hashlib
import json
import uuid

from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from backend.tests.auth_support import make_user, seed_accounts
from backend.tests.test_migration_0002 import _alembic, _ok, scratch_db  # noqa: F401

OLD_JSON = {
    "header": {"name": "Alex Johnson", "contact_items": [
        {"text": "Irving, TX", "url": ""}, {"text": "alex@example.test", "url": "mailto:alex@example.test"},
        {"text": "linkedin.com/in/alex", "url": "https://linkedin.com/in/alex"}, {"text": "+1 555 010 0199", "url": ""}]},
    "summary": "Eight years of Java.",
    "experience": [{"company": "Capital Payments", "title": "Senior Java Developer", "location": "Irving, TX",
                    "date": "2021 - Present", "bullets": ["Built the payments API.", "Cut latency 40%."]}],
    "skills": {"Languages": "Java, Go", "Cloud": "AWS (ECS, Lambda)"},
    "education": [{"school": "JNTU", "degree": "B.Tech", "years": "2017"}],
    "projects": [{"name": "Ledger", "description": "A double-entry ledger.", "bullets": ["Designed it."]}],
}


def _world(engine) -> dict:
    """At 0011: a firm, a manager, three candidates, a job, and old rows of every kind."""
    from backend.models.tenancy import Firm
    with Session(engine) as db:
        accounts = seed_accounts(db)
        manager = make_user(db, db.get(Firm, accounts.firm_id), email="m@acme.test", role="MANAGER")
        db.commit()
        ids = {"firm": accounts.firm_id, "owner": accounts.user_id, "manager": manager.id}
    ids.update(asha=uuid.uuid4(), ravi=uuid.uuid4(), meera=uuid.uuid4(), job=uuid.uuid4(), parse=uuid.uuid4(),
               sample=uuid.uuid4(), base=uuid.uuid4(), tailored=uuid.uuid4(), copy=uuid.uuid4(), orphan=uuid.uuid4(),
               meera_new_base=uuid.uuid4(), meera_v1=uuid.uuid4(), meera_old=uuid.uuid4())
    with engine.begin() as conn:
        for who in ("asha", "ravi", "meera"):
            conn.execute(text("INSERT INTO candidates (id, firm_id, manager_id, created_by_user_id, full_name, email, "
                              "work_auth) VALUES (:id, :f, :m, :o, :n, :e, 'H1B')"),
                         {"id": ids[who], "f": ids["firm"], "m": ids["manager"], "o": ids["owner"], "n": who.title(),
                          "e": f"{who}@example.test"})
        conn.execute(text("INSERT INTO jobs (id, external_id, title, company, source) "
                          "VALUES (:id, 'm13', 'Java Dev', 'Acme', 'manual')"), {"id": ids["job"]})
        conn.execute(text("INSERT INTO resume_parses (id, firm_id, uploaded_by_user_id, candidate_id, file_name, "
                          "mime_type, size_bytes, content, parse, content_sha256) VALUES (:id, :f, :o, :c, 'a.pdf', "
                          "'application/pdf', 1, 'x', '{}', :sha)"),
                     {"id": ids["parse"], "f": ids["firm"], "o": ids["owner"], "c": ids["asha"],
                      "sha": hashlib.sha256(b"x").hexdigest()})
        old = "INSERT INTO resumes (id, firm_id, candidate_id, name, is_base, job_id, json_data, resume_parse_id, " \
              "category) VALUES (:id, :f, :c, :n, :b, :j, CAST(:d AS json), :p, :cat)"
        for rid, cand, name, is_base, job, parse in (
                ("sample", None, "Sample PM", True, None, None),          # no candidate: deleted
                ("base", "asha", "Asha base", True, None, "parse"),       # converted, UPLOAD, active
                ("tailored", "asha", "Asha for Acme", False, "job", None),  # TAILORED v1 on Asha's base
                ("copy", "asha", "Asha copy", False, None, None),         # a copy with no job: deleted
                ("orphan", "ravi", "Ravi for Acme", False, "job", None),  # no base anywhere: deleted
                ("meera_old", "meera", "Meera old", True, None, None)):   # PROMOTED, not active (she has one)
            conn.execute(text(old), {"id": ids[rid], "f": ids["firm"], "c": ids[cand] if cand else None, "n": name,
                                     "b": is_base, "j": ids[job] if job else None, "d": json.dumps(OLD_JSON),
                                     "p": ids[parse] if parse else None, "cat": "BASE" if is_base else "TAILORED"})
        # Meera already has a versioned base (PR 4's kind), active.
        conn.execute(text("INSERT INTO base_resumes (id, firm_id, candidate_id, source, is_active, created_by_user_id) "
                          "VALUES (:id, :f, :c, 'PROMOTED', true, :o)"),
                     {"id": ids["meera_new_base"], "f": ids["firm"], "c": ids["meera"], "o": ids["owner"]})
        conn.execute(text("INSERT INTO resumes (id, firm_id, candidate_id, name, base_resume_id, category, version, "
                          "created_by_user_id, full_name) VALUES (:id, :f, :c, 'Base', :b, 'BASE', 1, :o, 'Meera')"),
                     {"id": ids["meera_v1"], "f": ids["firm"], "c": ids["meera"], "b": ids["meera_new_base"],
                      "o": ids["owner"]})
    return ids


def test_old_rows_are_converted_or_deleted_and_the_old_columns_go(scratch_db):
    name, engine = scratch_db
    _ok(_alembic(name, "upgrade", "0011"))
    ids = _world(engine)
    _ok(_alembic(name, "upgrade", "head"))

    with engine.connect() as conn:
        left = {r.id for r in conn.execute(text("SELECT id FROM resumes"))}
        assert left == {ids["base"], ids["tailored"], ids["meera_old"], ids["meera_v1"]}
        base = conn.execute(text("SELECT b.source, b.is_active, b.resume_parse_id, b.created_by_user_id FROM resumes r "
                                 "JOIN base_resumes b ON b.id = r.base_resume_id WHERE r.id = :id"),
                            {"id": ids["base"]}).one()
        assert tuple(base) == ("UPLOAD", True, ids["parse"], ids["owner"])
        v1 = conn.execute(text("SELECT * FROM resumes WHERE id = :id"), {"id": ids["base"]}).mappings().one()
        assert (v1["category"], v1["version"], v1["full_name"], v1["email"], v1["phone"], v1["city"], v1["state"]) == \
            ("BASE", 1, "Alex Johnson", "alex@example.test", "+1 555 010 0199", "Irving", "TX")
        assert v1["linkedin"] == "https://linkedin.com/in/alex" and v1["summary"] == "Eight years of Java."
        assert v1["summary_id"]                                     # the summary is an item too (0011)
        assert [(s["category"], s["name"]) for s in v1["skills"]] == \
            [("Languages", "Java"), ("Languages", "Go"), ("Cloud", "AWS (ECS, Lambda)")]
        role = v1["experiences"][0]
        assert (role["job_title"], role["dates"], role["current"]) == ("Senior Java Developer", "2021 - Present", True)
        assert [b["text"] for b in role["bullets"]] == ["Built the payments API.", "Cut latency 40%."]
        assert (v1["educations"][0]["institution"], v1["educations"][0]["graduation_date"]) == ("JNTU", "2017")
        assert [b["text"] for b in v1["projects"][0]["bullets"]] == ["A double-entry ledger.", "Designed it."]
        ids_inside = [s["id"] for s in v1["skills"]] + [role["id"]] + [b["id"] for b in role["bullets"]]
        assert len(set(ids_inside)) == len(ids_inside)
        tailored = conn.execute(text("SELECT base_resume_id, category, version, job_id FROM resumes WHERE id = :id"),
                                {"id": ids["tailored"]}).one()
        assert (tailored.base_resume_id, tailored.category, tailored.version, tailored.job_id) == \
            (v1["base_resume_id"], "TAILORED", 1, ids["job"])
        meera = conn.execute(text("SELECT b.source, b.is_active FROM resumes r JOIN base_resumes b ON "
                                  "b.id = r.base_resume_id WHERE r.id = :id"), {"id": ids["meera_old"]}).one()
        assert tuple(meera) == ("PROMOTED", False)

    columns = {c["name"]: c for c in inspect(engine).get_columns("resumes")}
    assert not {"is_base", "parent_id", "json_data", "resume_parse_id", "updated_at"} & set(columns)
    assert not columns["base_resume_id"]["nullable"] and not columns["candidate_id"]["nullable"]
    assert "updated_at" not in {c["name"] for c in inspect(engine).get_columns("resume_parses")}
    assert "uq_resumes_one_base_per_candidate" not in {i["name"] for i in inspect(engine).get_indexes("resumes")}


def test_the_way_back_rebuilds_json_data_from_the_columns(scratch_db):
    name, engine = scratch_db
    _ok(_alembic(name, "upgrade", "0011"))
    ids = _world(engine)
    _ok(_alembic(name, "upgrade", "head"))
    _ok(_alembic(name, "downgrade", "0011"))
    with engine.connect() as conn:
        row = conn.execute(text("SELECT is_base, json_data FROM resumes WHERE id = :id"), {"id": ids["base"]}).one()
        assert row.is_base is True
        assert row.json_data["header"]["name"] == "Alex Johnson"
        assert row.json_data["experience"][0]["bullets"] == ["Built the payments API.", "Cut latency 40%."]
        assert row.json_data["skills"] == {"Languages": "Java, Go", "Cloud": "AWS (ECS, Lambda)"}
        assert conn.execute(text("SELECT is_base FROM resumes WHERE id = :id"), {"id": ids["tailored"]}).scalar() is False
    _ok(_alembic(name, "upgrade", "head"))                     # and forward again
