"""A firm's candidates (docs/candidate-onboarding/06-backend.md; 07 Q40–Q51). Firm-scoped: every path names the firm,
and another firm is the same 404 as a missing one (principle 4).

- POST /candidates/parse-resume: read a résumé into a draft for the new-candidate flow. Saves nothing about a
  candidate (07 Q49); the file and the answer wait 60 minutes for a create to keep them (`resume_parses`).
- GET /candidates, GET /candidates/{id}: in the principal's scope (07 Q47): the OWNER, a VIEWER and a support view
  the whole firm; a MANAGER the candidates they manage; a BDE the ones they work. Outside it is 404.
- POST /candidates: create, with its manager and optional BDE (Q41), skills and summary UNVERIFIED (Q49).
- PATCH /candidates/{id}: the candidate's details, every onboarding answer that isn't on the résumé (the "Additional
  candidate details" tab, decided 2026-11-14), by the résumé rule: the BDE once assigned, else the OWNER and MANAGER.
  The target role and the extra search titles are not among them: fixed once the candidate is added (07 Q68).
- POST /candidates/{id}/assign: move it to another manager and/or BDE (Q43).
Assigning a BDE to a candidate that had none is blocked at the plan's candidate limit (Q45), and a BDE holds at most
`BDE_CANDIDATE_LIMIT` candidates (07 Q70). Every assignment change is one ASSIGN ledger entry, with the handoff note.
"""
import asyncio
import re
import uuid
from datetime import datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import func
from sqlalchemy.orm import Session as DbSession

from backend.api.routes_auth import current_principal
from backend.auth import ledger
from backend.auth.invites import lock_firm
from backend.auth.policy import can_assign_to, can_edit_profile, require
from backend.auth.scoping import own_scope, scoped, team_scope
from backend.auth.sessions import Principal
from backend.candidates.first_base import first_base
from backend.candidates.profile_links import ProfileLink
from backend.candidates.parse import DOCX_MIME, MAX_BYTES, PDF_MIME, extract_text, file_kind, read_resume
from backend.candidates import profile
from backend.candidates.serialize import candidate_json
from backend.job_search import workday
from backend.match import store as match_store
from backend.models.candidates import (EMPLOYMENT_TYPES, REMOTE_MODES, WORK_AUTHS, WORKING_STATUSES, Candidate,
                                       ResumeParse)
from backend.models.db import get_db, utcnow
from backend.models.tenancy import Firm, User

router = APIRouter(prefix="/firms/{firm_id}/candidates", tags=["candidates"])

PARSE_LIFETIME = timedelta(minutes=60)
# 07 Q70 (2026-11-18): a BDE holds at most 3 candidates at a time, every status counted (a placed one too) until it is
# moved. The frontend's BDE_CANDIDATE_LIMIT (src/lib/derive/assignment.ts) says the same.
BDE_CANDIDATE_LIMIT = 3
BDE_FULL = f"This BDE has {BDE_CANDIDATE_LIMIT} candidates."
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
PLACE_NEEDED = "Add a preferred location, or the candidate's city and state: the job search needs a place."
PLACE_NEEDED_ON_EDIT = "Add a preferred location, or the city and state on the candidate's résumé: the job search needs a place."

WorkAuth = Literal[WORK_AUTHS]
EmploymentType = Literal[EMPLOYMENT_TYPES]
RemoteMode = Literal[REMOTE_MODES]
Text200 = Field(default=None, max_length=200)
# A required text: trimmed, then not blank. A missing field or a blank one is a 422 that names the field.
Required200 = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]


class SkillIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    family: str | None = Field(default=None, max_length=100)


