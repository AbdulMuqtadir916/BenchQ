"""Writing the activity log (docs/02 §10, 07-auth §6.6): who did what, append-only.

The caller commits, so the entry lands in the same transaction as the change it records. Each entry is stamped with who
was responsible at that moment (the actor's role and team, the candidate's manager and BDE), so history stays with the
people it happened under when a candidate or a BDE moves on.
"""
from datetime import datetime, timedelta
import json
import uuid

from fastapi.encoders import jsonable_encoder
from sqlalchemy import text
from sqlalchemy.orm import Session as DbSession

from backend.logging_setup import request_id
from backend.models.candidates import Candidate
from backend.models.db import utcnow
from backend.models.tenancy import ActivityEntry, PlatformUser, User

MASKED = "[masked]"
TOO_LONG = "[too long to show]"
_MASKED_FIELDS = {"email", "phone"}
_MASKED_WORDS = ("password", "token", "secret", "api_key", "hash")
_LONGEST_VALUE = 500
SAME_ATTEMPT_WINDOW = timedelta(seconds=10)


def _shown(field: str, value):
    """A value as the log may keep it: a contact detail or a secret is masked, a long one is left out."""
    if value is None:
        return None
    if field in _MASKED_FIELDS or any(word in field for word in _MASKED_WORDS):
        return MASKED
    encoded = jsonable_encoder(value)
    return TOO_LONG if len(json.dumps(encoded)) > _LONGEST_VALUE else encoded


def diff(before: dict, after: dict) -> dict | None:
    """`{field: {"before": …, "after": …}}` for the fields that changed, masked, or None if none did."""
    changed = {field: {"before": _shown(field, before.get(field)), "after": _shown(field, value)}
               for field, value in after.items() if before.get(field) != value}
    return changed or None


def _stamps(db: DbSession, candidate_id: uuid.UUID | None, person: User | None) -> dict:
    """Who was responsible right now: `person`'s team, and the candidate's manager and BDE."""
    candidate = db.get(Candidate, candidate_id) if candidate_id is not None else None
    team = None
    if person is not None:
        team = person.id if person.role == "MANAGER" else person.manager_id if person.role == "BDE" else None
    return {
        "team_manager_id": team,
        "candidate_manager_id": candidate.manager_id if candidate else None,
        "candidate_bde_id": candidate.bde_id if candidate else None,
        "request_id": request_id.get(),
    }


def record(db: DbSession, *, actor: User | PlatformUser, action: str, entity_type: str, entity_id: uuid.UUID | str,
           entity_label: str, summary: str, firm_id: uuid.UUID | None, candidate_id: uuid.UUID | None,
           at: datetime | None = None, note: str | None = None, changes: dict | None = None) -> ActivityEntry:
    """`firm_id` is the firm the event belongs to, or None for a platform-only event (A13). `candidate_id` is required:
    every write says which candidate it is about (07 Q53h), or None for one about no candidate. `at` dates an event
    that happened before it was noticed (a support view's expiry); otherwise the database's now(). `changes` comes from
    `diff`."""
    # An entry on the candidate itself is that candidate's activity, so None is filled in here.
    if candidate_id is None and entity_type == "candidate":
        candidate_id = uuid.UUID(str(entity_id))
    is_platform = isinstance(actor, PlatformUser)
    entry = ActivityEntry(
        firm_id=firm_id,
        actor_type="PLATFORM_ADMIN" if is_platform else "USER",
        actor_user_id=actor.id,
        actor_name=actor.name,
        actor_role="PLATFORM_ADMIN" if is_platform else actor.role,
        entity_type=entity_type,
        entity_id=str(entity_id),
        entity_label=entity_label,
        action=action,
        summary=summary,
        note=note,                 # the handoff note on an ASSIGN entry (docs/02 §3.4)
        changes=changes,
        candidate_id=candidate_id,  # the candidate it is about, if any: every write about a candidate passes it (Q53h)
        **_stamps(db, candidate_id, None if is_platform else actor),
    )
    if at is not None:
        entry.created_at = at
    db.add(entry)
    return entry


def mask_email(email: str) -> str:
    """What the log keeps of an email nobody owns: anyone can type anything into the form."""
    local, _, domain = email.partition("@")
    return f"{local[:2]}***@{domain[:100]}" if local and domain else "***"


def _sign_in_entry(db: DbSession, *, account: User | PlatformUser | None, email: str, ip: str, action: str,
                   summary: str) -> ActivityEntry:
    """A failed sign-in's entry: on the account it tried, or on nobody for an email with no account."""
    if account is None:
        entry = ActivityEntry(firm_id=None, actor_type="UNKNOWN", actor_name="Unknown account", entity_type="sign_in",
                              entity_id=str(uuid.uuid4()), entity_label=mask_email(email), action=action,
                              summary=f"{mask_email(email)}, {summary}", request_id=request_id.get())
        db.add(entry)
    else:
        is_firm_user = isinstance(account, User)
        entry = record(db, actor=account, action=action, entity_type="user" if is_firm_user else "platform_user",
                       entity_id=account.id, entity_label=account.name, summary=summary,
                       firm_id=account.firm_id if is_firm_user else None, candidate_id=None)
    entry.ip_address = ip
    return entry


