"""The session's wire shape: the frontend's `SessionSchema` (src/lib/schemas/session.ts) in snake_case, mapped
by src/lib/api/dto/session.ts (07-auth F3). Usage (seats, active candidates) is derived elsewhere, never here."""
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session as DbSession

from backend.auth.ledger import agent_person
from backend.auth.sessions import Principal
from backend.models.tenancy import Firm, ActivityEntry, PlatformUser, SupportView, User


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def firm_json(firm: Firm) -> dict:
    return {
        "id": str(firm.id), "name": firm.name, "slug": firm.slug, "logo_url": firm.logo_url,
        "primary_timezone": firm.primary_timezone, "client_timezone": firm.client_timezone,
        "application_expiry_days": firm.application_expiry_days,
        "status": firm.status, "plan_id": str(firm.plan_id), "seat_limit": firm.seat_limit,
        "candidate_limit": firm.candidate_limit, "contact_phone": firm.contact_phone,
        "bde_capacity": firm.bde_capacity, "created_at": _iso(firm.created_at),
    }


def user_json(user: User) -> dict:
    return {
        "id": str(user.id), "firm_id": str(user.firm_id), "name": user.name, "email": user.email,
        "role": user.role, "manager_id": str(user.manager_id) if user.manager_id else None,
        "avatar_url": user.avatar_url, "is_active": user.is_active,
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


EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


def _cursor(entry: ActivityEntry) -> str | None:
    """The page marker for reading on after this row (routes_ledger `cursor`); none for a row not yet saved."""
    if entry.created_at is None:
        return None
    return f"{(entry.created_at - EPOCH) // timedelta(microseconds=1)}_{entry.id}"


# What a platform admin reading the ledger (the audit, or a support view) sees instead of a firm's own content:
# entity_type → (label, or None to keep it; summary). The entry still says what happened, to whom, by whom and when.
# A job search's role and country, and a job's title and company, are the firm's business (job search PR 1,
# Abdul's review, P2).
_RESTRICTED = {
    "email": (None, "Candidate inbox activity (content restricted)."),
    "job_search": ("Job search", "Searched jobs (content restricted)."),
    "job_posting": ("Captured job", "Captured a job (content restricted)."),        # job search PR 2
}


def ledger_entry_json(entry: ActivityEntry, *, hide_email: bool = False, candidate_name: str | None = None) -> dict:
    """The frontend's LedgerEntry (src/lib/schemas/analytics.ts) in snake_case, with what the log adds to it.
    `hide_email`: the reader is a platform admin, so a restricted entry's content is replaced (`_RESTRICTED`) and its
    before/after values are left out."""
    restricted = _RESTRICTED.get(entry.entity_type) if hide_email else None
    hidden = restricted is not None
    # A hand-off's note is what the firm wrote about its candidate: not for a platform admin (CodeAnt on #135, done at
    # Abdul's request). The entry itself (who was moved where) stays.
    note = None if restricted or (hide_email and entry.action == "ASSIGN") else entry.note
    return {
        "id": str(entry.id), "firm_id": str(entry.firm_id) if entry.firm_id else None,
        "candidate_id": str(entry.candidate_id) if entry.candidate_id else None,
        "actor_user_id": str(entry.actor_user_id) if entry.actor_user_id else None, "actor_type": entry.actor_type,
        "actor_name": entry.actor_name, "entity_type": entry.entity_type, "entity_id": entry.entity_id,
        "entity_label": (restricted[0] or entry.entity_label) if restricted else entry.entity_label,
        "action": entry.action,
        "summary": restricted[1] if restricted else entry.summary,
        "note": note,
        "model_id": entry.model_id, "prompt_version": entry.prompt_version,
        "created_at": _iso(entry.created_at), "cursor": _cursor(entry), "candidate_name": candidate_name,
        "actor_role": entry.actor_role,
        "on_behalf_of_user_id": str(entry.on_behalf_of_user_id) if entry.on_behalf_of_user_id else None,
        "on_behalf_of_name": agent_person(entry.actor_name) if entry.on_behalf_of_user_id else None,
        "team_manager_id": str(entry.team_manager_id) if entry.team_manager_id else None,
        "candidate_manager_id": str(entry.candidate_manager_id) if entry.candidate_manager_id else None,
        "candidate_bde_id": str(entry.candidate_bde_id) if entry.candidate_bde_id else None,
        "changes": None if hidden else entry.changes,
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