class CreateCandidateBody(BaseModel):
    """The frontend's CreateCandidateSchema (docs/02 §4) in snake_case. The mandatory fields have no default: the
    request is refused (422, naming the field) when one is missing. Nothing is worked out here: the new-candidate flow
    sends `needs_sponsorship` and `needs_transfer` itself."""
    full_name: Required200
    primary_role: Required200
    email: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=320)]
    phone: Required200
    linkedin_url: ProfileLink = None
    city: str | None = Text200
    state: str | None = Text200
    country: Required200
    years_experience: float = Field(ge=0, le=60)
    work_auth: WorkAuth
    work_auth_expiry: datetime | None = None
    needs_sponsorship: bool
    needs_transfer: bool
    employment_types: list[EmploymentType] = Field(min_length=1)
    rate_target: float | None = Field(default=None, gt=0)
    rate_min: float | None = Field(default=None, gt=0)
    available_from: datetime | None = None
    notice_period_days: int | None = Field(default=None, ge=0, le=365)
    target_roles: list[Required200] = Field(min_length=1, max_length=1)     # one (decided 2026-11-14, Q1, Q10)
    willing_to_relocate: bool = False
    work_settings: list[RemoteMode] = Field(default_factory=list)
    preferred_locations: list[str] = Field(default_factory=list, max_length=50)
    contact_notes: str | None = Field(default=None, max_length=2000)
    summary: str | None = Field(default=None, max_length=5000)
    skills: list[SkillIn] = Field(default_factory=list, max_length=200)
    preferred_industries: list[str] = Field(default_factory=list, max_length=50)
    deal_breakers: list[str] = Field(default_factory=list, max_length=50)
    resume_parse_id: uuid.UUID | None = None
    manager_id: uuid.UUID
    bde_id: uuid.UUID | None = None
    handoff_note: str | None = Field(default=None, max_length=1000)


class UpdateCandidateBody(BaseModel):
    """The frontend's UpdateCandidateSchema: the candidate's details, every onboarding answer that isn't on the résumé
    (decided 2026-11-14, Q18). Only the fields sent change. The same rules as onboarding (Q20): at least one engagement
    type, and a place for the job search afterwards. The name, email, target role and extra search titles are fixed
    once the candidate is added (07 Q68, 2026-11-18): a request that sends one is refused (422, extra fields)."""
    model_config = ConfigDict(extra="forbid")

    primary_role: Required200 | None = None
    years_experience: float | None = Field(default=None, ge=0, le=60)
    work_auth: WorkAuth | None = None
    work_auth_expiry: datetime | None = None
    # A changed work_auth must come with both (the flow sends all three together); nothing is worked out here.
    needs_sponsorship: bool | None = None
    needs_transfer: bool | None = None
    employment_types: list[EmploymentType] | None = Field(default=None, min_length=1)
    rate_target: float | None = Field(default=None, gt=0)
    rate_min: float | None = Field(default=None, gt=0)
    available_from: datetime | None = None
    notice_period_days: int | None = Field(default=None, ge=0, le=365)
    work_settings: list[RemoteMode] | None = None
    preferred_locations: list[str] | None = Field(default=None, max_length=50)
    willing_to_relocate: bool | None = None
    preferred_industries: list[str] | None = Field(default=None, max_length=50)
    deal_breakers: list[str] | None = Field(default=None, max_length=50)
    contact_notes: str | None = Field(default=None, max_length=2000)


# The candidate's fields the Match score reads (backend/match/score.py `who`): an edit to one scores their jobs again.
_SCORED = {"primary_role", "years_experience", "work_auth", "needs_sponsorship", "needs_transfer", "employment_types"}
# The fields an edit can't empty (null): the rest (expiry, rates, availability, notice, notes) can be cleared.
_NOT_NULL = ("primary_role", "years_experience", "work_auth", "needs_sponsorship", "needs_transfer",
             "employment_types", "work_settings", "preferred_locations", "willing_to_relocate", "preferred_industries",
             "deal_breakers")


class AssignBody(BaseModel):
    """The frontend's ReassignCandidateSchema."""
    manager_id: uuid.UUID
    bde_id: uuid.UUID | None = None
    note: str | None = Field(default=None, max_length=1000)


def _bad(detail: str) -> HTTPException:
    return HTTPException(status_code=400, detail=detail)


def _not_found() -> HTTPException:
    return HTTPException(status_code=404, detail="Not found.")


def _clean(value: str | None) -> str | None:
    value = (value or "").strip()
    return value or None


