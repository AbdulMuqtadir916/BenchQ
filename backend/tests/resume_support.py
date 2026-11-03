"""A résumé version for tests (docs/team/resume-versioning.md §3.3): since 0012 every `resumes` row belongs to a
candidate and a base, so a test that needs "a résumé" makes one here instead of a bare row."""
import uuid

from backend.models.candidates import BaseResume, Candidate
from backend.models.db import Resume
from backend.models.tenancy import User


def make_version(db, firm_id, *, candidate=None, candidate_name=None, category="BASE", job_id=None, version=1,
                 name="Base", active=True, id=None, **content) -> Resume:
    """A version on a base of `candidate` (a new candidate, with a manager of its own, when none is given). `content`
    fills the columns (`summary`, `experiences`, …); a TAILORED version needs `job_id`. Flushed, not committed."""
    if candidate is None:
        manager = User(firm_id=firm_id, role="MANAGER", name="Test manager",
                       email=f"manager-{uuid.uuid4().hex[:8]}@example.test", password_hash="x")
        db.add(manager)
        db.flush()
        candidate = Candidate(firm_id=firm_id, manager_id=manager.id, created_by_user_id=manager.id,
                              full_name=candidate_name or content.get("full_name") or "Test candidate",
                              work_auth="H1B")
        db.add(candidate)
        db.flush()
    base = db.query(BaseResume).filter(BaseResume.candidate_id == candidate.id, BaseResume.is_active).first()
    if base is None or not active:
        base = BaseResume(firm_id=firm_id, candidate_id=candidate.id, source="PROMOTED", is_active=active,
                          created_by_user_id=candidate.created_by_user_id)
        db.add(base)
        db.flush()
    row = Resume(firm_id=firm_id, candidate_id=candidate.id, base_resume_id=base.id, category=category,
                 job_id=job_id, version=version, name=name, created_by_user_id=candidate.created_by_user_id,
                 **({"id": id} if id is not None else {}), **content)
    db.add(row)
    db.flush()
    return row


def columns_from_json(data: dict) -> dict:
    """JobNavigator's json_data in the version columns: migration 0012's own mapping, so a test written with the old
    shape gets exactly what the migration would have made of it."""
    import importlib.util
    from pathlib import Path
    path = Path(__file__).resolve().parents[1] / "migrations" / "versions" / "0012_drop_legacy_resume_columns.py"
    spec = importlib.util.spec_from_file_location("_migration_0012", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.columns_from_json(data)


def old_resume(db, firm_id, name, json_data=None, *, is_base=True, job_id=None, **kw) -> Resume:
    """A test's old-style résumé (a name and JobNavigator's json_data) as a version: a base's v1, or a tailored
    résumé for `job_id`, of a new candidate called `name` (scoring labels a base with its candidate's name)."""
    return make_version(db, firm_id, name=name, candidate_name=name, category="BASE" if is_base else "TAILORED",
                        job_id=job_id, **columns_from_json(json_data or {}), **kw)
