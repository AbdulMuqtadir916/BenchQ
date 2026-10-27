"""A firm's candidates (docs/candidate-onboarding/06-backend.md; 07 Q40–Q51). Firm-scoped: every path names the firm,
and another firm is the same 404 as a missing one (principle 4).

- POST /candidates/parse-resume: read a résumé into a draft for the new-candidate flow. Saves nothing about a
  candidate (07 Q49); the file and the answer wait 60 minutes for a create to keep them (`resume_parses`).
- GET /candidates, GET /candidates/{id}: in the principal's scope (07 Q47): the OWNER, a VIEWER and a support view
  the whole firm; a MANAGER the candidates they manage; a BDE the ones they work. Outside it is 404.
- POST /candidates: create, with its manager and optional BDE (Q41), skills and summary UNVERIFIED (Q49).
- PATCH /candidates/{id}: the submission facts (the frontend's UpdateCandidateSchema).
- POST /candidates/{id}/assign: move it to another manager and/or BDE (Q43).
Assigning a BDE to a candidate that had none is blocked at the plan's candidate limit (Q45). Every assignment change
is one ASSIGN ledger entry, with the handoff note.
"""
import re
import uuid
from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session as DbSession

from backend.api.routes_auth import current_principal
from backend.auth import ledger
from backend.auth.invites import lock_firm
from backend.auth.policy import can_assign_to, require
from backend.auth.scoping import own_scope, scoped, team_scope
from backend.auth.sessions import Principal
from backend.candidates.parse import DOCX_MIME, MAX_BYTES, PDF_MIME, extract_text, file_kind, read_resume
from backend.candidates.serialize import candidate_json
from backend.models.candidates import (EMPLOYMENT_TYPES, REMOTE_MODES, WORK_AUTHS, WORKING_STATUSES, Candidate,
                                       ResumeParse)
from backend.models.db import get_db, utcnow
from backend.models.tenancy import Firm, User

router = APIRouter(prefix="/firms/{firm_id}/candidates", tags=["candidates"])

PARSE_LIFETIME = timedelta(minutes=60)
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

WorkAuth = Literal[WORK_AUTHS]
EmploymentType = Literal[EMPLOYMENT_TYPES]
RemoteMode = Literal[REMOTE_MODES]
Text200 = Field(default=None, max_length=200)


class SkillIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    family: str | None = Field(default=None, max_length=100)
    source: Literal["RESUME_UPLOAD", "MANUAL"]


class CreateCandidateBody(BaseModel):
    """The frontend's CreateCandidateSchema (docs/02 §4) in snake_case."""
    full_name: str = Field(min_length=1, max_length=200)
    primary_role: str = Field(min_length=1, max_length=200)
    email: str = Field(max_length=320)
    phone: str | None = Text200
    linkedin_url: str | None = Field(default=None, max_length=500)
    city: str | None = Text200
    state: str | None = Text200
    years_experience: float | None = Field(default=None, ge=0, le=60)
    work_auth: WorkAuth
    work_auth_expiry: datetime | None = None
    needs_sponsorship: bool = False
    needs_transfer: bool = False
    employment_types: list[EmploymentType] = Field(default_factory=list)
    rate_target: float | None = Field(default=None, gt=0)
    rate_min: float | None = Field(default=None, gt=0)
    available_from: datetime | None = None
    notice_period_days: int | None = Field(default=None, ge=0, le=365)
    target_roles: list[str] = Field(default_factory=list, max_length=50)
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
    """The frontend's UpdateCandidateSchema: the submission facts a BDE edits."""
    work_auth: WorkAuth | None = None
    work_auth_expiry: datetime | None = None
    rate_target: float | None = Field(default=None, gt=0)
    rate_min: float | None = Field(default=None, gt=0)
    available_from: datetime | None = None
    notice_period_days: int | None = Field(default=None, ge=0, le=365)
    willing_to_relocate: bool | None = None
    employment_types: list[EmploymentType] | None = None


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
    """PDF or Word, up to 10 MB. Returns `{parse_id, file_name, parse}` with `parse` in Zuhair's format; the create
    sends `resume_parse_id` back to keep the file (06 §4)."""
    _member_of(firm_id, principal)
    content = await file.read(MAX_BYTES + 1)
    kind = file_kind(file.filename or "", content)
    parse = await read_resume(extract_text(kind, content), db)
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
    return [candidate_json(c) for c in _visible(db, firm_id, principal).order_by(Candidate.created_at.desc())]


@router.get("/{candidate_id}", summary="One candidate, if in the principal's scope")
def get_candidate(firm_id: uuid.UUID, candidate_id: uuid.UUID, principal: Principal = Depends(current_principal),
                  db: DbSession = Depends(get_db)):
    _member_of(firm_id, principal)
    return candidate_json(_candidate(db, firm_id, principal, candidate_id))