def record_sign_in_failure(db: DbSession, *, account: User | PlatformUser | None, email: str, ip: str,
                           reason: str) -> ActivityEntry:
    """Tries on one account from one IP within `SAME_ATTEMPT_WINDOW` of the first share a row, which counts them."""
    # Two tries at the same instant would both find no row and both insert one. A lock on this account and IP, held until
    # the first request commits, makes the second one find the row and count itself on it. Tries on no account share a row
    # by IP alone, whatever email was typed, so they share a lock the same way.
    db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:key))"),
               {"key": f"sign-in-failure:{account.id if account else 'unknown'}:{ip}"})
    same_account = ActivityEntry.actor_user_id == account.id if account else ActivityEntry.actor_type == "UNKNOWN"
    row = db.query(ActivityEntry).filter(ActivityEntry.action == "SIGN_IN_FAILED", ActivityEntry.ip_address == ip,
                                         same_account, ActivityEntry.created_at >= utcnow() - SAME_ATTEMPT_WINDOW) \
        .order_by(ActivityEntry.created_at.desc()).with_for_update().first()
    if row is None:
        return _sign_in_entry(db, account=account, email=email, ip=ip, action="SIGN_IN_FAILED", summary=reason)
    row.attempt_count += 1
    return row


def record_lockout(db: DbSession, *, account: User | PlatformUser | None, email: str, ip: str, attempts: int,
                   minutes: int) -> ActivityEntry:
    unit = "minute" if minutes == 1 else "minutes"
    return _sign_in_entry(db, account=account, email=email, ip=ip, action="LOCKED_OUT",
                          summary=f"Locked for {minutes} {unit} after {attempts} tries")


def record_automated(db: DbSession, *, actor_type: str, actor_name: str, action: str,
                     entity_type: str, entity_id: uuid.UUID | str, entity_label: str,
                     summary: str, firm_id: uuid.UUID, candidate_id: uuid.UUID | None,
                     at: datetime | None = None, on_behalf_of: User | None = None,
                     model_id: str | None = None, note: str | None = None, changes: dict | None = None) -> ActivityEntry:
    """Internal worker audit; automated decisions never borrow a human identity. `on_behalf_of` is the person an AI
    agent worked for: the entry counts towards them and their team, but its actor stays the agent. An AI agent working
    on a candidate (the email classifier on an application, say) works for that candidate's BDE, so it is theirs, and
    their manager's, unless the caller says otherwise. `changes` comes from `diff`."""
    if actor_type not in {"SYSTEM", "AGENT"}:
        raise ValueError("Automated ledger actor must be SYSTEM or AGENT.")
    if on_behalf_of is None and actor_type == "AGENT" and candidate_id is not None:
        candidate = db.get(Candidate, candidate_id)
        if candidate is not None and candidate.bde_id is not None:
            on_behalf_of = db.get(User, candidate.bde_id)
    entry = ActivityEntry(firm_id=firm_id, candidate_id=candidate_id, actor_type=actor_type,
        actor_user_id=None, actor_name=actor_name, actor_role=on_behalf_of.role if on_behalf_of else None,
        action=action, entity_type=entity_type,
        entity_id=str(entity_id), entity_label=entity_label, summary=summary, model_id=model_id, note=note, changes=changes,
        on_behalf_of_user_id=on_behalf_of.id if on_behalf_of else None, **_stamps(db, candidate_id, on_behalf_of))
    if at is not None:
        entry.created_at = at
    db.add(entry)
    return entry


def agent_person(actor_name: str) -> str:
    """The person's name inside an agent's actor name, as it was when the entry was written (`record_agent`)."""
    return actor_name.removeprefix("AI agent (").removesuffix(")")


def record_agent(db: DbSession, *, person: User, action: str, entity_type: str, entity_id: uuid.UUID | str,
                 entity_label: str, summary: str, candidate_id: uuid.UUID | None,
                 model_id: str | None = None) -> ActivityEntry:
    """What an AI agent did for `person`: the actor is the agent, named for them, and it counts towards them."""
    return record_automated(db, actor_type="AGENT", actor_name=f"AI agent ({person.name})", action=action,
                            entity_type=entity_type, entity_id=entity_id, entity_label=entity_label,
                            summary=f"{summary} on behalf of {person.name}", firm_id=person.firm_id,
                            candidate_id=candidate_id, on_behalf_of=person, model_id=model_id)
