"""Per-account in-app notifications and password reset approvals."""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session as DbSession

from backend.api.routes_auth import current_principal
from backend.auth.password_reset import decide_request, expire_due_for_user, make_reset_link
from backend.auth.policy import can
from backend.auth.sessions import Principal
from backend.models.db import get_db, utcnow
from backend.models.notifications import Notification, PasswordResetRequest
from backend.models.tenancy import PlatformUser, User

router = APIRouter(prefix="/notifications", tags=["notifications"])


def recipient_query(db: DbSession, principal: Principal):
    q = db.query(Notification)
    if principal.is_platform:
        return q.filter(Notification.platform_user_id == principal.user_id)
    return q.filter(Notification.user_id == principal.user_id, Notification.firm_id == principal.firm_id)


@router.get("")
def list_notifications(response: Response, principal: Principal = Depends(current_principal), db: DbSession = Depends(get_db)):
    rows = recipient_query(db, principal).order_by(Notification.created_at.desc()).limit(100).all()
    reset_ids = [uuid.UUID(n.entity_id) for n in rows if n.type == "PASSWORD_RESET"]
    requests = db.query(PasswordResetRequest).filter(PasswordResetRequest.id.in_(reset_ids)).all() if reset_ids else []
    for request_row in requests:
        requester = db.query(User).filter(User.id == request_row.requester_user_id).with_for_update().first()
        if requester:
            expire_due_for_user(db, requester)
    db.commit()
    response.headers["Cache-Control"] = "private, no-store"
    request_map = {str(r.id): r for r in requests}
    return {"items": [{"id": str(n.id), "type": n.type, "entityId": n.entity_id,
                       "requestStatus": request_map[n.entity_id].status if n.entity_id in request_map else None,
                       "title": n.title,
                       "canReissue": bool(request_map.get(n.entity_id) and request_map[n.entity_id].status == "APPROVED"
                           and ((principal.is_platform and request_map[n.entity_id].decided_by_platform_user_id == principal.user_id)
                                or (not principal.is_platform and request_map[n.entity_id].decided_by_user_id == principal.user_id))),
                       "detail": n.detail, "readAt": n.read_at.isoformat() if n.read_at else None,
                       "resolvedAt": n.resolved_at.isoformat() if n.resolved_at else None,
                       "createdAt": n.created_at.isoformat()} for n in rows]}


class DecisionBody(BaseModel):
    approve: bool


@router.patch("/{notification_id}/read")
def mark_read(notification_id: uuid.UUID, principal: Principal = Depends(current_principal),
              db: DbSession = Depends(get_db)):
    row = recipient_query(db, principal).filter(Notification.id == notification_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Notification not found.")
    row.read_at = row.read_at or utcnow()
    db.commit()
    return {"ok": True}


@router.post("/{notification_id}/password-reset-decision")
def password_reset_decision(notification_id: uuid.UUID, body: DecisionBody, response: Response,
                            principal: Principal = Depends(current_principal), db: DbSession = Depends(get_db)):
    notice = recipient_query(db, principal).filter(Notification.id == notification_id).first()
    if not notice or notice.type != "PASSWORD_RESET":
        raise HTTPException(status_code=404, detail="Notification not found.")
    action = "platform.notification.approve" if principal.is_platform else "notification.approve"
    if not can(principal, action):
        raise HTTPException(status_code=403, detail="You don't have permission to do that.")
    row = db.query(PasswordResetRequest).filter(PasswordResetRequest.id == uuid.UUID(notice.entity_id)).first()
    if not row:
        raise HTTPException(status_code=404, detail="Request not found.")
    actor_user = db.get(User, principal.user_id) if not principal.is_platform else None
    actor_platform = db.get(PlatformUser, principal.user_id) if principal.is_platform else None
    link = decide_request(db, row, actor_user=actor_user, actor_platform=actor_platform, approve=body.approve)
    notice.read_at = notice.read_at or utcnow()
    notice.resolved_at = utcnow()
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    db.commit()
    return {"status": "APPROVED" if body.approve else "DENIED", "resetLink": link}


@router.post("/{notification_id}/password-reset-link")
def reissue_reset_link(notification_id: uuid.UUID, response: Response,
                       principal: Principal = Depends(current_principal), db: DbSession = Depends(get_db)):
    """The original approver can retrieve a fresh one-use link; raw links are never stored."""
    notice = recipient_query(db, principal).filter(Notification.id == notification_id).first()
    if not notice or notice.type != "PASSWORD_RESET":
        raise HTTPException(status_code=404, detail="Notification not found.")
    action = "platform.notification.approve" if principal.is_platform else "notification.approve"
    if not can(principal, action):
        raise HTTPException(status_code=403, detail="You don't have permission to do that.")
    row = db.query(PasswordResetRequest).filter(PasswordResetRequest.id == uuid.UUID(notice.entity_id)).first()
    now = utcnow()
    requester = db.query(User).filter(User.id == row.requester_user_id).with_for_update().first() if row else None
    if requester:
        expire_due_for_user(db, requester, now)
        row = db.query(PasswordResetRequest).filter(PasswordResetRequest.id == row.id).with_for_update().first()
    if (not row or row.status != "APPROVED" or row.expires_at <= now or row.decided_at is None
            or (principal.is_platform and row.decided_by_platform_user_id != principal.user_id)
            or (not principal.is_platform and row.decided_by_user_id != principal.user_id)):
        db.commit()
        raise HTTPException(status_code=409, detail="A reset link is not available for this notification.")
    link = make_reset_link(db, row, db.get(PlatformUser if principal.is_platform else User, principal.user_id))
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    db.commit()
    return {"resetLink": link}
