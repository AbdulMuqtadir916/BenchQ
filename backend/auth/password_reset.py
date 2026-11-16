"""Approval based recovery for firm accounts. Reset secrets are only returned to an approver."""
from datetime import timedelta

from fastapi import HTTPException
from sqlalchemy.orm import Session

from backend.auth import ledger
from backend.auth.sessions import end_all_sessions
from backend.auth.tokens import hash_token, new_token
from backend.auth.passwords import verify_password
from backend.config import IS_PRODUCTION, PASSWORD_RESET_BASE_URL
from backend.models.db import utcnow
from backend.models.notifications import Notification, PasswordResetRequest
from backend.models.tenancy import Firm, ActivityEntry, PlatformUser, User

REQUEST_LIFETIME = timedelta(hours=24)
LINK_LIFETIME = timedelta(minutes=30)
GENERIC_REQUEST = "If the account is eligible, its approver will see a reset request in Notifications."
# One answer for an unknown, used, replaced or timed-out link: it never says which, or that a token exists.
LINK_EXPIRED = "This link has expired. Contact your manager or firm owner for a new one."
LEDGER_ENTITY = "password_reset_request"


def require_reset_base_url() -> None:
    """Startup check: in production a reset link needs the public HTTPS origin. Without it every Approve would fail
    with 503 after the request had already frozen the password, locking the requester out for 24 hours."""
    if IS_PRODUCTION and not PASSWORD_RESET_BASE_URL.startswith("https://"):
        raise RuntimeError("PASSWORD_RESET_BASE_URL must be the public https:// origin of the frontend in production.")


def system_entry(db: Session, row: PasswordResetRequest, label: str, action: str, summary: str) -> None:
    """A ledger entry no person acted for (the request comes from a signed-out page; an expiry has no actor)."""
    db.add(ActivityEntry(firm_id=row.firm_id, actor_type="SYSTEM", actor_user_id=None, actor_name="password_reset",
                       entity_type=LEDGER_ENTITY, entity_id=str(row.id), entity_label=label, action=action,
                       summary=summary))


def approvers_for(db: Session, user: User):
    """Resolve only within the requester's hierarchy and firm."""
    if user.role == "BDE":
        manager = db.query(User).filter(User.id == user.manager_id, User.firm_id == user.firm_id,
                                        User.role == "MANAGER", User.is_active.is_(True)).first() if user.manager_id else None
        if manager:
            return [manager], False
    if user.role in {"BDE", "MANAGER", "VIEWER"}:
        owner = db.query(User).filter(User.firm_id == user.firm_id, User.role == "OWNER",
                                      User.is_active.is_(True)).first()
        return ([owner], False) if owner else ([], False)
    if user.role == "OWNER":
        return db.query(PlatformUser).filter(PlatformUser.is_active.is_(True)).all(), True
    return [], False


def expire_request(db: Session, row: PasswordResetRequest, now=None) -> None:
    requester = db.get(User, row.requester_user_id)
    system_entry(db, row, requester.name if requester else "", "STATE_CHANGE",
                  f"Password reset request for {requester.name if requester else 'a user'} expired")
    row.status = "EXPIRED"
    row.reset_token_hash = None
    row.reset_token_expires_at = None
    for notification in db.query(Notification).filter(Notification.type == "PASSWORD_RESET",
                                                      Notification.entity_id == str(row.id),
                                                      Notification.resolved_at.is_(None)).all():
        notification.resolved_at = now or utcnow()


def expire_due_for_user(db: Session, user: User, now=None) -> None:
    now = now or utcnow()
    rows = db.query(PasswordResetRequest).filter(PasswordResetRequest.requester_user_id == user.id,
        PasswordResetRequest.status.in_(["PENDING", "APPROVED"])).with_for_update().populate_existing().all()
    for row in rows:
        if row.expires_at <= now:
            expire_request(db, row, now)
        elif row.is_platform_approval:
            if row.status == "APPROVED":
                platform_approver_active = bool(row.decided_by_platform_user_id and db.query(PlatformUser.id).filter(
                    PlatformUser.id == row.decided_by_platform_user_id, PlatformUser.is_active.is_(True)).first())
            else:
                platform_approver_active = bool(db.query(PlatformUser.id).filter(PlatformUser.is_active.is_(True)).first())
            if not platform_approver_active:
                expire_request(db, row, now)
        elif not row.is_platform_approval:
            approver = db.get(User, row.approver_user_id)
            active = bool(approver and approver.is_active and approver.firm_id == row.firm_id)
            if row.approver_role == "MANAGER":
                active = active and user.manager_id == approver.id
            else:
                active = active and bool(approver and approver.role == "OWNER")
            if not active:
                expire_request(db, row, now)
        if row.status == "APPROVED" and row.reset_token_expires_at and row.reset_token_expires_at <= now:
            # The approval remains valid for 24 hours; the approver may issue a fresh 30-minute link.
            row.reset_token_hash = None
            row.reset_token_expires_at = None
    # Sessions don't autoflush (models/db.py): the callers query these rows next and must see what expired here.
    db.flush()


def password_frozen(db: Session, user: User, now=None) -> bool:
    expire_due_for_user(db, user, now)
    return db.query(PasswordResetRequest.id).filter(PasswordResetRequest.requester_user_id == user.id,
        PasswordResetRequest.status.in_(["PENDING", "APPROVED"]),
        PasswordResetRequest.expires_at > (now or utcnow())).first() is not None


