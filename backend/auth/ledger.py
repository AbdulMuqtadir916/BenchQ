"""Writing the business ledger (docs/02 §10, 07-auth §6.6): who did what, append-only.

The caller commits, so the entry lands in the same transaction as the change it records.
"""
from datetime import datetime
import uuid

from sqlalchemy.orm import Session as DbSession

from backend.models.tenancy import LedgerEntry, PlatformUser, User


def record(db: DbSession, *, actor: User | PlatformUser, action: str, entity_type: str, entity_id: uuid.UUID | str,
           entity_label: str, summary: str, firm_id: uuid.UUID | None, at: datetime | None = None,
           note: str | None = None, candidate_id: uuid.UUID | None = None) -> LedgerEntry:
    """`firm_id` is the firm the event belongs to, or None for a platform-only event (A13). `at` dates an event that
    happened before it was noticed (a support view's expiry); otherwise the database's now()."""
    # An entry about a candidate is the candidate's activity (07 Q53h); other writes about one (an application, a
    # résumé, an email) pass `candidate_id` themselves.
    if candidate_id is None and entity_type == "candidate":
        candidate_id = uuid.UUID(str(entity_id))
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
        candidate_id=candidate_id,  # the candidate it is about, if any: every write about a candidate passes it (Q53h)
    )
    if at is not None:
        entry.created_at = at
    db.add(entry)
    return entry


def record_automated(db: DbSession, *, actor_type: str, actor_name: str, action: str,
                     entity_type: str, entity_id: uuid.UUID | str, entity_label: str,
                     summary: str, firm_id: uuid.UUID, candidate_id: uuid.UUID,
                     at: datetime | None = None) -> LedgerEntry:
    """Internal worker audit; automated decisions never borrow a human identity."""
    if actor_type not in {"SYSTEM", "AGENT"}:
        raise ValueError("Automated ledger actor must be SYSTEM or AGENT.")
    entry = LedgerEntry(firm_id=firm_id, candidate_id=candidate_id, actor_type=actor_type,
        actor_user_id=None, actor_name=actor_name, action=action, entity_type=entity_type,
        entity_id=str(entity_id), entity_label=entity_label, summary=summary)
    if at is not None:
        entry.created_at = at
    db.add(entry)
    return entry
