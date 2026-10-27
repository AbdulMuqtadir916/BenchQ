"""Writing the business ledger (docs/02 §10, 07-auth §6.6): who did what, append-only.

The caller commits, so the entry lands in the same transaction as the change it records.
"""
from datetime import datetime
import uuid

from sqlalchemy.orm import Session as DbSession

from backend.models.tenancy import LedgerEntry, PlatformUser, User


def record(db: DbSession, *, actor: User | PlatformUser, action: str, entity_type: str, entity_id: uuid.UUID | str,
           entity_label: str, summary: str, firm_id: uuid.UUID | None, at: datetime | None = None,
           note: str | None = None) -> LedgerEntry:
    """`firm_id` is the firm the event belongs to, or None for a platform-only event (A13). `at` dates an event that
    happened before it was noticed (a support view's expiry); otherwise the database's now()."""
    entry = LedgerEntry(
        firm_id=firm_id,
        actor_type="PLATFORM_ADMIN" if isinstance(actor, PlatformUser) else "USER",
        actor_user_id=actor.id,
        actor_name=actor.name,
        entity_type=entity_type,
        entity_id=str(entity_id),
        entity_label=entity_label,
        action=action,
        summary=summary,
        note=note,                 # the handoff note on an ASSIGN entry (docs/02 §3.4)
    )
    if at is not None:
        entry.created_at = at
    db.add(entry)
    return entry
