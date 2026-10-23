"""Checking that a write logged its ledger entry (docs/integration/01-ledger.md, "Every write logs").

Every write a person makes records who did what, in the same transaction (backend/auth/ledger.py). A track's
write test calls `assert_logged` after the request:

    assert_logged(test_db, action="CREATE", entity_type="candidate", entity_id=body["id"], firm_id=accounts.firm_id)
"""
import uuid


def assert_logged(db, *, action: str, entity_type: str, entity_id, firm_id: uuid.UUID | None,
                  actor_user_id: uuid.UUID | None = None):
    """The one entry for this action on this entity, in this firm (and by this actor, when given). Returns it, so
    a test can check its summary."""
    from backend.models.tenancy import LedgerEntry
    db.expire_all()
    query = db.query(LedgerEntry).filter(LedgerEntry.action == action, LedgerEntry.entity_type == entity_type,
                                         LedgerEntry.entity_id == str(entity_id), LedgerEntry.firm_id == firm_id)
    if actor_user_id is not None:
        query = query.filter(LedgerEntry.actor_user_id == actor_user_id)
    entries = query.all()
    assert len(entries) == 1, f"expected one {action} entry for {entity_type} {entity_id}, found {len(entries)}"
    return entries[0]
