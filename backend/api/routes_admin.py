"""The platform tier's firms, plans, users, invites, platform team and audit log (docs/04 §14, docs/07 §2.3): Super Admin only (backend/auth/access.py
classifies every route here PLATFORM), each write gated by its platform action and logged in the ledger.
The frontend mock is the spec: src/mocks/platform.ts."""
import uuid
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DbSession

from backend.auth import ledger, support
from backend.auth.invites import (bad_request, check_email_free, conflict, invite_json, normal_email, resend_invite,
                                  revoke_invite, send_invite, slug_problem)
from backend.auth.policy import require
from backend.auth.serialize import firm_json, ledger_entry_json, platform_user_json, user_json
from backend.auth.sessions import Principal
from backend.models.db import get_db, utcnow
from backend.models.tenancy import Firm, Invite, LedgerEntry, Plan, PlatformUser, User

router = APIRouter(prefix="/admin", tags=["admin"])


def plan_json(plan: Plan) -> dict:
    return {"id": str(plan.id), "name": plan.name, "seat_limit": plan.seat_limit,
            "candidate_limit": plan.candidate_limit, "features": list(plan.features or []), "is_active": plan.is_active}


def _not_found(what: str) -> HTTPException:
    return HTTPException(status_code=404, detail=f"{what} not found")


def _get(db: DbSession, model, id_: uuid.UUID, what: str):
    row = db.get(model, id_)
    if row is None:
        raise _not_found(what)
    return row


def _timezone(name: str) -> str:
    try:
        ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        raise bad_request(f"Unknown timezone: {name}")
    return name


# ── Plans ────────────────────────────────────────────────────────────────────

@router.get("/plans", summary="Every plan")
def list_plans(db: DbSession = Depends(get_db)):
    return [plan_json(p) for p in db.query(Plan).order_by(Plan.created_at, Plan.name)]


# ── Firms ────────────────────────────────────────────────────────────────────

class CreateFirmBody(BaseModel):
    """docs/04 §14.4 Create firm. The owner's name becomes the invite's invitee_name (07 Q31)."""
    name: str = Field(max_length=200)
    slug: str = Field(max_length=64)
    plan_id: uuid.UUID
    primary_timezone: str = Field(default="Asia/Kolkata", max_length=64)
    client_timezone: str = Field(default="America/New_York", max_length=64)
    contact_phone: str | None = Field(default=None, max_length=40)
    owner_name: str = Field(max_length=200)
    owner_email: str = Field(max_length=320)


@router.get("/firms", summary="Every firm")
def list_firms(db: DbSession = Depends(get_db)):
    return [firm_json(f) for f in db.query(Firm).order_by(Firm.created_at, Firm.name)]


@router.get("/firms/{firm_id}", summary="One firm")
def get_firm(firm_id: uuid.UUID, db: DbSession = Depends(get_db)):
    return firm_json(_get(db, Firm, firm_id, "Firm"))


@router.post("/firms", status_code=201, summary="Create a firm and invite its owner")
def create_firm(body: CreateFirmBody, principal: Principal = Depends(require("firm.create")),
                db: DbSession = Depends(get_db)):
    """One transaction (07 Q38): the firm, ONBOARDING, with the plan's limits copied (A3); its OWNER invite;
    FIRM_CREATED and INVITE_SENT in the firm's ledger. Returns the invite link's token, shown once."""
    now = utcnow()
    admin = db.get(PlatformUser, principal.user_id)
    name, owner_name = body.name.strip(), body.owner_name.strip()
    if not name:
        raise bad_request("Enter the firm's name.")
    if not owner_name:
        raise bad_request("Enter the owner's name.")
    problem = slug_problem(body.slug)
    if problem:
        raise bad_request(problem)
    if db.query(Firm.id).filter(Firm.slug == body.slug).first() is not None:
        raise bad_request("Another firm already uses this slug.")
    plan = db.get(Plan, body.plan_id)
    if plan is None:
        raise _not_found("Plan")
    if not plan.is_active:
        raise bad_request("That plan isn't offered to new firms.")
    if plan.seat_limit < 1:
        raise bad_request("That plan has no seats, so its owner can't be invited.")
    email = normal_email(body.owner_email)
    check_email_free(db, email, now)

    firm = Firm(name=name, slug=body.slug, status="ONBOARDING", plan_id=plan.id, seat_limit=plan.seat_limit,
                candidate_limit=plan.candidate_limit, contact_phone=(body.contact_phone or "").strip() or None,
                primary_timezone=_timezone(body.primary_timezone), client_timezone=_timezone(body.client_timezone))
    db.add(firm)
    try:
        db.flush()
    except IntegrityError:              # the same slug, created a moment ago by someone else
        db.rollback()
        raise bad_request("Another firm already uses this slug.")
    ledger.record(db, actor=admin, action="FIRM_CREATED", entity_type="firm", entity_id=firm.id, entity_label=name,
                  summary=f"Created firm on {plan.name} ({plan.seat_limit} seats, {plan.candidate_limit} candidates)",
                  firm_id=firm.id)
    invite, token = send_invite(db, inviter=admin, firm=firm, email=email, role="OWNER", invitee_name=owner_name,
                                summary=f"Invited {owner_name} ({email}) as OWNER", now=now)
    try:
        db.commit()
    except IntegrityError:              # the same email, invited a moment ago by someone else
        db.rollback()
        raise conflict("Someone with this email already has an account or a pending invite.")
    return {"firm": firm_json(firm), "invite": invite_json(invite, now), "invite_token": token}


