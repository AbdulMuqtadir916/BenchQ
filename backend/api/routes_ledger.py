"""A firm's ledger: who did what in the firm, newest first (docs/integration/01-ledger.md, 07-auth §4 track 01).

The worked example of a firm-scoped read: the path names the firm, `reader_firm_id` says which firm the caller
may read, `scoped()` adds the filter, and a BDE sees only the entries they made (`own_scope`, 07 §2.2). Another
firm's ledger is 404, the same as a missing firm (principle 4). Platform-only events (`firm_id` null) are the
Super Admin's, in `/api/admin/audit`.
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session as DbSession

from backend.api.routes_auth import current_principal
from backend.auth.scoping import own_scope, reader_firm_id, scoped
from backend.auth.serialize import ledger_entry_json
from backend.auth.sessions import Principal
from backend.models.db import get_db
from backend.models.tenancy import LedgerEntry

router = APIRouter(prefix="/firms/{firm_id}", tags=["ledger"])


@router.get("/ledger", summary="The firm's ledger, newest first; a BDE's own entries only")
def list_ledger(firm_id: uuid.UUID, limit: int = Query(50, ge=1, le=500), offset: int = Query(0, ge=0),
                principal: Principal = Depends(current_principal), my_firm: uuid.UUID = Depends(reader_firm_id),
                db: DbSession = Depends(get_db)):
    if firm_id != my_firm:
        raise HTTPException(status_code=404, detail="Not found.")
    entries = scoped(db, LedgerEntry, my_firm)
    if (actor := own_scope(principal)) is not None:
        entries = entries.filter(LedgerEntry.actor_user_id == actor)
    entries = entries.order_by(LedgerEntry.created_at.desc(), LedgerEntry.id).offset(offset).limit(limit)
    return [ledger_entry_json(e) for e in entries]
