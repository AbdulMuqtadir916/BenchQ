"""A firm's members and invites, the firm side (docs/07 Phase M, M1–M2; 07 Q15, Q38). Firm-scoped: every path names
the firm, and only its members get an answer; any other firm is 404, the same as a missing one (principle 4).

The OWNER invites a MANAGER, BDE or VIEWER (never an OWNER, A10), resends and revokes; a MANAGER sees the team
and its invites read-only; BDE and VIEWER see the members only. A SUSPENDED firm reaches none of this: its
firm routes are refused by backend/auth/access.py, so nobody in it can send an invite (Q38), and its pending
invites keep their seats.
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DbSession

from backend.api.routes_auth import current_principal
from backend.auth import ledger
from backend.auth.invites import (bad_request, check_email_free, check_seat, conflict, invite_json, lock_firm,
                                  normal_email, resend_invite, revoke_invite, send_invite)
from backend.auth.policy import require
from backend.auth.scoping import scoped
from backend.auth.serialize import firm_json, user_json
from backend.auth.sessions import Principal
from backend.models.candidates import Candidate
from backend.models.db import get_db, utcnow
from backend.models.tenancy import Firm, Invite, User

router = APIRouter(prefix="/firms/{firm_id}", tags=["team"])

MEMBER_ROLES = ("MANAGER", "BDE", "VIEWER")

# Word for word the frontend's noManagerReason (docs/candidate-onboarding/02-hierarchy-and-seats.md §2).
NO_MANAGER_REASON = "Invite a manager first. Every BDE reports to a manager."


def _not_found() -> HTTPException:
    return HTTPException(status_code=404, detail="Not found.")


def _member_of(firm_id: uuid.UUID, principal: Principal) -> None:
    """The principal must belong to the firm the path names, or be in a support view of it (reads only: the
    middleware refuses a view's writes, and so does each write's action)."""
    if (principal.firm_id or principal.support_firm_id) != firm_id:
        raise _not_found()


def _firm_invite(db: DbSession, firm_id: uuid.UUID, invite_id: uuid.UUID) -> Invite:
    invite = db.query(Invite).filter(Invite.id == invite_id, Invite.firm_id == firm_id).with_for_update().first()
    if invite is None:
        raise _not_found()
    if invite.role == "OWNER":       # the firm's OWNER invite is the Super Admin's to manage (A10)
        raise HTTPException(status_code=403, detail="Only BenchQ can resend or revoke the owner's invite.")
    return invite


class InviteMemberBody(BaseModel):
    email: str = Field(max_length=320)
    role: str
    invitee_name: str | None = Field(default=None, max_length=200)   # prefilled on /invite/[token] (Q31)
    manager_id: uuid.UUID | None = None                              # 07 Q40: required for a BDE, refused otherwise


class ChangeManagerBody(BaseModel):
    manager_id: uuid.UUID


class FirmSettingsBody(BaseModel):
    bde_capacity: int = Field(ge=1, le=50)


def _active_manager(db: DbSession, firm_id: uuid.UUID, manager_id: uuid.UUID) -> User:
    """An active MANAGER of this firm, or the same 404 as a missing one (principle 4)."""
    manager = db.query(User).filter(User.id == manager_id, User.firm_id == firm_id, User.role == "MANAGER",
                                    User.is_active.is_(True)).first()
    if manager is None:
        raise HTTPException(status_code=404, detail="Manager not found.")
    return manager


def _invite_manager(db: DbSession, firm_id: uuid.UUID, body: InviteMemberBody) -> uuid.UUID | None:
    """07 Q40: a BDE invite names the active MANAGER the BDE will report to; no other role names one. A firm with no
    active MANAGER can't invite BDEs yet."""
    if body.role != "BDE":
        if body.manager_id is not None:
            raise bad_request("Only a BDE reports to a manager.")
        return None
    if body.manager_id is None:
        has_manager = db.query(User.id).filter(User.firm_id == firm_id, User.role == "MANAGER",
                                               User.is_active.is_(True)).first()
        if has_manager is None:
            raise conflict(NO_MANAGER_REASON)
        raise bad_request("Choose the manager this BDE reports to.")
    return _active_manager(db, firm_id, body.manager_id).id


@router.get("/members", summary="The firm's users")
def list_members(firm_id: uuid.UUID, principal: Principal = Depends(current_principal),
                 db: DbSession = Depends(get_db)):
    _member_of(firm_id, principal)
    return [user_json(u) for u in db.query(User).filter(User.firm_id == firm_id).order_by(User.created_at, User.name)]


@router.get("/invites", summary="The firm's invites")
def list_invites(firm_id: uuid.UUID, principal: Principal = Depends(require("team.view")),
                 db: DbSession = Depends(get_db)):
    _member_of(firm_id, principal)
    now = utcnow()
    return [invite_json(i, now)
            for i in db.query(Invite).filter(Invite.firm_id == firm_id).order_by(Invite.created_at.desc())]