def make_reset_link(db: Session, row: PasswordResetRequest, approver) -> str:
    if not PASSWORD_RESET_BASE_URL or (IS_PRODUCTION and not PASSWORD_RESET_BASE_URL.startswith("https://")):
        raise HTTPException(status_code=503, detail="Password reset links are not configured.")
    raw = new_token()
    row.reset_token_hash = hash_token(raw)
    row.reset_token_expires_at = utcnow() + LINK_LIFETIME
    row.status = "APPROVED"
    url = f"{PASSWORD_RESET_BASE_URL}/reset-password#{raw}"
    return url


def request_reset(db: Session, email: str):
    """Create and route an eligible request. Caller always returns the same generic response."""
    email = email.strip().lower()
    # Add the same Argon2 work for unknown/inactive addresses so a fast lookup is less useful as an account oracle.
    verify_password(None, "password-reset-request-timing")
    user = db.query(User).filter(User.email == email).with_for_update().first()
    if user is None or not user.is_active or user.role == "PLATFORM_ADMIN":
        return
    if user.role not in {"BDE", "MANAGER", "OWNER", "VIEWER"}:
        return
    now = utcnow()
    expire_due_for_user(db, user, now)
    if db.query(PasswordResetRequest.id).filter(PasswordResetRequest.requester_user_id == user.id,
        PasswordResetRequest.status.in_(["PENDING", "APPROVED"])).first():
        return
    approvers, platform = approvers_for(db, user)
    if not approvers:
        return
    row = PasswordResetRequest(firm_id=user.firm_id, requester_user_id=user.id, requester_role=user.role,
        approver_role="PLATFORM_ADMIN" if platform else approvers[0].role,
        approver_user_id=None if platform else approvers[0].id, is_platform_approval=platform,
        status="PENDING", expires_at=now + REQUEST_LIFETIME)
    db.add(row)
    db.flush()
    firm = db.get(Firm, user.firm_id)
    title = "Password reset request"
    detail = f"{user.name} ({user.email}) requested a password reset for {firm.name if firm else 'your firm'}."
    for approver in approvers:
        db.add(Notification(firm_id=None if platform else user.firm_id,
            user_id=None if platform else approver.id, platform_user_id=approver.id if platform else None,
            type="PASSWORD_RESET", entity_id=str(row.id), title=title, detail=detail))
    who = "a Super Admin" if platform else f"{approvers[0].name} ({approvers[0].role.title()})"
    system_entry(db, row, user.name, "CREATE", f"{user.name} asked for a password reset; sent to {who}")
    # Freeze at request creation, and terminate sessions immediately. The lock serializes with sign-in.
    end_all_sessions(db, user)


def decide_request(db: Session, row: PasswordResetRequest, *, actor_user: User | None = None,
                   actor_platform: PlatformUser | None = None, approve: bool):
    now = utcnow()
    # populate_existing: the caller already loaded this row, and a lock without it returns that copy. Two decisions
    # at once (two Super Admins, a double click) must see each other: the second finds it no longer PENDING.
    user = db.query(User).filter(User.id == row.requester_user_id).with_for_update().populate_existing().first()
    row = (db.query(PasswordResetRequest).filter(PasswordResetRequest.id == row.id).with_for_update()
           .populate_existing().first())
    if not user or not user.is_active or row is None or row.status != "PENDING" or row.expires_at <= now:
        if row and row.status == "PENDING":
            expire_request(db, row, now)
            db.commit()
        raise HTTPException(status_code=409, detail="This request has expired or was already handled.")
    # Revalidate original chain; a newly inactive approver expires the request without rerouting.
    if row.is_platform_approval:
        valid = actor_platform is not None and actor_platform.is_active
    elif actor_user:
        valid = actor_user.is_active and actor_user.firm_id == row.firm_id and (
            (row.approver_role == "MANAGER" and actor_user.role == "MANAGER" and user.manager_id == actor_user.id)
            or (row.approver_role == "OWNER" and actor_user.role == "OWNER"))
        if row.approver_user_id != actor_user.id:
            valid = False
    else:
        valid = False
    if not valid:
        expire_request(db, row, now)
        db.commit()
        raise HTTPException(status_code=409, detail="This request is no longer eligible for approval.")
    row.decided_at = now
    row.decided_by_user_id = actor_user.id if actor_user else None
    row.decided_by_platform_user_id = actor_platform.id if actor_platform else None
    row.status = "DENIED" if not approve else "APPROVED"
    actor = actor_user or actor_platform
    ledger.record(db, actor=actor, action="STATE_CHANGE", entity_type=LEDGER_ENTITY, entity_id=row.id,
                  entity_label=user.name, firm_id=row.firm_id,
                  summary=f"{actor.name} {'approved' if approve else 'denied'} {user.name}'s password reset request", candidate_id=None)
    link = None
    if approve:
        link = make_reset_link(db, row, actor)
    for notification in db.query(Notification).filter(Notification.type == "PASSWORD_RESET",
        Notification.entity_id == str(row.id), Notification.resolved_at.is_(None)).all():
        notification.resolved_at = now
    return link

