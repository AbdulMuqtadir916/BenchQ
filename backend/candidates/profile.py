"""The résumé's fields on a candidate's profile (07 Q57, migration 0017).

What the parser's strict format holds (name, email, phone, LinkedIn, city, state, country) is stored in `resumes`, not
in `candidates`. The profile reads it from the candidate's active base, newest version. `Candidate.full_name` and the
others are read-only views of that (`backend/models/candidates.py`); a value set on a new, unsaved candidate is kept
until its first base is written from it (`first_base`).
"""
from sqlalchemy.orm import load_only, object_session

# candidates' name → resumes column
FIELDS = {"full_name": "full_name", "email": "email", "phone": "phone", "linkedin_url": "linkedin",
          "city": "city", "state": "state", "country": "country"}
EMPTY = dict.fromkeys(FIELDS)


def _headers(db, firm_id, candidate_ids) -> dict:
    """{candidate_id: {field: value}} from each candidate's active base, newest live version."""
    from backend.auth.scoping import scoped
    from backend.models.candidates import BaseResume
    from backend.models.db import Resume
    ids = list(candidate_ids)
    if not ids:
        return {}
    rows = (scoped(db, Resume, firm_id).join(BaseResume, BaseResume.id == Resume.base_resume_id)
            .filter(Resume.candidate_id.in_(ids), BaseResume.is_active, BaseResume.deleted_at.is_(None),
                    Resume.category == "BASE", Resume.deleted_at.is_(None))
            .options(load_only(Resume.candidate_id, Resume.version, *(getattr(Resume, c) for c in FIELDS.values())))
            .order_by(Resume.candidate_id, Resume.version.desc()).all())
    out: dict = {}
    for r in rows:
        out.setdefault(r.candidate_id, {k: getattr(r, c) for k, c in FIELDS.items()})
    return out


def load(candidate) -> dict:
    db = object_session(candidate)
    if db is None or candidate.id is None:
        return dict(EMPTY)
    return _headers(db, candidate.firm_id, [candidate.id]).get(candidate.id, dict(EMPTY))


def prime(db, firm_id, candidates) -> None:
    """Read many candidates' fields in one query (a list), instead of one query each."""
    found = _headers(db, firm_id, [c.id for c in candidates])
    for c in candidates:
        c.__dict__["_resume_header"] = found.get(c.id, dict(EMPTY))


def refresh(candidate) -> None:
    """Forget the cached fields (after a new version or a base switch in the same request)."""
    candidate.__dict__.pop("_resume_header", None)
