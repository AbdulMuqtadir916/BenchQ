"""The public side of an invite, /invite/[token] (docs/04 §2.1, 07 P4, Q26, Q28): look it up, and accept it, which
creates the account and signs it in. No session needed. The frontend mock is the spec: src/mocks/invite-flow.ts
and src/mocks/invites.ts."""
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DbSession

from backend.auth import ledger
from backend.auth.invites import account_exists, effective_status, lock_firm
from backend.auth.passwords import MIN_PASSWORD_LENGTH, hash_password
from backend.auth.serialize import session_json
from backend.auth.sessions import COOKIE_NAME, cookie_kwargs, end_session, principal_for, start_session
from backend.auth.tokens import hash_token
from backend.models.db import get_db, utcnow
from backend.models.tenancy import Firm, Invite, PlatformUser, User

router = APIRouter(prefix="/invites", tags=["invites"])

# Why an invite can't be accepted, in the order the page checks (inviteBlock in src/mocks/invites.ts).
BLOCK_MESSAGE = {
    "ACCEPTED": "This invite has already been accepted.",
    "REVOKED": "This invite was revoked.",
    "EXPIRED": "This invite has expired.",
    "SUSPENDED": "Workspace suspended. This invite can't be accepted right now.",
}


class AcceptBody(BaseModel):
    name: str = Field(max_length=200)
    password: str = Field(max_length=1024)


def _invite_for(db: DbSession, token: str, *, lock: bool = False) -> Invite | None:
    query = db.query(Invite).filter(Invite.token_hash == hash_token(token))
    return (query.with_for_update() if lock else query).first()


def _block(db: DbSession, invite: Invite, now) -> str | None:
    status = effective_status(invite, now)
    if status in ("ACCEPTED", "REVOKED", "EXPIRED"):
        return status
    if invite.firm_id is not None and db.get(Firm, invite.firm_id).status == "SUSPENDED":
        return "SUSPENDED"
    return None


@router.get("/{token}", summary="What an invite link may show before sign-in")
def lookup(token: str, db: DbSession = Depends(get_db)):
    """INVALID (an unknown or replaced token) shows nothing about any invite. The other states name the firm
    and the offered role, which the link's holder was sent anyway."""
    invite = _invite_for(db, token)
    if invite is None:
        return {"status": "INVALID"}
    now = utcnow()
    firm = db.get(Firm, invite.firm_id) if invite.firm_id else None
    return {"status": _block(db, invite, now) or "VALID", "firm_name": firm.name if firm else None,
            "email": invite.email, "invitee_name": invite.invitee_name, "role": invite.role,
            "expires_at": invite.expires_at.isoformat()}


@router.post("/{token}/accept", summary="Accept an invite: create the account and sign in")
def accept(token: str, body: AcceptBody, request: Request, response: Response, db: DbSession = Depends(get_db)):
    """Creates the firm user (or, for a platform-team invite, the Super Admin), marks the invite ACCEPTED,
    activates an ONBOARDING firm when its OWNER accepts, logs INVITE_ACCEPTED, and signs the new account in
    (replacing any session this browser had). 410 for a dead link, 403 for a suspended firm, 409 when the
    email already has an account."""
    now = utcnow()
    invite = _invite_for(db, token, lock=True)   # the row lock stops a double-click accepting twice
    if invite is None:
        raise HTTPException(status_code=410, detail="This invite link isn't valid.")
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Enter your name.")
    if len(body.password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(status_code=400,
                            detail=f"Use at least {MIN_PASSWORD_LENGTH} characters for your password.")
    firm = lock_firm(db, invite.firm_id) if invite.firm_id else None
    block = _block(db, invite, now)
    if block == "SUSPENDED":
        raise HTTPException(status_code=403, detail=BLOCK_MESSAGE["SUSPENDED"])
    if block:
        raise HTTPException(status_code=410, detail=f"This invite is no longer valid. {BLOCK_MESSAGE[block]}")
    if account_exists(db, invite.email):
        raise HTTPException(status_code=409, detail="An account with this email already exists. Sign in instead.")

    password_hash = hash_password(body.password)
    if firm is None:
        account = PlatformUser(name=name, email=invite.email, password_hash=password_hash, last_active_at=now)
        summary = f"{name} joined the platform team"
    else:
        activates = invite.role == "OWNER" and firm.status == "ONBOARDING"
        account = User(firm_id=firm.id, role=invite.role, name=name, email=invite.email,
                       password_hash=password_hash)   # last_active_at stays empty: first run lands on /welcome
        if activates:
            firm.status = "ACTIVE"
        summary = f"{name} accepted the {invite.role} invite{'; firm is now active' if activates else ''}"
    db.add(account)
    invite.status = "ACCEPTED"
    invite.accepted_at = now
    try:
        db.flush()
    except IntegrityError:             # an account for this email, or a second active OWNER, appeared meanwhile
        db.rollback()
        raise HTTPException(status_code=409, detail="An account with this email already exists. Sign in instead.")
    ledger.record(db, actor=account, action="INVITE_ACCEPTED", entity_type="invite", entity_id=invite.id,
                  entity_label=invite.email, summary=summary, firm_id=invite.firm_id)

    end_session(db, request.cookies.get(COOKIE_NAME))
    session_token, row = start_session(db, account, now)
    db.commit()
    response.set_cookie(value=session_token, **cookie_kwargs(row.expires_at))
    return session_json(db, principal_for(db, row))