def _firm_user(db: DbSession, firm_id: uuid.UUID, user_id: uuid.UUID | None) -> User | None:
    if user_id is None:
        return None
    return db.query(User).filter(User.id == user_id, User.firm_id == firm_id).first()


def _visible(db: DbSession, firm_id: uuid.UUID, principal: Principal):
    """The firm's candidates the principal may see (07 Q47)."""
    query = scoped(db, Candidate, firm_id)
    if (manager_id := team_scope(principal)) is not None:
        query = query.filter(Candidate.manager_id == manager_id)
    if (user_id := own_scope(principal)) is not None:
        query = query.filter(Candidate.bde_id == user_id)
    return query


def _candidate(db: DbSession, firm_id: uuid.UUID, principal: Principal, candidate_id: uuid.UUID,
               lock: bool = False) -> Candidate:
    query = _visible(db, firm_id, principal).filter(Candidate.id == candidate_id)
    candidate = (query.with_for_update() if lock else query).first()
    if candidate is None:
        raise _not_found()
    return candidate


def assign_block_reason(used: int, limit: int) -> str:
    """Word for word the frontend's assignBlockReason (docs/candidate-onboarding/02-hierarchy-and-seats.md §2)."""
    return (f"Your plan allows {limit} assigned candidate{'' if limit == 1 else 's'}; {used} "
            f"{'is' if used == 1 else 'are'} assigned. Hand this candidate to a manager instead, or free a slot.")


def _check_limit(db: DbSession, firm: Firm) -> None:
    """07 Q45: a candidate counts once a BDE is assigned and its status is working. The caller holds the firm lock."""
    used = scoped(db, Candidate, firm.id, func.count(Candidate.id)) \
        .filter(Candidate.bde_id.isnot(None), Candidate.status.in_(WORKING_STATUSES)).scalar()
    if used >= firm.candidate_limit:
        raise HTTPException(status_code=409, detail=assign_block_reason(used, firm.candidate_limit))


def _check_bde_limit(db: DbSession, firm_id: uuid.UUID, bde_id: uuid.UUID) -> None:
    """07 Q70: the BDE already holds `BDE_CANDIDATE_LIMIT` candidates (any status): 409. The caller holds the firm lock,
    so two assignments to the same BDE at once can't both pass. A BDE already above it keeps them."""
    held = scoped(db, Candidate, firm_id, func.count(Candidate.id)).filter(Candidate.bde_id == bde_id).scalar()
    if held >= BDE_CANDIDATE_LIMIT:
        raise HTTPException(status_code=409, detail=BDE_FULL)


def _target(db: DbSession, firm_id: uuid.UUID, principal: Principal, current_manager_id: uuid.UUID | None,
            manager_id: uuid.UUID, bde_id: uuid.UUID | None) -> tuple[User, User | None]:
    manager = _firm_user(db, firm_id, manager_id)
    bde = _firm_user(db, firm_id, bde_id)
    if manager is None or (bde_id is not None and bde is None):
        raise _not_found()
    if not can_assign_to(principal, current_manager_id, manager, bde):
        raise HTTPException(status_code=403, detail="You can't give this candidate to that manager or BDE.")
    return manager, bde


def _assign_summary(manager: User, bde: User | None, before: str | None) -> str:
    text = f"Assigned to {bde.name} ({manager.name})" if bde else f"Handed to {manager.name}"
    return f"{text} (from {before})" if before else text


def _member_of(firm_id: uuid.UUID, principal: Principal) -> None:
    """The principal must belong to the firm the path names (writes: a support view is refused before this)."""
    if (principal.firm_id or principal.support_firm_id) != firm_id:
        raise HTTPException(status_code=404, detail="Not found.")