# ── Invites ──────────────────────────────────────────────────────────────────

@router.get("/invites", summary="Every invite, or one firm's")
def list_invites(firm_id: uuid.UUID | None = None, db: DbSession = Depends(get_db)):
    query = db.query(Invite)
    if firm_id is not None:
        query = query.filter(Invite.firm_id == firm_id)
    now = utcnow()
    return [invite_json(i, now) for i in query.order_by(Invite.created_at.desc())]


@router.post("/invites/{invite_id}/resend", summary="Resend an invite: a new link, 7 more days")
def resend(invite_id: uuid.UUID, principal: Principal = Depends(require("invite.resend")),
           db: DbSession = Depends(get_db)):
    """Also the way to copy a pending invite's link again: only the token's hash is kept (07 Q38)."""
    now = utcnow()
    invite = db.query(Invite).filter(Invite.id == invite_id).with_for_update().first()
    if invite is None:
        raise _not_found("Invite")
    token = resend_invite(db, invite, actor=db.get(PlatformUser, principal.user_id), now=now)
    db.commit()
    return {"invite": invite_json(invite, now), "invite_token": token}


@router.post("/invites/{invite_id}/revoke", summary="Revoke a pending invite")
def revoke(invite_id: uuid.UUID, principal: Principal = Depends(require("invite.revoke")),
           db: DbSession = Depends(get_db)):
    now = utcnow()
    invite = db.query(Invite).filter(Invite.id == invite_id).with_for_update().first()
    if invite is None:
        raise _not_found("Invite")
    revoke_invite(db, invite, actor=db.get(PlatformUser, principal.user_id), now=now)
    db.commit()
    return invite_json(invite, now)


# ── Users, the platform team and the audit log (read only) ───────────────────

@router.get("/users", summary="Every firm user, or one firm's")
def list_users(firm_id: uuid.UUID | None = None, db: DbSession = Depends(get_db)):
    query = db.query(User)
    if firm_id is not None:
        query = query.filter(User.firm_id == firm_id)
    return [user_json(u) for u in query.order_by(User.created_at, User.name)]


@router.get("/team", summary="The platform team (Super Admins)")
def list_team(db: DbSession = Depends(get_db)):
    return [platform_user_json(a) for a in db.query(PlatformUser).order_by(PlatformUser.created_at, PlatformUser.name)]


AUDIT_LIMIT = 500


@router.get("/audit", summary="The ledger across the platform and every firm, newest first")
def list_audit(limit: int = Query(default=AUDIT_LIMIT, ge=1, le=2000), db: DbSession = Depends(get_db)):
    """Platform events and every firm's (A13). The newest `limit` entries; paging comes with the audit screen's
    filters. A support view that ran out is settled first, so the overview never counts it as open."""
    support.settle_expired(db)
    db.commit()
    entries = db.query(LedgerEntry).order_by(LedgerEntry.created_at.desc(), LedgerEntry.id).limit(limit)
    return [ledger_entry_json(e) for e in entries]
