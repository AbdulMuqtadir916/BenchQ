"""The read-only support view (07 §4, Q10, Q20, Q29; 07-auth F3). The frontend's mock is the spec:
src/mocks/support.ts and src/mocks/support.test.ts.

A Super Admin opens a view of one firm with a reason of 10+ characters. It lasts 60 minutes with no extension, one
at a time (starting another ends the open one), and it lives on the session that started it
(`sessions.support_view_id`), so `sessions.principal_for` rebuilds it on every request. It ends by exit, expiry, or
the end of its session (sign-out, signing in as someone else, accepting an invite, a password reset). Every start
and end is in the firm's own ledger (`ADMIN_ACCESS`, `ADMIN_ACCESS_END`, entity `support_view`) with the admin's
name and the reason as written, never their email (A12).

An expired view is closed already (`principal_for` ignores it); its end is logged lazily, dated at its expiry,
the first time anyone's request notices it (`settle_expired`). The caller commits.
"""
from datetime import datetime, timedelta
import uuid

from fastapi import HTTPException
from sqlalchemy.orm import Session as DbSession

from backend.auth import ledger
from backend.models.db import utcnow
from backend.models.tenancy import Firm, PlatformUser, Session, SupportView

MIN_REASON = 10
VIEW_LENGTH = timedelta(minutes=60)
END_SUMMARY = {
    "EXIT": "Support view ended",
    "EXPIRED": "Support view ended after 60 minutes",
    "SIGN_OUT": "Support view ended: signed out",
    "REPLACED": "Support view ended: another support view started",
}


def _log(db: DbSession, view: SupportView, action: str, summary: str, at: datetime) -> None:
    admin = db.get(PlatformUser, view.platform_user_id)
    firm = db.get(Firm, view.firm_id)
    ledger.record(db, actor=admin, action=action, entity_type="support_view", entity_id=view.id,
                  entity_label=firm.name, summary=summary, firm_id=view.firm_id, at=at)


def _end(db: DbSession, view: SupportView, reason: str, now: datetime) -> None:
    # An expired view ended at its expiry, whenever it is noticed.
    ended_at = view.expires_at if reason == "EXPIRED" else now
    view.ended_at = ended_at
    db.query(Session).filter(Session.support_view_id == view.id).update({Session.support_view_id: None},
                                                                         synchronize_session=False)
    _log(db, view, "ADMIN_ACCESS_END", END_SUMMARY[reason], ended_at)
    db.flush()


def settle_expired(db: DbSession, now: datetime | None = None) -> None:
    """Log the end of every view that ran out, anyone's. Rows another request is settling are skipped, and a row
    it has settled no longer matches, so each end is logged once."""
    now = now or utcnow()
    expired = (db.query(SupportView).filter(SupportView.ended_at.is_(None), SupportView.expires_at <= now)
               .with_for_update(skip_locked=True).all())
    for view in expired:
        _end(db, view, "EXPIRED", now)


def _lock_admin(db: DbSession, admin_id: uuid.UUID) -> PlatformUser:
    """Start and exit run one at a time per admin (two tabs, a double click), so the one-open-view index never
    fails a request."""
    return db.query(PlatformUser).filter(PlatformUser.id == admin_id).with_for_update().one()


def _open_view(db: DbSession, session_id: uuid.UUID, now: datetime) -> SupportView | None:
    row = db.get(Session, session_id)
    if row is None or row.support_view_id is None:
        return None
    view = db.get(SupportView, row.support_view_id)
    return view if view is not None and view.ended_at is None and view.expires_at > now else None


def _firm(db: DbSession, firm_id: str) -> Firm:
    """Any status can be viewed (Q29). A malformed id is 404, the same as an unknown one (principle 4)."""
    try:
        firm = db.get(Firm, uuid.UUID(str(firm_id)))
    except ValueError:
        firm = None
    if firm is None:
        raise HTTPException(status_code=404, detail="Not found.")
    return firm


def start(db: DbSession, *, admin_id: uuid.UUID, session_id: uuid.UUID, firm_id: str, reason: str,
          now: datetime | None = None) -> SupportView:
    """Open a view of a firm on this session. The admin's open view, of this firm or another, ends first."""
    now = now or utcnow()
    _lock_admin(db, admin_id)
    firm = _firm(db, firm_id)
    text = (reason or "").strip()
    if len(text) < MIN_REASON:
        raise HTTPException(status_code=400, detail=f"Give a reason of at least {MIN_REASON} characters.")
    settle_expired(db, now)
    # One open view per admin (the partial unique index), wherever it was started.
    for open_view in db.query(SupportView).filter(SupportView.platform_user_id == admin_id,
                                                  SupportView.ended_at.is_(None)):
        _end(db, open_view, "REPLACED", now)
    view = SupportView(platform_user_id=admin_id, firm_id=firm.id, reason=text, started_at=now,
                       expires_at=now + VIEW_LENGTH)
    db.add(view)
    db.flush()
    db.get(Session, session_id).support_view_id = view.id
    _log(db, view, "ADMIN_ACCESS", f"Support view started: {text}", now)
    db.flush()
    return view


def exit_view(db: DbSession, *, admin_id: uuid.UUID, session_id: uuid.UUID,
              now: datetime | None = None) -> uuid.UUID | None:
    """End this session's view. Returns the firm it was of (the way back to /admin/firms/[firmId]), or None when
    none was open."""
    now = now or utcnow()
    _lock_admin(db, admin_id)
    settle_expired(db, now)
    view = _open_view(db, session_id, now)
    if view is None:
        return None
    _end(db, view, "EXIT", now)
    return view.firm_id


def end_with_session(db: DbSession, row: Session, now: datetime | None = None) -> None:
    """A session is ending (sign-out, replaced by a sign-in, a password reset): its open view ends with it."""
    now = now or utcnow()
    settle_expired(db, now)
    if row.support_view_id is None:
        return
    view = db.get(SupportView, row.support_view_id)
    if view is not None and view.ended_at is None:
        _end(db, view, "SIGN_OUT", now)