@router.post("/parse-resume", summary="Read a résumé into a draft (saves nothing about a candidate)")
async def parse_resume(firm_id: uuid.UUID, file: UploadFile = File(...),
                       principal: Principal = Depends(require("candidate.create")), db: DbSession = Depends(get_db)):
    """PDF or DOCX, up to 10 MB. Returns `{parse_id, file_name, parse}` with `parse` in Zuhair's format; the create
    sends `resume_parse_id` back to keep the file (06 §4)."""
    _member_of(firm_id, principal)
    content = await file.read(MAX_BYTES + 1)
    kind = file_kind(file.filename or "", content)
    # Reading a PDF is CPU work; off the event loop, so other firms' requests aren't held behind it.
    text = await asyncio.to_thread(extract_text, kind, content)
    parse = await read_resume(text, kind, db, firm_id=firm_id)
    now = utcnow()
    # Parses nobody created a candidate from are deleted once they expire; this firm's, on each new read.
    scoped(db, ResumeParse, firm_id).filter(ResumeParse.candidate_id.is_(None), ResumeParse.expires_at < now) \
        .delete(synchronize_session=False)
    row = ResumeParse(firm_id=firm_id, uploaded_by_user_id=principal.user_id, file_name=(file.filename or "")[:255],
                      mime_type=PDF_MIME if kind == "pdf" else DOCX_MIME, size_bytes=len(content), content=content,
                      parse=parse, expires_at=now + PARSE_LIFETIME)
    db.add(row)
    db.commit()
    return {"parse_id": str(row.id), "file_name": row.file_name, "parse": parse}


@router.get("", summary="The firm's candidates, in the principal's scope")
def list_candidates(firm_id: uuid.UUID, principal: Principal = Depends(current_principal),
                    db: DbSession = Depends(get_db)):
    _member_of(firm_id, principal)
    rows = _visible(db, firm_id, principal).order_by(Candidate.created_at.desc()).all()
    profile.prime(db, firm_id, rows)            # the résumé's fields for the whole list in one query (07 Q57)
    return [candidate_json(c, principal) for c in rows]


@router.get("/{candidate_id}", summary="One candidate, if in the principal's scope")
def get_candidate(firm_id: uuid.UUID, candidate_id: uuid.UUID, principal: Principal = Depends(current_principal),
                  db: DbSession = Depends(get_db)):
    _member_of(firm_id, principal)
    return candidate_json(_candidate(db, firm_id, principal, candidate_id), principal)