@router.post("/invites", status_code=201, summary="Invite a member")
def invite_member(firm_id: uuid.UUID, body: InviteMemberBody, principal: Principal = Depends(require("member.invite")),
                  db: DbSession = Depends(get_db)):
    """A BDE invite is blocked at the seat limit (A4, 07 Q44). Returns the invite link's token once; only its hash is
    stored."""
    _member_of(firm_id, principal)
    if body.role not in MEMBER_ROLES:
        raise bad_request("Choose Manager, BDE or Viewer.")
    now = utcnow()
    email = normal_email(body.email)
    name = (body.invitee_name or "").strip() or None
    firm = lock_firm(db, firm_id)
    manager_id = _invite_manager(db, firm_id, body)
    check_email_free(db, email, now)
    check_seat(db, firm, body.role, now)
    who = f"{name} ({email})" if name else email
    invite, token = send_invite(db, inviter=db.get(User, principal.user_id), firm=firm, email=email, role=body.role,
                                invitee_name=name, summary=f"Invited {who} as {body.role}", now=now,
                                manager_id=manager_id)
    try:
        db.commit()
    except IntegrityError:          # the same email, invited a moment ago by someone else
        db.rollback()
        raise conflict("Someone with this email already has an account or a pending invite.")
    return {"invite": invite_json(invite, now), "invite_token": token}


@router.post("/invites/{invite_id}/resend", summary="Resend an invite: a new link, 7 more days")
def resend(firm_id: uuid.UUID, invite_id: uuid.UUID, principal: Principal = Depends(require("member.invite")),
           db: DbSession = Depends(get_db)):
    """Also the way to copy a pending invite's link again (07 Q38). An expired BDE invite needs a free seat."""
    _member_of(firm_id, principal)
    now = utcnow()
    invite = _firm_invite(db, firm_id, invite_id)
    token = resend_invite(db, invite, actor=db.get(User, principal.user_id), now=now)
    db.commit()
    return {"invite": invite_json(invite, now), "invite_token": token}


@router.post("/invites/{invite_id}/revoke", summary="Revoke a pending invite")
def revoke(firm_id: uuid.UUID, invite_id: uuid.UUID, principal: Principal = Depends(require("member.invite")),
           db: DbSession = Depends(get_db)):
    _member_of(firm_id, principal)
    now = utcnow()
    invite = _firm_invite(db, firm_id, invite_id)
    revoke_invite(db, invite, actor=db.get(User, principal.user_id), now=now)
    db.commit()
    return invite_json(invite, now)


@router.patch("/members/{user_id}/manager", summary="Move a BDE to another manager")
def change_manager(firm_id: uuid.UUID, user_id: uuid.UUID, body: ChangeManagerBody,
                   principal: Principal = Depends(require("member.changeManager")), db: DbSession = Depends(get_db)):
    """OWNER only (07 Q40). Also how a BDE from before the hierarchy gets a manager (Q51). In one transaction: the
    BDE's manager, and the manager of every candidate that BDE works, since candidates move with their BDE (Q43)."""
    _member_of(firm_id, principal)
    bde = db.query(User).filter(User.id == user_id, User.firm_id == firm_id, User.role == "BDE") \
        .with_for_update().first()
    if bde is None:
        raise _not_found()
    manager = _active_manager(db, firm_id, body.manager_id)
    previous = db.get(User, bde.manager_id) if bde.manager_id else None
    if previous is not None and previous.id == manager.id:
        return user_json(bde)
    bde.manager_id = manager.id
    moved = scoped(db, Candidate, firm_id).filter(Candidate.bde_id == bde.id) \
        .update({Candidate.manager_id: manager.id}, synchronize_session=False)
    was = f" (was {previous.name})" if previous else ""
    ledger.record(db, actor=db.get(User, principal.user_id), action="UPDATE", entity_type="user", entity_id=bde.id,
                  entity_label=bde.name, firm_id=firm_id,
                  summary=f"{bde.name} now reports to {manager.name}{was}; "
                          f"{moved} candidate{'' if moved == 1 else 's'} moved")
    db.commit()
    return user_json(bde)


@router.patch("/settings", summary="The firm's own settings: the BDE capacity")
def update_settings(firm_id: uuid.UUID, body: FirmSettingsBody,
                    principal: Principal = Depends(require("firmSettings.edit")), db: DbSession = Depends(get_db)):
    """OWNER only (07 Q46). The capacity is a warning when assigning, never a block."""
    _member_of(firm_id, principal)
    firm = lock_firm(db, firm_id)
    if firm is None:
        raise _not_found()
    if firm.bde_capacity != body.bde_capacity:
        before, firm.bde_capacity = firm.bde_capacity, body.bde_capacity
        ledger.record(db, actor=db.get(User, principal.user_id), action="UPDATE", entity_type="firm",
                      entity_id=firm.id, entity_label=firm.name, firm_id=firm.id,
                      summary=f"BDE capacity {before} → {body.bde_capacity}")
        db.commit()
    return firm_json(db.get(Firm, firm_id))