@router.post("", status_code=201, summary="Add a candidate with its manager and optional BDE")
def create_candidate(firm_id: uuid.UUID, body: CreateCandidateBody,
                     principal: Principal = Depends(require("candidate.create")), db: DbSession = Depends(get_db)):
    """One transaction: the candidate (ON_BENCH), the kept résumé parse, and the CREATE and ASSIGN ledger entries.
    Skills and the summary are stored UNVERIFIED with their source (07 Q49)."""
    _member_of(firm_id, principal)
    email = body.email.strip().lower()
    if not EMAIL.match(email):
        raise _bad("Enter a valid email.")
    if body.rate_min is not None and body.rate_target is not None and body.rate_min > body.rate_target:
        raise _bad("The floor can't be above the target rate.")
    firm = lock_firm(db, firm_id)
    manager, bde = _target(db, firm_id, principal, None, body.manager_id, body.bde_id)
    if bde is not None:
        _check_limit(db, firm)
    parse = None
    if body.resume_parse_id is not None:
        parse = scoped(db, ResumeParse, firm_id).filter(
            ResumeParse.id == body.resume_parse_id, ResumeParse.candidate_id.is_(None),
            ResumeParse.expires_at > utcnow()).with_for_update().first()
        if parse is None:
            raise HTTPException(status_code=404, detail="That résumé read has expired. Upload it again.")

    now = utcnow()
    candidate = Candidate(
        firm_id=firm_id, manager_id=manager.id, bde_id=bde.id if bde else None, created_by_user_id=principal.user_id,
        full_name=body.full_name.strip(), email=email, phone=_clean(body.phone), linkedin_url=_clean(body.linkedin_url),
        city=_clean(body.city), state=_clean(body.state), willing_to_relocate=body.willing_to_relocate,
        work_auth=body.work_auth, work_auth_expiry=body.work_auth_expiry, needs_sponsorship=body.needs_sponsorship,
        needs_transfer=body.needs_transfer, employment_types=list(dict.fromkeys(body.employment_types)),
        rate_min=body.rate_min, rate_target=body.rate_target, status="ON_BENCH", bench_start_date=now,
        available_from=body.available_from, notice_period_days=body.notice_period_days,
        years_experience=body.years_experience, primary_role=body.primary_role.strip(),
        target_roles=[r.strip() for r in body.target_roles if r.strip()] or [body.primary_role.strip()],
        work_settings=list(dict.fromkeys(body.work_settings)),
        preferred_locations=[p.strip() for p in body.preferred_locations if p.strip()],
        contact_notes=_clean(body.contact_notes),
        persona={"summary": _clean(body.summary) or "", "tone_notes": None, "will_relocate": body.willing_to_relocate,
                 "notice_period_days": body.notice_period_days, "preferred_industries": body.preferred_industries,
                 "deal_breakers": body.deal_breakers},
        skills=[{"name": s.name.strip(), "family": _clean(s.family), "source": s.source, "state": "UNVERIFIED"}
                for s in body.skills],
        summary_state="UNVERIFIED",
    )
    db.add(candidate)
    db.flush()
    if parse is not None:
        parse.candidate_id, parse.expires_at = candidate.id, None
    actor = db.get(User, principal.user_id)
    ledger.record(db, actor=actor, action="CREATE", entity_type="candidate", entity_id=candidate.id,
                  entity_label=candidate.full_name, firm_id=firm_id, summary=f"Added {candidate.full_name}")
    ledger.record(db, actor=actor, action="ASSIGN", entity_type="candidate", entity_id=candidate.id,
                  entity_label=candidate.full_name, firm_id=firm_id, summary=_assign_summary(manager, bde, None),
                  note=_clean(body.handoff_note))
    db.commit()
    return candidate_json(candidate)


@router.patch("/{candidate_id}", summary="Edit a candidate's submission facts")
def update_candidate(firm_id: uuid.UUID, candidate_id: uuid.UUID, body: UpdateCandidateBody,
                     principal: Principal = Depends(require("candidate.edit")), db: DbSession = Depends(get_db)):
    _member_of(firm_id, principal)
    candidate = _candidate(db, firm_id, principal, candidate_id, lock=True)
    changes = body.model_dump(exclude_unset=True)
    for field, value in changes.items():
        if value is None and field in ("work_auth", "willing_to_relocate", "employment_types"):
            raise _bad(f"{field} can't be empty.")
        setattr(candidate, field, value)
    if candidate.rate_min is not None and candidate.rate_target is not None and candidate.rate_min > candidate.rate_target:
        raise _bad("The floor can't be above the target rate.")
    if changes:
        ledger.record(db, actor=db.get(User, principal.user_id), action="UPDATE", entity_type="candidate",
                      entity_id=candidate.id, entity_label=candidate.full_name, firm_id=firm_id,
                      summary=f"Updated {', '.join(f.replace('_', ' ') for f in changes)}")
        db.commit()
    return candidate_json(candidate)


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
        return candidate_json(candidate)
    if new_bde_id is not None and candidate.bde_id is None and candidate.status in WORKING_STATUSES:
        _check_limit(db, firm)                 # a queue candidate getting a BDE starts to count (Q45)
    previous = _firm_user(db, firm_id, candidate.bde_id) or _firm_user(db, firm_id, candidate.manager_id)
    candidate.manager_id, candidate.bde_id = manager.id, new_bde_id
    ledger.record(db, actor=db.get(User, principal.user_id), action="ASSIGN", entity_type="candidate",
                  entity_id=candidate.id, entity_label=candidate.full_name, firm_id=firm_id,
                  summary=_assign_summary(manager, bde, previous.name if previous else None), note=_clean(body.note))
    db.commit()
    return candidate_json(candidate)