@router.post("", status_code=201, summary="Add a candidate with its manager and optional BDE")
def create_candidate(firm_id: uuid.UUID, body: CreateCandidateBody, background: BackgroundTasks,
                     principal: Principal = Depends(require("candidate.create")), db: DbSession = Depends(get_db)):
    """One transaction: the candidate (ON_BENCH), the kept résumé parse with the candidate's first base résumé and its
    version 1 (07 Q58: never without the résumé), their Record (one UNVERIFIED claim per item,
    07 Q49), and the CREATE and ASSIGN ledger entries."""
    _member_of(firm_id, principal)
    email = body.email.lower()
    if not EMAIL.match(email):
        raise _bad("Enter a valid email.")
    if body.rate_min is not None and body.rate_target is not None and body.rate_min > body.rate_target:
        raise _bad("The floor can't be above the target rate.")
    # The job search needs a place (decided 2026-11-14, Q3, Q14): the city and state together, or a preferred location.
    if not ((_clean(body.city) and _clean(body.state)) or any(p.strip() for p in body.preferred_locations)):
        raise _bad(PLACE_NEEDED)
    firm = lock_firm(db, firm_id)
    manager, bde = _target(db, firm_id, principal, None, body.manager_id, body.bde_id)
    if bde is not None:
        _check_limit(db, firm)
        _check_bde_limit(db, firm_id, bde.id)
    # 07 Q58 (Abdul, 2026-11-06): a candidate is onboarded only with their résumé.
    if body.resume_parse_id is None:
        raise _bad("Upload the candidate's résumé first: a candidate can't be added without one.")
    parse = scoped(db, ResumeParse, firm_id).filter(
        ResumeParse.id == body.resume_parse_id, ResumeParse.candidate_id.is_(None),
        ResumeParse.expires_at > utcnow()).with_for_update().first()
    if parse is None:
        raise HTTPException(status_code=404, detail="That résumé read has expired. Upload it again.")

    now = utcnow()
    candidate = Candidate(
        firm_id=firm_id, manager_id=manager.id, bde_id=bde.id if bde else None, created_by_user_id=principal.user_id,
        full_name=body.full_name, email=email, phone=body.phone, linkedin_url=_clean(body.linkedin_url),
        city=_clean(body.city), state=_clean(body.state), country=body.country, willing_to_relocate=body.willing_to_relocate,
        work_auth=body.work_auth, work_auth_expiry=body.work_auth_expiry,
        needs_sponsorship=body.needs_sponsorship, needs_transfer=body.needs_transfer,
        employment_types=list(dict.fromkeys(body.employment_types)),
        rate_min=body.rate_min, rate_target=body.rate_target, status="ON_BENCH", bench_start_date=now,
        available_from=body.available_from, notice_period_days=body.notice_period_days,
        years_experience=body.years_experience, primary_role=body.primary_role,
        target_roles=list(dict.fromkeys(body.target_roles)),
        work_settings=list(dict.fromkeys(body.work_settings)),
        preferred_locations=[p.strip() for p in body.preferred_locations if p.strip()],
        contact_notes=_clean(body.contact_notes),
        preferred_industries=[i.strip() for i in body.preferred_industries if i.strip()],
        deal_breakers=[d.strip() for d in body.deal_breakers if d.strip()],
    )
    # A BDE from the start: their Day 1 starts now (decided 2026-11-17, Q155, Q164).
    workday.assign(candidate, candidate.bde_id, now, workday.of(firm))
    db.add(candidate)
    db.flush()
    parse.candidate_id, parse.expires_at = candidate.id, None
    # Their first base résumé and its version 1, in this same transaction (resume-versioning.md §4.2): from the file
    # and the form. Then
    # their Record: one UNVERIFIED claim per item of that version (docs/team/zuhair.md §1.3).
    base, version = first_base(parse, candidate, body, principal.user_id)
    db.add(base)
    db.flush()
    db.add(version)
    db.flush()
    actor = db.get(User, principal.user_id)
    ledger.record(db, actor=actor, action="CREATE", entity_type="candidate", entity_id=candidate.id,
                  entity_label=candidate.full_name, firm_id=firm_id, summary=f"Added {candidate.full_name}", candidate_id=candidate.id)
    ledger.record(db, actor=actor, action="ASSIGN", entity_type="candidate", entity_id=candidate.id,
                  entity_label=candidate.full_name, firm_id=firm_id, summary=_assign_summary(manager, bde, None),
                  note=_clean(body.handoff_note), candidate_id=candidate.id)
    db.commit()
    # The job search's 2 extra titles for the target role, after the answer (decided 2026-11-17, Q131).
    from backend.job_search import search_titles
    background.add_task(search_titles.generate, firm_id, candidate.id)
    return candidate_json(candidate, principal)


def _edited(changes: dict) -> dict:
    """The sent values as stored: text trimmed, blank list items dropped, each list without repeats."""
    out = dict(changes)
    for field in ("work_settings", "employment_types"):
        if out.get(field) is not None:
            out[field] = list(dict.fromkeys(out[field]))
    for field in ("preferred_locations", "preferred_industries", "deal_breakers"):
        if out.get(field) is not None:
            out[field] = list(dict.fromkeys(item.strip() for item in out[field] if item.strip()))
    if "contact_notes" in out:
        out["contact_notes"] = _clean(out["contact_notes"])
    return out


