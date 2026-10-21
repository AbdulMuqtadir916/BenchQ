"""Invites, seats and slugs: the rules the Super Admin's and the OWNER's endpoints share (docs/02 §3.1, A1–A11;
07 Q38). The frontend mock is the spec: src/mocks/platform.ts, src/mocks/invites.ts, src/lib/derive/.

Callers commit. Anything that adds a seat locks the firm row first (`lock_firm`), so two concurrent invites
can't both take the last seat.
"""
from datetime import datetime, timedelta
import re
import uuid

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session as DbSession

from backend.auth import ledger
from backend.auth.tokens import hash_token, new_token
from backend.models.db import utcnow
from backend.models.tenancy import Firm, Invite, PlatformUser, User

INVITE_LIFETIME = timedelta(days=7)          # A9: created or resent + 7 days

# The same words as RESERVED_SLUGS in src/lib/schemas/tenancy.ts (docs/07 §2.4); test_admin_firms.py compares.
RESERVED_SLUGS = (
    "admin", "api", "health", "sign-in", "sign-up", "forgot-password", "reset-password", "invite", "dev",
    "_next", "static", "assets", "favicon.ico", "robots.txt", "sitemap.xml", "www", "app", "support",
    "help", "status", "settings", "new",
)

_EMAIL = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def bad_request(detail: str) -> HTTPException:
    return HTTPException(status_code=400, detail=detail)


def conflict(detail: str) -> HTTPException:
    return HTTPException(status_code=409, detail=detail)


# ── Slugs and emails ─────────────────────────────────────────────────────────

def slug_problem(slug: str) -> str | None:
    """What's wrong with a slug's shape, each rule its own message, in the frontend's order (slugProblem in
    src/lib/derive/platform.ts). Uniqueness is the caller's check."""
    if not slug:
        return "Enter a slug."
    if not 3 <= len(slug) <= 32:
        return "Use 3–32 characters."
    if not re.fullmatch(r"[a-z0-9-]+", slug):
        return "Use only lowercase letters, digits and hyphens."
    if not slug[0].isalpha():
        return "Start with a letter."
    if slug.endswith("-"):
        return "Don't end with a hyphen."
    if "--" in slug:
        return "Don't use two hyphens in a row."
    if slug in RESERVED_SLUGS:
        return "This word is reserved by BenchQ."
    return None


def normal_email(email: str) -> str:
    address = email.strip().lower()
    if not _EMAIL.match(address) or len(address) > 320:
        raise bad_request("Enter a valid email address.")
    return address


def account_exists(db: DbSession, email: str) -> bool:
    return (db.query(User.id).filter(User.email == email).first() is not None
            or db.query(PlatformUser.id).filter(PlatformUser.email == email).first() is not None)


def check_email_free(db: DbSession, email: str, now: datetime) -> None:
    """One email, one account (07 Q9, Q38): nobody may already hold it or have a pending invite for it."""
    settle_expired(db, now, email=email)
    pending = db.query(Invite.id).filter(Invite.email == email, Invite.status == "PENDING").first()
    if account_exists(db, email) or pending is not None:
        raise conflict("Someone with this email already has an account or a pending invite.")


# ── Invite status ────────────────────────────────────────────────────────────

def effective_status(invite: Invite, now: datetime) -> str:
    """A9: a PENDING invite past its expiry is EXPIRED (effectiveInviteStatus in src/lib/derive/tenancy.ts)."""
    if invite.status == "PENDING" and invite.expires_at <= now:
        return "EXPIRED"
    return invite.status


def settle_expired(db: DbSession, now: datetime, *, email: str | None = None, firm_id: uuid.UUID | None = None) -> None:
    """Store EXPIRED on PENDING invites past their expiry, so the one-pending-invite indexes don't count a
    dead invite (it would block inviting the same email again)."""
    query = db.query(Invite).filter(Invite.status == "PENDING", Invite.expires_at <= now)
    if email is not None:
        query = query.filter(Invite.email == email)
    if firm_id is not None:
        query = query.filter(Invite.firm_id == firm_id)
    query.update({Invite.status: "EXPIRED"}, synchronize_session=False)


# ── Seats (A1, A4) ───────────────────────────────────────────────────────────

def lock_firm(db: DbSession, firm_id: uuid.UUID) -> Firm | None:
    return db.query(Firm).filter(Firm.id == firm_id).with_for_update().first()


