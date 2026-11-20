"""Migration 0013 (docs/team/resume-versioning.md §3.3; PR 6): JobNavigator's résumé rows are deleted, the approved
columns dropped, every résumé on a base; and the way back."""
import uuid

from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from backend.tests.auth_support import make_user, seed_accounts
from backend.tests.migration_support import downgrade_to, upgrade_head
from backend.tests.test_migration_0002 import _alembic, _ok, scratch_db  # noqa: F401


def _world(engine) -> dict:
    """At 0012: a firm, a manager, a candidate with a versioned base (v1, what BenchQ writes), and JobNavigator's
    kinds of old row (no base): firm-level, a candidate's base, a tailored copy, a copy with no job."""
    from backend.models.tenancy import Firm
    with Session(engine) as db:
        accounts = seed_accounts(db)
        manager = make_user(db, db.get(Firm, accounts.firm_id), email="m@acme.test", role="MANAGER")
        db.commit()
        ids = {"firm": accounts.firm_id, "owner": accounts.user_id, "manager": manager.id}
    ids.update(asha=uuid.uuid4(), job=uuid.uuid4(), base=uuid.uuid4(), v1=uuid.uuid4(), link=uuid.uuid4(),
               app=uuid.uuid4(), old=[uuid.uuid4() for _ in range(4)])
    sample, owned_base, tailored, copy = ids["old"]
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO candidates (id, firm_id, manager_id, created_by_user_id, full_name, email, "
                          "work_auth) VALUES (:id, :f, :m, :o, 'Asha', 'asha@example.test', 'H1B')"),
                     {"id": ids["asha"], "f": ids["firm"], "m": ids["manager"], "o": ids["owner"]})
        conn.execute(text("INSERT INTO jobs (id, external_id, title, company, source) "
                          "VALUES (:id, 'm13', 'Java Dev', 'Acme', 'manual')"), {"id": ids["job"]})
        conn.execute(text("INSERT INTO base_resumes (id, firm_id, candidate_id, source, is_active, created_by_user_id) "
                          "VALUES (:id, :f, :c, 'PROMOTED', true, :o)"),
                     {"id": ids["base"], "f": ids["firm"], "c": ids["asha"], "o": ids["owner"]})
        conn.execute(text("INSERT INTO resumes (id, firm_id, candidate_id, name, base_resume_id, category, version, "
                          "created_by_user_id, full_name) VALUES (:id, :f, :c, 'Base', :b, 'BASE', 1, :o, 'Asha')"),
                     {"id": ids["v1"], "f": ids["firm"], "c": ids["asha"], "b": ids["base"], "o": ids["owner"]})
        old = ("INSERT INTO resumes (id, firm_id, candidate_id, name, is_base, job_id, json_data, category) "
               "VALUES (:id, :f, :c, :n, :b, :j, '{\"summary\": \"old\"}', :cat)")
        for rid, cand, name, is_base, job in ((sample, None, "Sample PM", True, None),
                                              (owned_base, ids["asha"], "Asha old base", True, None),
                                              (tailored, ids["asha"], "Asha for Acme", False, ids["job"]),
                                              (copy, ids["asha"], "Asha copy", False, None)):
            conn.execute(text(old), {"id": rid, "f": ids["firm"], "c": cand, "n": name, "b": is_base, "j": job,
                                     "cat": "BASE" if is_base else "TAILORED"})
        # What points at an old row: a tracking link (and a click), an application, a cover letter.
        conn.execute(text("INSERT INTO tracer_links (id, firm_id, token, destination_url, source_label, resume_id) "
                          "VALUES (:id, :f, 'tok1234567890abc', 'https://x.test', 'LinkedIn', :r)"),
                     {"id": ids["link"], "f": ids["firm"], "r": tailored})
        conn.execute(text("INSERT INTO tracer_click_events (id, firm_id, tracer_link_id, clicked_at) VALUES (gen_random_uuid(), :f, :l, now())"),
                     {"f": ids["firm"], "l": ids["link"]})
        conn.execute(text("INSERT INTO applications (id, firm_id, candidate_id, job_id, status, resume_id) "
                          "VALUES (:id, :f, :c, :j, 'applied', :r)"),
                     {"id": ids["app"], "f": ids["firm"], "c": ids["asha"], "j": ids["job"], "r": tailored})
    return ids


def test_old_rows_are_deleted_what_pointed_at_them_lets_go_and_the_old_columns_go(scratch_db):
    name, engine = scratch_db
    _ok(_alembic(name, "upgrade", "0012"))
    ids = _world(engine)
    upgrade_head(name, engine)

    with engine.connect() as conn:
        assert {r.id for r in conn.execute(text("SELECT id FROM resumes"))} == {ids["v1"]}   # BenchQ's own row stays
        assert conn.execute(text("SELECT count(*) FROM tracer_links")).scalar_one() == 0     # link and its clicks go
        assert conn.execute(text("SELECT count(*) FROM tracer_click_events")).scalar_one() == 0
        assert conn.execute(text("SELECT resume_id FROM applications WHERE id = :id"), {"id": ids["app"]}).scalar_one() is None
    columns = {c["name"]: c for c in inspect(engine).get_columns("resumes")}
    assert not {"is_base", "parent_id", "json_data", "resume_parse_id", "updated_at"} & set(columns)
    assert not columns["base_resume_id"]["nullable"] and not columns["candidate_id"]["nullable"]
    assert "deleted_at" in columns and "deleted_at" in {c["name"] for c in inspect(engine).get_columns("base_resumes")}
    assert "updated_at" not in {c["name"] for c in inspect(engine).get_columns("resume_parses")}
    assert "uq_resumes_one_base_per_candidate" not in {i["name"] for i in inspect(engine).get_indexes("resumes")}


def test_the_way_back_restores_the_columns_empty_and_up_again_works(scratch_db):
    name, engine = scratch_db
    _ok(_alembic(name, "upgrade", "0012"))
    ids = _world(engine)
    upgrade_head(name, engine)
    downgrade_to(name, engine, "0012")
    with engine.connect() as conn:
        row = conn.execute(text("SELECT is_base, json_data FROM resumes WHERE id = :id"), {"id": ids["v1"]}).one()
        assert row.is_base is True and row.json_data is None                  # back, empty: deleted rows stay deleted
        assert conn.execute(text("SELECT count(*) FROM resumes")).scalar_one() == 1
    upgrade_head(name, engine)