@router.patch("/{candidate_id}", summary="Edit a candidate's details (every onboarding answer not on the résumé)")
def update_candidate(firm_id: uuid.UUID, candidate_id: uuid.UUID, body: UpdateCandidateBody, background: BackgroundTasks,
                     principal: Principal = Depends(require("candidate.editProfile")), db: DbSession = Depends(get_db)):
    """Decided 2026-11-14 (Q17, reversing 07 Q56): the résumé rule (Q55): the candidate's BDE once one is assigned;
    before that the OWNER and the candidate's MANAGER. One UPDATE ledger entry naming the fields that changed. The
    target role and the extra search titles can't be sent (07 Q68)."""
    _member_of(firm_id, principal)
    candidate = _candidate(db, firm_id, principal, candidate_id, lock=True)
    if not can_edit_profile(principal, candidate):
        raise HTTPException(status_code=403, detail="This candidate's BDE edits their details; you can view them.")
    changes = _edited(body.model_dump(exclude_unset=True))
    before = {field: getattr(candidate, field) for field in changes}
    for field, value in changes.items():
        if value is None and field in _NOT_NULL:
            raise _bad(f"{field} can't be empty.")
    # Nothing is worked out here: a changed work authorization comes with both values, or it is refused.
    if "work_auth" in changes and changes["work_auth"] != candidate.work_auth:
        missing = [f for f in ("needs_sponsorship", "needs_transfer") if f not in changes]
        if missing:
            raise _bad(f"A new work_auth needs {' and '.join(missing)} in the same request.")
    changed = [field for field, value in changes.items() if getattr(candidate, field) != value]
    for field in changed:
        setattr(candidate, field, changes[field])
    if candidate.rate_min is not None and candidate.rate_target is not None and candidate.rate_min > candidate.rate_target:
        raise _bad("The floor can't be above the target rate.")
    # The job search needs a place (Q20): the résumé's city and state together, or a preferred location.
    if changed and not ((candidate.city and candidate.state) or candidate.preferred_locations):
        raise _bad(PLACE_NEEDED_ON_EDIT)
    if changed:
        ledger.record(db, actor=db.get(User, principal.user_id), action="UPDATE", entity_type="candidate",
                      entity_id=candidate.id, entity_label=candidate.full_name, firm_id=firm_id,
                      summary=f"Updated {', '.join(f.replace('_', ' ') for f in changed)}", candidate_id=candidate.id,
                      changes=ledger.diff(before, changes))
        db.commit()
        if set(changed) & _SCORED:
            match_store.rescore_later(background, firm_id, candidate_id)   # what the Match reads (Q35)
    return candidate_json(candidate, principal)


@router.post("/{candidate_id}/assign", summary="Move a candidate to another manager and/or BDE")
def assign_candidate(firm_id: uuid.UUID, candidate_id: uuid.UUID, body: AssignBody,
                     principal: Principal = Depends(require("candidate.assign")), db: DbSession = Depends(get_db)):
    """07 Q43: the OWNER moves a candidate to any manager and optionally one of their BDEs (no BDE: that manager's
    queue); a MANAGER only between their own BDEs. Applications and history stay with the candidate."""
    _member_of(firm_id, principal)
    firm = lock_firm(db, firm_id)
    candidate = _candidate(db, firm_id, principal, candidate_id, lock=True)
    manager, bde = _target(db, firm_id, principal, candidate.manager_id, body.manager_id, body.bde_id)
    new_bde_id = bde.id if bde else None
    if (candidate.manager_id, candidate.bde_id) == (manager.id, new_bde_id):
        return candidate_json(candidate, principal)
    if new_bde_id is not None and candidate.bde_id is None and candidate.status in WORKING_STATUSES:
        _check_limit(db, firm)                 # a queue candidate getting a BDE starts to count (Q45)
    if new_bde_id is not None and candidate.bde_id != new_bde_id:
        _check_bde_limit(db, firm_id, new_bde_id)   # 07 Q70: the BDE it goes to
    previous = _firm_user(db, firm_id, candidate.bde_id) or _firm_user(db, firm_id, candidate.manager_id)
    before = {"manager_id": candidate.manager_id, "bde_id": candidate.bde_id}
    candidate.manager_id = manager.id
    if candidate.bde_id != new_bde_id:
        # A new BDE starts again at Day 1; no BDE has no Days (decided 2026-11-17, Q154, Q155, Q174).
        workday.assign(candidate, new_bde_id, utcnow(), workday.of(firm))
    ledger.record(db, actor=db.get(User, principal.user_id), action="ASSIGN", entity_type="candidate",
                  entity_id=candidate.id, entity_label=candidate.full_name, firm_id=firm_id,
                  summary=_assign_summary(manager, bde, previous.name if previous else None), note=_clean(body.note), candidate_id=candidate.id,
                  changes=ledger.diff(before, {"manager_id": manager.id, "bde_id": new_bde_id}))
    db.commit()
    return candidate_json(candidate, principal)
