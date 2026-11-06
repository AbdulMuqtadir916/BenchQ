"""A new candidate's first base résumé (docs/team/resume-versioning.md §4.2; PR 4).

Creating a candidate from an upload also writes, in the same transaction, a `base_resumes` row (UPLOAD, active, with
the parse it came from) and its version 1 in `resumes`. Version 1 takes the form's corrected values where the form
has the field, and the parse for the rest; `resume_parses.parse` keeps the AI's answer untouched. Every item gets an
id (§3.4) that later versions keep, so a claim follows its item from version to version.

A BDE's later upload (§4.6, PR 5) builds its base the same way, without a form: then everything comes from the parse.

"""
import uuid

from backend.candidates.base_resume import split_skills
from backend.models.candidates import BaseResume
from backend.models.db import Resume

BASE_NAME = "Base"
# The app's own labels for the form's codes (src/components/app/work-auth-chip.tsx WORK_AUTH_LABEL).
WORK_AUTH_LABEL = {"H1B": "H-1B", "H4_EAD": "H4 EAD", "OPT": "OPT", "CPT": "CPT", "GC": "Green Card",
                   "GC_EAD": "GC EAD", "USC": "US Citizen", "TN": "TN"}


def _id() -> str:
    return str(uuid.uuid4())


def _text(value) -> str:
    return str(value or "").strip()


def _list(value) -> list:
    return value if isinstance(value, list) else []


def _dicts(value) -> list[dict]:
    return [item for item in _list(value) if isinstance(item, dict)]


def _bullets(value) -> list[dict]:
    return [{"id": _id(), "text": _text(b)} for b in _list(value) if _text(b)]


def _entries(value, keys: tuple[str, ...]) -> list[dict]:
    """Award-like entries, each with an id; a bare string (an older parse) becomes the name."""
    out = []
    for item in _list(value):
        entry = {k: _text(item.get(k)) for k in keys} if isinstance(item, dict) else dict.fromkeys(keys, "") | {"name": _text(item)}
        if entry["name"]:
            out.append({"id": _id(), **entry})
    return out


def _form_header(candidate, body, header) -> dict:
    """The form, as the person corrected it, for what it holds."""
    return dict(
        full_name=candidate.full_name, title=candidate.primary_role, email=candidate.email, phone=candidate.phone,
        linkedin=candidate.linkedin_url, city=candidate.city, state=candidate.state, country=candidate.country,
        work_authorization=WORK_AUTH_LABEL.get(body.work_auth) or _text(header.get("work_authorization")) or None,
        summary=(body.summary or "").strip() or None,
        skills=[{"id": _id(), "category": _text(s.family), "name": s.name.strip()} for s in body.skills if s.name.strip()],
    )


def _parse_header(candidate, parse, header) -> dict:
    """The parse alone (a later upload has no form). The name falls back to the candidate's, which is never blank."""
    return dict(
        full_name=_text(header.get("name")) or candidate.full_name, title=_text(header.get("title")) or None,
        email=_text(header.get("email")) or None, phone=_text(header.get("phone")) or None,
        linkedin=_text(header.get("linkedin")) or None, city=_text(header.get("city")) or None,
        state=_text(header.get("state")) or None, country=_text(header.get("country")) or None,
        work_authorization=_text(header.get("work_authorization")) or None,
        summary=_text(parse.get("professional_summary")) or None,
        skills=[{"id": _id(), "category": _text(group.get("category")), "name": name}
                for group in _dicts(parse.get("technical_skills")) for name in split_skills(group.get("skills"))],
    )


def first_base(parse_row, candidate, body, created_by_user_id) -> tuple[BaseResume, Resume]:
    """The base and its version 1 for `candidate` from `parse_row` (a kept `resume_parses` row), active. Filled from
    the create form (`body`, as corrected) and the parse; with `body` None (a later upload, §4.6) from the parse
    alone. Every base starts from a file: a candidate is onboarded only with their résumé (07 Q58). Not added to the
    session: the caller does, in its transaction, after switching the previous base off."""
    parse = parse_row.parse if isinstance(parse_row.parse, dict) else {}
    header = parse.get("header") if isinstance(parse.get("header"), dict) else {}
    base = BaseResume(id=uuid.uuid4(), firm_id=candidate.firm_id, candidate_id=candidate.id, source="UPLOAD",
                      resume_parse_id=parse_row.id, is_active=True,
                      created_by_user_id=created_by_user_id)
    version = Resume(
        firm_id=candidate.firm_id, candidate_id=candidate.id, base_resume_id=base.id, name=BASE_NAME,
        category="BASE", version=1, created_by_user_id=created_by_user_id,
        **(_form_header(candidate, body, header) if body is not None else _parse_header(candidate, parse, header)),
        # The parse, for what the form doesn't hold.
        github=_text(header.get("github")) or None,
        experiences=[{"id": _id(), **{k: _text(r.get(k)) for k in ("job_title", "company", "location", "dates", "start",
                                                                    "end")},
                      "current": bool(r.get("current")), "bullets": _bullets(r.get("bullets"))}
                     for r in _dicts(parse.get("work_experience"))],
        projects=[{"id": _id(), **{k: _text(p.get(k)) for k in ("name", "url", "dates", "technologies")},
                   "bullets": _bullets(p.get("bullets"))} for p in _dicts(parse.get("projects"))],
        educations=[{"id": _id(), **{k: _text(e.get(k)) for k in ("degree", "institution", "graduation_date", "grade")}}
                    for e in _dicts(parse.get("education"))],
        certifications=_entries(parse.get("certifications"), ("name", "issuer", "date", "detail")),
        awards=_entries(parse.get("awards"), ("name", "issuer", "date", "detail")),
        languages=[{"id": _id(), "name": _text(lang)} for lang in _list(parse.get("languages")) if _text(lang)],
    )
    version.summary_id = _id() if version.summary else None     # the summary is an item too (§3.4)
    return base, version
