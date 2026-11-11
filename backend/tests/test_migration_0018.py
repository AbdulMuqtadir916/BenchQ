"""Migration 0018 (07 Q58): no MANUAL bases. Each becomes an UPLOAD base with a generated file; a placeholder next to a
real résumé goes; the checks allow UPLOAD and PROMOTED only."""
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.tests.auth_support import make_user, seed_accounts
from backend.tests.test_migration_0002 import _alembic, _ok, scratch_db  # noqa: F401


def _world(engine) -> dict:
    """At 0017: `solo` has only a MANUAL base; `both` has a MANUAL placeholder (active) and a promoted base."""
    from backend.models.tenancy import Firm
    with Session(engine) as db:
        accounts = seed_accounts(db)
        manager = make_user(db, db.get(Firm, accounts.firm_id), email="m@acme.test", role="MANAGER")
        db.commit()
        ids = {"firm": accounts.firm_id, "owner": accounts.user_id, "manager": manager.id}
    for key in ("solo", "both", "solo_base", "place", "real"):
        ids[key] = uuid.uuid4()
    with engine.begin() as conn:
        for key in ("solo", "both"):
            conn.execute(text("INSERT INTO candidates (id, firm_id, manager_id, created_by_user_id, work_auth) "
                              "VALUES (:id, :f, :m, :o, 'H1B')"),
                         {"id": ids[key], "f": ids["firm"], "m": ids["manager"], "o": ids["owner"]})
        for base, cand, source, active, at in (("solo_base", "solo", "MANUAL", True, "now()"),
                                               ("place", "both", "MANUAL", True, "now() - interval '2 days'"),
                                               ("real", "both", "PROMOTED", False, "now() - interval '1 day'")):
            conn.execute(text(f"INSERT INTO base_resumes (id, firm_id, candidate_id, source, is_active, created_by_user_id, "
                              f"created_at) VALUES (:id, :f, :c, :s, :a, :o, {at})"),
                         {"id": ids[base], "f": ids["firm"], "c": ids[cand], "s": source, "a": active, "o": ids["owner"]})
            conn.execute(text("INSERT INTO resumes (id, firm_id, candidate_id, name, base_resume_id, category, version, "
                              "created_by_user_id, full_name, email) VALUES (gen_random_uuid(), :f, :c, 'Base', :b, "
                              "'BASE', 1, :o, :n, 'x@example.test')"),
                         {"f": ids["firm"], "c": ids[cand], "b": ids[base], "o": ids["owner"], "n": f"{cand.title()} Person"})
    return ids


def test_manual_bases_become_uploads_and_the_check_refuses_manual(scratch_db):
    name, engine = scratch_db
    _ok(_alembic(name, "upgrade", "0017"))
    ids = _world(engine)
    _ok(_alembic(name, "upgrade", "0018"))
    with engine.connect() as conn:
        rows = {str(r.id): r for r in conn.execute(text(
            "SELECT b.id, b.source, b.is_active, b.deleted_at, p.mime_type, p.candidate_id, p.expires_at, "
            "p.parse->'header'->>'name' AS name FROM base_resumes b LEFT JOIN resume_parses p ON p.id = b.resume_parse_id"))}
    solo = rows[str(ids["solo_base"])]
    assert (solo.source, solo.is_active, solo.deleted_at, solo.mime_type, solo.expires_at) == ("UPLOAD", True, None, "application/pdf", None)
    assert (solo.candidate_id, solo.name) == (ids["solo"], "Solo Person")       # kept for its candidate, from its v1
    place, real = rows[str(ids["place"])], rows[str(ids["real"])]
    assert place.source == "UPLOAD" and place.deleted_at is not None and not place.is_active   # placeholder gone
    assert real.is_active                                                                     # the real one takes over
    with pytest.raises(IntegrityError), engine.begin() as conn:
        conn.execute(text("UPDATE base_resumes SET source = 'MANUAL' WHERE id = :b"), {"b": ids["solo_base"]})

    _ok(_alembic(name, "downgrade", "0017"))
    _ok(_alembic(name, "upgrade", "0018"))