def seats_used(db: DbSession, firm_id: uuid.UUID, now: datetime) -> int:
    """Active users of every role, plus pending unexpired invites (A1). Derived, never stored."""
    users = db.query(func.count(User.id)).filter(User.firm_id == firm_id, User.is_active.is_(True)).scalar()
    invites = (db.query(func.count(Invite.id))
               .filter(Invite.firm_id == firm_id, Invite.status == "PENDING", Invite.expires_at > now).scalar())
    return users + invites


def seat_block_reason(used: int, limit: int) -> str:
    """The over-limit block's message (seatBlockReason in src/lib/derive/platform.ts), word for word."""
    return f"Your plan allows {limit} seat{'' if limit == 1 else 's'}; {used} {'is' if used == 1 else 'are'} in use."


def check_seat(db: DbSession, firm: Firm, now: datetime) -> None:
    """A4: a new seat only below the limit. The caller holds the firm's row lock."""
    used = seats_used(db, firm.id, now)
    if used >= firm.seat_limit:
        raise conflict(seat_block_reason(used, firm.seat_limit))


# ── Sending ──────────────────────────────────────────────────────────────────

def send_invite(db: DbSession, *, inviter: User | PlatformUser, firm: Firm | None, email: str, role: str,
                invitee_name: str | None, summary: str, now: datetime) -> tuple[Invite, str]:
    """Create a PENDING invite and log INVITE_SENT. Returns the invite and its token, which is shown once and
    never stored (07 Q38). The caller has checked the email and, for a firm invite, the seat."""
    token = new_token()
    invite = Invite(
        firm_id=firm.id if firm else None, email=email, invitee_name=invitee_name, role=role,
        invited_by_user_id=inviter.id if isinstance(inviter, User) else None,
        invited_by_platform_user_id=inviter.id if isinstance(inviter, PlatformUser) else None,
        status="PENDING", token_hash=hash_token(token), expires_at=now + INVITE_LIFETIME,
    )
    db.add(invite)
    db.flush()
    ledger.record(db, actor=inviter, action="INVITE_SENT", entity_type="invite", entity_id=invite.id,
                  entity_label=email, summary=summary, firm_id=invite.firm_id)
    return invite, token


def resend_invite(db: DbSession, invite: Invite, *, actor: User | PlatformUser, now: datetime) -> str:
    """Same row, a new token, expiry now + 7 days (A9); the old link stops working. Logs INVITE_SENT
    "Invite resent to …" (Q24). An expired firm invite takes a seat again, so it is blocked at the limit (A4).
    "Copy link" is a resend, because only the token's hash is kept (07 Q38). Returns the new token."""
    status = effective_status(invite, now)
    if status not in ("PENDING", "EXPIRED"):
        raise conflict("Only a pending or expired invite can be resent.")
    if status == "EXPIRED":
        if account_exists(db, invite.email):
            raise conflict("Someone with this email already has an account.")
        other = (db.query(Invite.id).filter(Invite.email == invite.email, Invite.status == "PENDING",
                                            Invite.expires_at > now, Invite.id != invite.id).first())
        if other is not None:
            raise conflict("Someone with this email already has a pending invite.")
        if invite.firm_id is not None:
            check_seat(db, lock_firm(db, invite.firm_id), now)
    token = new_token()
    invite.status = "PENDING"
    invite.token_hash = hash_token(token)
    invite.expires_at = now + INVITE_LIFETIME
    ledger.record(db, actor=actor, action="INVITE_SENT", entity_type="invite", entity_id=invite.id,
                  entity_label=invite.email, summary=f"Invite resent to {invite.email}", firm_id=invite.firm_id)
    return token


def revoke_invite(db: DbSession, invite: Invite, *, actor: User | PlatformUser, now: datetime) -> None:
    if effective_status(invite, now) != "PENDING":
        raise conflict("Only a pending invite can be revoked.")
    invite.status = "REVOKED"
    invite.revoked_at = now
    ledger.record(db, actor=actor, action="INVITE_REVOKED", entity_type="invite", entity_id=invite.id,
                  entity_label=invite.email, summary=f"Revoked the invite to {invite.email}", firm_id=invite.firm_id)


def invite_json(invite: Invite, now: datetime | None = None) -> dict:
    """The frontend's Invite (src/lib/schemas/tenancy.ts) in snake_case, with the effective status."""
    return {
        "id": str(invite.id), "firm_id": str(invite.firm_id) if invite.firm_id else None, "email": invite.email,
        "invitee_name": invite.invitee_name, "role": invite.role,
        "invited_by_user_id": str(invite.invited_by_user_id or invite.invited_by_platform_user_id),
        "status": effective_status(invite, now or utcnow()), "expires_at": invite.expires_at.isoformat(),
        "created_at": invite.created_at.isoformat(),
    }
