"""The session's wire shape: the frontend's `SessionSchema` (src/lib/schemas/session.ts) in snake_case, mapped
by src/lib/api/dto/session.ts (07-auth F3). Usage (seats, active candidates) is derived elsewhere, never here."""
from datetime import datetime

from sqlalchemy.orm import Session as DbSession

from backend.auth.sessions import Principal
from backend.models.tenancy import Firm, PlatformUser, SupportView, User


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def firm_json(firm: Firm) -> dict:
    return {
        "id": str(firm.id), "name": firm.name, "slug": firm.slug, "logo_url": firm.logo_url,
        "primary_timezone": firm.primary_timezone, "client_timezone": firm.client_timezone,
        "truth_guard_mode": firm.truth_guard_mode, "application_expiry_days": firm.application_expiry_days,
        "status": firm.status, "plan_id": str(firm.plan_id), "seat_limit": firm.seat_limit,
        "candidate_limit": firm.candidate_limit, "contact_phone": firm.contact_phone,
        "created_at": _iso(firm.created_at),
    }


def user_json(user: User) -> dict:
    return {
        "id": str(user.id), "firm_id": str(user.firm_id), "name": user.name, "email": user.email,
        "role": user.role, "avatar_url": user.avatar_url, "is_active": user.is_active,
        "last_active_at": _iso(user.last_active_at),
    }


def platform_user_json(admin: PlatformUser) -> dict:
    return {
        "id": str(admin.id), "name": admin.name, "email": admin.email, "role": "PLATFORM_ADMIN",
        "is_active": admin.is_active, "last_active_at": _iso(admin.last_active_at),
    }


def support_view_json(view: SupportView) -> dict:
    return {
        "id": str(view.id), "firm_id": str(view.firm_id), "reason": view.reason,
        "started_at": _iso(view.started_at), "expires_at": _iso(view.expires_at),
    }


def session_json(db: DbSession, principal: Principal) -> dict:
    """A firm session (principal, user, firm) or a platform session (principal with support, platform_user,
    and the support view's firm or null)."""
    if principal.kind == "firm":
        user = db.get(User, principal.user_id)
        return {
            "principal": {"kind": "firm", "user_id": str(user.id), "firm_id": str(user.firm_id), "role": user.role},
            "user": user_json(user),
            "firm": firm_json(db.get(Firm, user.firm_id)),
        }
    admin = db.get(PlatformUser, principal.user_id)
    view = db.get(SupportView, principal.support_view_id) if principal.support_view_id else None
    return {
        "principal": {"kind": "platform", "user_id": str(admin.id), "role": "PLATFORM_ADMIN",
                      "support": support_view_json(view) if view else None},
        "platform_user": platform_user_json(admin),
        "firm": firm_json(db.get(Firm, view.firm_id)) if view else None,
    }
