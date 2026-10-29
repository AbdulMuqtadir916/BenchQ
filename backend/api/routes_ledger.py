"""A firm's ledger: who did what in the firm, newest first (docs/integration/01-ledger.md, 07-auth §4 track 01).

The worked example of a firm-scoped read: the path names the firm, `reader_firm_id` says which firm the caller
may read, `scoped()` adds the filter, and a BDE sees the entries they made (`own_scope`, 07 §2.2) plus the ASSIGN
entries about the candidates they work now (07 Q52: "New assignments" and the handoff note). Another firm's ledger
is 404, the same as a missing firm (principle 4). Platform-only events (`firm_id` null) are the Super Admin's, in
`/api/admin/audit`.

Filters (all optional, combined with AND): `entity_type`, `entity_id` (one record's history, e.g. a candidate's
handoff note), `action` (e.g. ASSIGN) and `candidate_id` (everything about a candidate: its activity, 07 Q53h).
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import String, and_, cast, or_
from sqlalchemy.orm import Session as DbSession

from backend.api.routes_auth import current_principal
from backend.auth import support
from backend.auth.scoping import own_scope, reader_firm_id, scoped
from backend.auth.serialize import ledger_entry_json
from backend.auth.sessions import Principal
from backend.models.candidates import Candidate
from backend.models.db import get_db
from backend.models.tenancy import LedgerEntry

router = APIRouter(prefix="/firms/{firm_id}", tags=["ledger"])


@router.get("/ledger", summary="The firm's ledger, newest first; a BDE's own entries and their candidates' assignments")
def list_ledger(firm_id: uuid.UUID, limit: int = Query(50, ge=1, le=500), offset: int = Query(0, ge=0),
                entity_type: str | None = Query(None, max_length=64), entity_id: str | None = Query(None, max_length=128),
                action: str | None = Query(None, max_length=32), candidate_id: uuid.UUID | None = None,
                principal: Principal = Depends(current_principal), my_firm: uuid.UUID = Depends(reader_firm_id),
                db: DbSession = Depends(get_db)):
    if firm_id != my_firm:
        raise HTTPException(status_code=404, detail="Not found.")
    support.settle_expired(db)      # a support view that ran out shows its end here, dated at its expiry
    db.commit()
    entries = scoped(db, LedgerEntry, my_firm)
    if (actor := own_scope(principal)) is not None:
        # 07 Q52: also who assigned them the candidates they work now, and the note. Nothing else others wrote.
        theirs = scoped(db, Candidate, my_firm, cast(Candidate.id, String)).filter(Candidate.bde_id == actor).scalar_subquery()
        entries = entries.filter(or_(
            LedgerEntry.actor_user_id == actor,
            and_(LedgerEntry.action == "ASSIGN", LedgerEntry.entity_type == "candidate", LedgerEntry.entity_id.in_(theirs)),
        ))
    if entity_type is not None:
        entries = entries.filter(LedgerEntry.entity_type == entity_type)
    if entity_id is not None:
        entries = entries.filter(LedgerEntry.entity_id == entity_id)
    if action is not None:
        entries = entries.filter(LedgerEntry.action == action)
    if candidate_id is not None:     # the candidate's activity (07 Q53h)
        entries = entries.filter(LedgerEntry.candidate_id == candidate_id)
    entries = entries.order_by(LedgerEntry.created_at.desc(), LedgerEntry.id).offset(offset).limit(limit)
    return [ledger_entry_json(e) for e in entries]
