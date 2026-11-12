"""A firm's ledger: who did what in the firm, newest first (docs/integration/01-ledger.md, 07-auth §4 track 01).

The worked example of a firm-scoped read: the path names the firm, `reader_firm_id` says which firm the caller
may read, `scoped()` adds the filter, and `_limit_to_reader` narrows it by role: a BDE sees the entries they made
(`own_scope`, 07 §2.2) and a MANAGER the entries they and the BDEs who report to them made (`team_scope`, 07 Q64),
each plus the assignment entries about their candidates (07 Q52: "New assignments" and the handoff note). The OWNER,
a VIEWER and a support view see the firm. Another firm's ledger is 404, the same as a missing firm (principle 4).
Platform-only events (`firm_id` null) are the Super Admin's, in `/api/admin/audit`.

Filters (all optional, combined with AND, always inside what the reader may read): `entity_type`, `entity_id` (one
record's history, e.g. a candidate's handoff note), `action` (e.g. ASSIGN) and `candidate_id` (a candidate's activity,
07 Q53h: everything about it for the firm-wide readers).
"""
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import String, and_, cast, or_
from sqlalchemy.orm import Session as DbSession

from backend.api.routes_auth import current_principal
from backend.auth import support
from backend.auth.scoping import own_scope, reader_firm_id, scoped, team_scope
from backend.auth.serialize import ledger_entry_json
from backend.auth.sessions import Principal
from backend.models.candidates import Candidate
from backend.models.db import get_db
from backend.models.tenancy import LedgerEntry, User

router = APIRouter(prefix="/firms/{firm_id}", tags=["ledger"])


def _limit_to_reader(entries, db: DbSession, principal: Principal, firm_id: uuid.UUID):
    """What a principal's role lets them read of `entries`, the firm's rows (07 Q52, Q64). Every filter a request adds
    goes on top of this, so no filter can widen it. Pairs with `scoped()`, never instead of it."""
    bde, manager = own_scope(principal), team_scope(principal)
    if bde is not None:
        by_them = LedgerEntry.actor_user_id == bde
        their_candidates = Candidate.bde_id == bde
    elif manager is not None:
        reports = scoped(db, User, firm_id, User.id).filter(User.manager_id == manager).scalar_subquery()
        by_them = or_(LedgerEntry.actor_user_id == manager, LedgerEntry.actor_user_id.in_(reports))
        their_candidates = Candidate.manager_id == manager
    else:
        return entries      # the OWNER, a VIEWER and a support view read the firm
    theirs = scoped(db, Candidate, firm_id, cast(Candidate.id, String)).filter(their_candidates).scalar_subquery()
    return entries.filter(or_(
        by_them,
        and_(LedgerEntry.action == "ASSIGN", LedgerEntry.entity_type == "candidate", LedgerEntry.entity_id.in_(theirs)),
    ))


@router.get("/ledger", summary="The firm's ledger, newest first; a MANAGER's team, or a BDE's own, plus their candidates' assignments")
def list_ledger(firm_id: uuid.UUID, limit: int = Query(50, ge=1, le=500), offset: int = Query(0, ge=0),
                entity_type: str | None = Query(None, max_length=64), entity_id: str | None = Query(None, max_length=128),
                action: str | None = Query(None, max_length=32), candidate_id: uuid.UUID | None = None,
                cursor_at: datetime | None = None, cursor_id: uuid.UUID | None = None,
                principal: Principal = Depends(current_principal), my_firm: uuid.UUID = Depends(reader_firm_id),
                db: DbSession = Depends(get_db)):
    if firm_id != my_firm:
        raise HTTPException(status_code=404, detail="Not found.")
    if (cursor_at is None) != (cursor_id is None) or (cursor_at is not None and cursor_at.utcoffset() is None):
        raise HTTPException(status_code=422, detail="Supply both cursor fields, with a timezone.")
    support.settle_expired(db)      # a support view that ran out shows its end here, dated at its expiry
    db.commit()
    entries = _limit_to_reader(scoped(db, LedgerEntry, my_firm), db, principal, my_firm)
    if entity_type is not None:
        entries = entries.filter(LedgerEntry.entity_type == entity_type)
    if entity_id is not None:
        entries = entries.filter(LedgerEntry.entity_id == entity_id)
    if action is not None:
        entries = entries.filter(LedgerEntry.action == action)
    if candidate_id is not None:     # the candidate's activity (07 Q53h)
        entries = entries.filter(LedgerEntry.candidate_id == candidate_id)
    if cursor_at is not None and cursor_id is not None:
        entries = entries.filter(or_(
            LedgerEntry.created_at < cursor_at,
            and_(LedgerEntry.created_at == cursor_at, LedgerEntry.id > cursor_id),
        ))
    entries = entries.order_by(LedgerEntry.created_at.desc(), LedgerEntry.id).offset(offset).limit(limit)
    return [ledger_entry_json(e, hide_email=principal.support_view_id is not None) for e in entries]
