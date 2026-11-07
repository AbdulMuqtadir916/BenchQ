"""The Super Admin's activity log: every entry on the platform and in every firm, read-only (07 A13).

Entries a firm reader never gets are here too: failed sign-ins and lockouts. Email text stays out, as in a support view.
An IP address is never in a list: it comes one row at a time, from `/{entry_id}/ip`. Days are IST (docs/04 §14).
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session as DbSession

from backend.api.routes_auth import current_principal
from backend.api.routes_ledger import SORTS, Filters, people_in_view
from backend.auth import support
from backend.auth.serialize import ledger_entry_json
from backend.auth.sessions import Principal
from backend.models.candidates import Candidate
from backend.models.db import get_db
from backend.models.tenancy import (ACTIVITY_ACTOR_TYPES, SUPER_ADMIN_ONLY_ACTIONS, ActivityEntry, Firm, PlatformUser,
                                    User)

router = APIRouter(prefix="/admin/activity", tags=["admin"])

ZONE = "Asia/Kolkata"


class View:
    """Which part of the log is on show: a firm, or only the failed sign-ins."""

    def __init__(self, firm_id: uuid.UUID | None = None, failed: bool = False):
        self.firm_id, self.failed = firm_id, failed


def _rows(db: DbSession, view: View, filters: Filters, *, person: bool = True, candidate: bool = True, firm: bool = True):
    entries = db.query(ActivityEntry)
    if firm and view.firm_id is not None:
        entries = entries.filter(ActivityEntry.firm_id == view.firm_id)
    if firm and view.failed:
        entries = entries.filter(ActivityEntry.action.in_(SUPER_ADMIN_ONLY_ACTIONS))
    return filters.apply(entries, ZONE, hide_email=True, person=person, candidate=candidate)


@router.get("", summary="Every entry on the platform, newest first")
def list_activity(limit: int = Query(50, ge=1, le=500), offset: int = Query(0, ge=0),
                  sort: str = Query("when", pattern="^(when|actor|action)$"),
                  direction: str = Query("desc", alias="dir", pattern="^(asc|desc)$"), view: View = Depends(),
                  filters: Filters = Depends(), db: DbSession = Depends(get_db)):
    support.settle_expired(db)
    db.commit()
    column = SORTS[sort]
    entries = _rows(db, view, filters).order_by(column.asc() if direction == "asc" else column.desc(),
                                                ActivityEntry.created_at.desc(), ActivityEntry.id.desc()) \
        .offset(offset).limit(limit).all()
    candidates = dict(db.query(Candidate.id, Candidate.full_name)
                      .filter(Candidate.id.in_({e.candidate_id for e in entries if e.candidate_id})).all())
    firms = dict(db.query(Firm.id, Firm.name).filter(Firm.id.in_({e.firm_id for e in entries if e.firm_id})).all())
    return [{**ledger_entry_json(e, hide_email=True, candidate_name=candidates.get(e.candidate_id)),
             "firm_name": firms.get(e.firm_id)} for e in entries]


@router.get("/overview", summary="The counts beside the log: the whole platform, your own, failed sign-ins, each firm")
def overview(view: View = Depends(), filters: Filters = Depends(), principal: Principal = Depends(current_principal),
             db: DbSession = Depends(get_db)):
    """Counts follow the filters but not what is picked, so the list doesn't shrink as a row is chosen."""
    entries = _rows(db, view, filters, person=False, firm=False)
    per_firm = dict(entries.filter(ActivityEntry.firm_id.isnot(None)).with_entities(ActivityEntry.firm_id, func.count())
                    .group_by(ActivityEntry.firm_id).all())
    managers = dict(db.query(User.firm_id, func.count()).filter(User.role == "MANAGER", User.is_active)
                    .group_by(User.firm_id).all())
    me = db.get(PlatformUser, principal.user_id)
    return {
        "timezone": ZONE, "actor_types": list(ACTIVITY_ACTOR_TYPES), "total": entries.count(),
        "matching": _rows(db, view, filters).count(),
        "failed": entries.filter(ActivityEntry.action.in_(SUPER_ADMIN_ONLY_ACTIONS)).count(),
        "me": {"user_id": str(me.id), "name": me.name, "actions": entries.filter(ActivityEntry.actor_user_id == me.id).count()},
        "firms": [{"id": str(firm.id), "name": firm.name, "managers": managers.get(firm.id, 0), "actions": per_firm.get(firm.id, 0)}
                  for firm in db.query(Firm).order_by(Firm.name, Firm.id)],
    }


@router.get("/people", summary="A firm's people, with each person's action count")
def people(firm_id: uuid.UUID, filters: Filters = Depends(), db: DbSession = Depends(get_db)):
    firm = db.get(Firm, firm_id)
    if firm is None:
        raise HTTPException(status_code=404, detail="Not found.")
    view = View(firm_id=firm_id)
    entries = _rows(db, view, filters, person=False)
    return {"timezone": ZONE, "actor_types": list(ACTIVITY_ACTOR_TYPES), "total": entries.count(),
            "matching": _rows(db, view, filters).count(), "people": people_in_view(db, firm_id, entries)}


@router.get("/days", summary="The days with activity, in IST")
def days(view: View = Depends(), filters: Filters = Depends(), db: DbSession = Depends(get_db)):
    day = func.to_char(func.timezone(ZONE, ActivityEntry.created_at), "YYYY-MM-DD")
    return sorted(row[0] for row in _rows(db, view, filters).with_entities(day).distinct())


@router.get("/candidates", summary="The candidates with a row on show")
def candidates(view: View = Depends(), filters: Filters = Depends(), db: DbSession = Depends(get_db)):
    entries = _rows(db, view, filters, candidate=False)
    ids = entries.filter(ActivityEntry.candidate_id.isnot(None)).with_entities(ActivityEntry.candidate_id).distinct()
    rows = db.query(Candidate.id, Candidate.full_name).filter(Candidate.id.in_(ids.scalar_subquery())) \
        .order_by(Candidate.full_name, Candidate.id)
    return [{"id": str(row.id), "name": row.full_name} for row in rows]


@router.get("/{entry_id}/ip", summary="The IP address behind a failed sign-in or lockout")
def entry_ip(entry_id: uuid.UUID, db: DbSession = Depends(get_db)):
    entry = db.get(ActivityEntry, entry_id)
    if entry is None or entry.action not in SUPER_ADMIN_ONLY_ACTIONS:
        raise HTTPException(status_code=404, detail="Not found.")
    return {"ip_address": entry.ip_address}
