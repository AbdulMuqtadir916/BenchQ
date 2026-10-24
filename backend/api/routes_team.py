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
from backend.auth.invites import (bad_request, check_email_free, check_seat, conflict, invite_json, lock_firm,
                                  normal_email, resend_invite, revoke_invite, send_invite)
from backend.auth.policy import require
from backend.auth.serialize import user_json
from backend.auth.sessions import Principal
from backend.models.db import get_db, utcnow
from backend.models.tenancy import Invite, User

router = APIRouter(prefix="/firms/{firm_id}", tags=["team"])

MEMBER_ROLES = ("MANAGER", "BDE", "VIEWER")


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
    """Blocked at the seat limit (A4). Returns the invite link's token once; only its hash is stored."""
    _member_of(firm_id, principal)
    if body.role not in MEMBER_ROLES:
        raise bad_request("Choose Manager, BDE or Viewer.")
    now = utcnow()
    email = normal_email(body.email)
    name = (body.invitee_name or "").strip() or None
    firm = lock_firm(db, firm_id)
    check_email_free(db, email, now)
    check_seat(db, firm, now)
    who = f"{name} ({email})" if name else email
    invite, token = send_invite(db, inviter=db.get(User, principal.user_id), firm=firm, email=email, role=body.role,
                                invitee_name=name, summary=f"Invited {who} as {body.role}", now=now)
    try:
        db.commit()
    except IntegrityError:          # the same email, invited a moment ago by someone else
        db.rollback()
        raise conflict("Someone with this email already has an account or a pending invite.")
    return {"invite": invite_json(invite, now), "invite_token": token}


@router.post("/invites/{invite_id}/resend", summary="Resend an invite: a new link, 7 more days")
def resend(firm_id: uuid.UUID, invite_id: uuid.UUID, principal: Principal = Depends(require("member.invite")),
           db: DbSession = Depends(get_db)):
    """Also the way to copy a pending invite's link again (07 Q38). An expired one needs a free seat."""
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
