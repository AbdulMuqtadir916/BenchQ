"""Migration 0012 (docs/team/resume-versioning.md §3.1, §3.2; PR 5): promoted and hidden bases, file fingerprints; the
rules the database holds, and existing uploads fingerprinted on the way up."""
import hashlib
import uuid
from datetime import timedelta

from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from backend.models.candidates import BaseResume, ResumeParse, file_sha256
from backend.models.db import Resume, utcnow
from backend.tests.auth_support import seed_accounts
from backend.tests.test_migration_0002 import _alembic, _ok, scratch_db  # noqa: F401
from backend.tests.test_migration_0008 import _refused, _version, world  # noqa: F401


def _upload(world, candidate=None, content=b"x", **values) -> ResumeParse:
    kept = candidate is not None
    return ResumeParse(firm_id=world["firm"].id, uploaded_by_user_id=world["owner"].id,
                       candidate_id=candidate.id if kept else None, file_name="r.pdf", mime_type="application/pdf",
                       size_bytes=len(content), content=content, parse={},
                       expires_at=None if kept else utcnow() + timedelta(minutes=30), **values)


# ── resume_parses.content_sha256 ─────────────────────────────────────────────

def test_every_upload_gets_its_file_fingerprint_without_the_route_setting_it(test_db, world):
    row = _upload(world, content=b"%PDF-1.7 a resume")
    test_db.add(row)
    test_db.flush()
    assert row.content_sha256 == hashlib.sha256(b"%PDF-1.7 a resume").hexdigest() == file_sha256(row.content)


def test_a_candidate_keeps_a_file_once_but_drafts_and_other_candidates_may_have_it(test_db, world):
    # world["parse"] is Asha's kept upload of b"x".
    _refused(test_db, _upload(world, world["asha"]), "uq_resume_parses_candidate_file")
    test_db.add_all([_upload(world), _upload(world), _upload(world, world["ravi"])])
    test_db.flush()
    test_db.add(_upload(world, world["asha"], content=b"another file"))
    test_db.flush()


# ── base_resumes: one base per upload, per version; SET NULL; archived_at ────

def test_one_upload_gives_at_most_one_base(test_db, world):
    _refused(test_db, BaseResume(firm_id=world["firm"].id, candidate_id=world["asha"].id, source="UPLOAD",
                                 resume_parse_id=world["parse"].id, created_by_user_id=world["owner"].id),
             "uq_base_resumes_one_per_parse")


def test_one_version_gives_at_most_one_promoted_base(test_db, world):
    v3 = _version(world, version=3)
    test_db.add(v3)
    test_db.flush()
    promoted = dict(firm_id=world["firm"].id, candidate_id=world["asha"].id, source="PROMOTED",
                    promoted_from_resume_id=v3.id, created_by_user_id=world["owner"].id)
    test_db.add(BaseResume(**promoted))
    test_db.flush()
    _refused(test_db, BaseResume(**promoted), "uq_base_resumes_one_per_version")


def test_deleting_the_source_version_keeps_the_promoted_base(test_db, world):
    v2 = _version(world, version=2)
    test_db.add(v2)
    test_db.flush()
    base = BaseResume(firm_id=world["firm"].id, candidate_id=world["asha"].id, source="PROMOTED",
                      promoted_from_resume_id=v2.id, created_by_user_id=world["owner"].id)
    test_db.add(base)
    test_db.flush()
    test_db.execute(text("DELETE FROM resumes WHERE id = :id"), {"id": v2.id})
    test_db.refresh(base)
    assert base.promoted_from_resume_id is None


def test_a_base_starts_shown(test_db, world):
    test_db.refresh(world["base"])
    assert world["base"].archived_at is None and world["base"].promoted_from_resume_id is None


# ── upgrade and downgrade ────────────────────────────────────────────────────

def test_existing_uploads_are_fingerprinted_on_the_way_up_and_the_columns_go_on_the_way_down(scratch_db):
    name, engine = scratch_db
    _ok(_alembic(name, "upgrade", "0009"))
    with Session(engine) as db:
        accounts = seed_accounts(db)
        db.commit()
    parse_id = uuid.uuid4()
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO resume_parses (id, firm_id, uploaded_by_user_id, file_name, mime_type, "
                          "size_bytes, content, parse, expires_at) VALUES (:id, :firm, :user, 'r.pdf', "
                          "'application/pdf', 3, :content, '{}', now() + interval '30 minutes')"),
                     {"id": parse_id, "firm": accounts.firm_id, "user": accounts.user_id, "content": b"abc"})

    for _ in range(2):
        _ok(_alembic(name, "upgrade", "head"))
        with engine.connect() as conn:
            sha = conn.execute(text("SELECT content_sha256 FROM resume_parses WHERE id = :id"),
                               {"id": parse_id}).scalar_one()
        assert sha == hashlib.sha256(b"abc").hexdigest()
        _ok(_alembic(name, "downgrade", "0009"))
        assert "content_sha256" not in {c["name"] for c in inspect(engine).get_columns("resume_parses")}
        assert not {"promoted_from_resume_id", "archived_at"} & {c["name"] for c in
                                                                 inspect(engine).get_columns("base_resumes")}
