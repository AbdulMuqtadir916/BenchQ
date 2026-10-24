"""Cookie sessions (07 Q37): an opaque token in an HttpOnly cookie, its SHA-256 in `sessions`.

Every request rebuilds the principal from the database, re-reading the account and the firm, so deactivation,
suspension and role changes apply on the next request rather than at token expiry. Lifetime: 7 days sliding,
30 days absolute.
"""
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal
import uuid

from sqlalchemy.orm import Session as DbSession

from backend.auth import support
from backend.auth.tokens import hash_token, new_token
from backend.config import SESSION_COOKIE_SECURE
from backend.models.db import utcnow
from backend.models.tenancy import Firm, PlatformUser, Session, SupportView, User

COOKIE_NAME = "bq_session"
SLIDING_LIFETIME = timedelta(days=7)
ABSOLUTE_LIFETIME = timedelta(days=30)
# A session's expiry slides at most this often, so a busy page doesn't write on every request.
SLIDE_EVERY = timedelta(minutes=5)


@dataclass(frozen=True)
class Principal:
    """Who is calling (docs/02 §3.1 Principal). `firm_id` and `firm_status` are set for a firm user only;
    `support_view_id` and `support_firm_id` for a Super Admin inside an open support view, which may read that firm
    and never write it (backend/auth/support.py)."""
    kind: Literal["firm", "platform"]
    user_id: uuid.UUID
    session_id: uuid.UUID
    role: str
    firm_id: uuid.UUID | None = None
    firm_status: str | None = None
    support_view_id: uuid.UUID | None = None
    support_firm_id: uuid.UUID | None = None

    @property
    def is_platform(self) -> bool:
        return self.kind == "platform"


@dataclass(frozen=True)
class Resolved:
    principal: Principal
    token: str
    expires_at: datetime | None   # set when the expiry slid, so the cookie is sent again with it


def start_session(db: DbSession, account: User | PlatformUser, now: datetime | None = None) -> tuple[str, Session]:
    """Create a session for an account that has just proved who it is. Returns the token for the cookie."""
    now = now or utcnow()
    token = new_token()
    absolute = now + ABSOLUTE_LIFETIME
    row = Session(
        token_hash=hash_token(token),
        user_id=account.id if isinstance(account, User) else None,
        platform_user_id=account.id if isinstance(account, PlatformUser) else None,
        created_at=now, last_seen_at=now, expires_at=min(now + SLIDING_LIFETIME, absolute),
        absolute_expires_at=absolute,
    )
    db.add(row)
    db.flush()
    return token, row


def resolve(db: DbSession, token: str | None, now: datetime | None = None) -> Resolved | None:
    """The principal behind a cookie, or None when the session is unknown, expired, or its account (or a firm
    user's firm) is gone or deactivated. Slides the expiry when due."""
    if not token:
        return None
    now = now or utcnow()
    row = db.query(Session).filter(Session.token_hash == hash_token(token)).first()
    if row is None:
        return None
    if row.expires_at <= now or row.absolute_expires_at <= now:
        db.delete(row)
        db.commit()
        return None

    principal = principal_for(db, row, now)
    if principal is None:
        return None

    slid_to = None
    if now - row.last_seen_at >= SLIDE_EVERY:
        row.last_seen_at = now
        row.expires_at = min(now + SLIDING_LIFETIME, row.absolute_expires_at)
        db.commit()
        slid_to = row.expires_at
    return Resolved(principal=principal, token=token, expires_at=slid_to)


def principal_for(db: DbSession, row: Session, now: datetime | None = None) -> Principal | None:
    """The principal a session row stands for, or None when its account (or a firm user's firm) is gone or
    deactivated. A support view counts only while open and unexpired."""
    now = now or utcnow()
    if row.user_id is not None:
        user = db.get(User, row.user_id)
        if user is None or not user.is_active:
            return None
        firm = db.get(Firm, user.firm_id)
        if firm is None:
            return None
        return Principal(kind="firm", user_id=user.id, session_id=row.id, role=user.role, firm_id=firm.id,
                         firm_status=firm.status)

    admin = db.get(PlatformUser, row.platform_user_id)
    if admin is None or not admin.is_active:
        return None
    view = None
    if row.support_view_id is not None:
        view = db.get(SupportView, row.support_view_id)
        if view is None or view.ended_at is not None or view.expires_at <= now:
            view = None
    return Principal(kind="platform", user_id=admin.id, session_id=row.id, role="PLATFORM_ADMIN",
                     support_view_id=view.id if view else None, support_firm_id=view.firm_id if view else None)


def end_session(db: DbSession, token: str | None) -> Session | None:
    """Delete the session behind a cookie (sign-out, or a sign-in replacing it). Its open support view ends with it,
    logged. Returns the deleted row, if there was one."""
    if not token:
        return None
    row = db.query(Session).filter(Session.token_hash == hash_token(token)).first()
    if row is not None:
        support.end_with_session(db, row)
        db.delete(row)
        db.flush()
    return row


def end_all_sessions(db: DbSession, account: User | PlatformUser) -> int:
    """Sign an account out everywhere (deactivation, password change); a Super Admin's open support view ends too."""
    column = Session.user_id if isinstance(account, User) else Session.platform_user_id
    for row in db.query(Session).filter(column == account.id).all():
        support.end_with_session(db, row)
    return db.query(Session).filter(column == account.id).delete(synchronize_session=False)


def cookie_kwargs(expires_at: datetime, now: datetime | None = None) -> dict:
    """Set-Cookie attributes (07-auth §2): HttpOnly, SameSite=Lax, Path=/, Secure outside development."""
    max_age = max(0, int((expires_at - (now or utcnow())).total_seconds()))
    return dict(key=COOKIE_NAME, httponly=True, samesite="lax", secure=SESSION_COOKIE_SECURE, path="/",
                max_age=max_age)


def clear_cookie_kwargs() -> dict:
    return dict(key=COOKIE_NAME, httponly=True, samesite="lax", secure=SESSION_COOKIE_SECURE, path="/")
