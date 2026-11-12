"""A firm's activity log: who did what in the firm, newest first (docs/integration/01-ledger.md, 07-auth §4 track 01).

The path stays `/ledger`; the rows are in `activity_logs`. The path names the firm, `reader_firm_id` says which firm the
caller may read, `scoped()` adds the filter, and `_limit_to_reader` applies the role. Another firm's log is 404, the
same as a missing firm (principle 4). Platform-only events (`firm_id` null) are the Super Admin's, in `/api/admin/audit`.

History follows the stamps on each entry, not today's assignments: what a BDE or manager did stays theirs after they
move. OWNER, VIEWER and a support view read the whole firm. A MANAGER reads their team's actions, a BDE their own and
their AI agents'. Each also sees the assignments on their side, and, once a candidate is picked, everything on it from
while it was theirs.

Days are the firm's own (`firms.primary_timezone`). `cursor` pages by the last row seen, so a row added meanwhile
never repeats or skips one.
"""
from collections import Counter
from datetime import date, datetime, time, timedelta, timezone
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import DateTime, String, and_, cast, func, literal, or_
from sqlalchemy.orm import Session as DbSession

from backend.api.routes_auth import current_principal
from backend.auth import support
from backend.auth.scoping import own_scope, reader_firm_id, scoped, team_scope
from backend.auth.serialize import EPOCH, ledger_entry_json
from backend.auth.sessions import Principal
from backend.candidates import profile
from backend.models.candidates import Candidate
from backend.models.db import get_db
from backend.models.tenancy import LEDGER_ACTOR_TYPES, ActivityEntry, Firm, User

router = APIRouter(prefix="/firms/{firm_id}", tags=["ledger"])


class Filters:
    """The filters every log read shares, all optional, combined with AND."""

    def __init__(self, entity_type: str | None = Query(None, max_length=64),
                 entity_id: str | None = Query(None, max_length=128), action: str | None = Query(None, max_length=32),
                 candidate_id: uuid.UUID | None = None, actor_id: uuid.UUID | None = None,
                 team_id: uuid.UUID | None = None, actor_type: str | None = Query(None, max_length=32),
                 from_date: date | None = None, to_date: date | None = None,
                 q: str | None = Query(None, min_length=1, max_length=100)):
        self.entity_type, self.entity_id, self.action = entity_type, entity_id, action
        self.candidate_id, self.actor_id, self.team_id, self.actor_type = candidate_id, actor_id, team_id, actor_type
        self.from_date, self.to_date, self.q = from_date, to_date, q

    def apply(self, entries, db: DbSession, firm_id: uuid.UUID, *, hide_email: bool, person: bool = True,
              candidate: bool = True):
        """`person=False` leaves out who was picked, for the counts beside them; `candidate=False` the candidate, for
        the list to pick one from."""
        for column, value in ((ActivityEntry.entity_type, self.entity_type), (ActivityEntry.entity_id, self.entity_id),
                              (ActivityEntry.action, self.action), (ActivityEntry.actor_type, self.actor_type)):
            if value is not None:
                entries = entries.filter(column == value)
        if candidate and self.candidate_id is not None:
            entries = entries.filter(ActivityEntry.candidate_id == self.candidate_id)
        if person and self.actor_id is not None:
            entries = entries.filter(or_(ActivityEntry.actor_user_id == self.actor_id,
                                         ActivityEntry.on_behalf_of_user_id == self.actor_id))
        if person and self.team_id is not None:
            entries = entries.filter(ActivityEntry.team_manager_id == self.team_id)
        if self.from_date is not None or self.to_date is not None:
            zone = db.get(Firm, firm_id).primary_timezone
            if self.from_date is not None:
                entries = entries.filter(ActivityEntry.created_at >= _start_of(self.from_date, zone))
            if self.to_date is not None:
                entries = entries.filter(ActivityEntry.created_at < _start_of(self.to_date + timedelta(days=1), zone))
        if self.q is not None:
            summary = ActivityEntry.summary.icontains(self.q, autoescape=True)
            if hide_email:      # what the support view can't read, it can't search for either
                summary = and_(ActivityEntry.entity_type != "email", summary)
            entries = entries.filter(or_(summary, ActivityEntry.actor_name.icontains(self.q, autoescape=True),
                                         ActivityEntry.entity_label.icontains(self.q, autoescape=True)))
        return entries


def _start_of(day: date, zone: str):
    """The moment a day starts in the firm's time zone."""
    return func.timezone(zone, literal(datetime.combine(day, time.min), DateTime()))


def _limit_to_reader(entries, db: DbSession, principal: Principal, firm_id: uuid.UUID, *, picked: bool):
    """What the role may read (07 Q52, Q59). `picked`: a candidate is chosen, so the rows on it from while it was
    theirs count too."""
    bde, manager = own_scope(principal), team_scope(principal)
    if bde is not None:
        me, side, then = bde, "bde_id", ActivityEntry.candidate_bde_id
        by_them = or_(ActivityEntry.actor_user_id == bde, ActivityEntry.on_behalf_of_user_id == bde)
        now = Candidate.bde_id == bde
    elif manager is not None:
        me, side, then = manager, "manager_id", ActivityEntry.candidate_manager_id
        by_them = or_(ActivityEntry.actor_user_id == manager, ActivityEntry.team_manager_id == manager)
        now = Candidate.manager_id == manager
    else:
        return entries
    theirs_now = scoped(db, Candidate, firm_id, cast(Candidate.id, String)).filter(now).scalar_subquery()
    # An assignment is seen by both sides: whoever got the candidate, and whoever it came from.
    assignment = and_(ActivityEntry.action == "ASSIGN", ActivityEntry.entity_type == "candidate",
                      or_(then == me, ActivityEntry.changes[(side, "before")].astext == str(me),
                          ActivityEntry.entity_id.in_(theirs_now)))
    return entries.filter(or_(by_them, assignment, *([then == me] if picked else [])))


def _visible(db: DbSession, principal: Principal, firm_id: uuid.UUID, filters: Filters, *, person: bool = True,
             candidate: bool = True):
    picked = candidate and filters.candidate_id is not None
    entries = _limit_to_reader(scoped(db, ActivityEntry, firm_id), db, principal, firm_id, picked=picked)
    return filters.apply(entries, db, firm_id, hide_email=principal.support_view_id is not None, person=person,
                         candidate=candidate)


def _after_cursor(entries, cursor: str):
    """The rows after the one `cursor` names (`<microseconds since 1970>_<id>`, as each row carries it), in the
    list's order: older first, and among rows at the same moment, the higher id."""
    try:
        micros, row_id = cursor.split("_", 1)
        at, row_id = EPOCH + timedelta(microseconds=int(micros)), uuid.UUID(row_id)
    except (ValueError, OverflowError):
        raise HTTPException(status_code=400, detail="That page marker isn't valid.")
    return entries.filter(or_(ActivityEntry.created_at < at, and_(ActivityEntry.created_at == at, ActivityEntry.id > row_id)))


@router.get("/ledger", summary="The firm's activity log, newest first, limited by role")
def list_ledger(firm_id: uuid.UUID, limit: int = Query(50, ge=1, le=500), offset: int = Query(0, ge=0),
                cursor: str | None = Query(None, max_length=128), filters: Filters = Depends(),
                cursor_at: datetime | None = None, cursor_id: uuid.UUID | None = None,
                principal: Principal = Depends(current_principal), my_firm: uuid.UUID = Depends(reader_firm_id),
                db: DbSession = Depends(get_db)):
    if firm_id != my_firm:
        raise HTTPException(status_code=404, detail="Not found.")
    if (cursor_at is None) != (cursor_id is None) or (cursor_at is not None and cursor_at.utcoffset() is None):
        raise HTTPException(status_code=422, detail="Supply both cursor fields, with a timezone.")
    support.settle_expired(db)      # a support view that ran out shows its end here, dated at its expiry
    db.commit()
    entries = _visible(db, principal, my_firm, filters)
    if cursor is not None:
        entries = _after_cursor(entries, cursor)
    if cursor_at is not None:
        # The same marker as two fields (the whole-ledger paging on main, BUG-022): the rows after that one, in
        # this order. Both or neither, with a timezone (checked above).
        entries = entries.filter(or_(ActivityEntry.created_at < cursor_at,
                                     and_(ActivityEntry.created_at == cursor_at, ActivityEntry.id > cursor_id)))
    # Newest first; rows at the same moment by id, lowest first, as on main (the page markers depend on it).
    entries = entries.order_by(ActivityEntry.created_at.desc(), ActivityEntry.id).offset(offset).limit(limit)
    return [ledger_entry_json(e, hide_email=principal.support_view_id is not None) for e in entries]


@router.get("/ledger/people", summary="Who the reader can see in the log, with each person's action count")
def ledger_people(firm_id: uuid.UUID, filters: Filters = Depends(), principal: Principal = Depends(current_principal),
                  my_firm: uuid.UUID = Depends(reader_firm_id), db: DbSession = Depends(get_db)):
    """Counts follow the other filters but not who is picked, so the list doesn't shrink as someone is chosen. An AI's
    action counts towards the person it worked for. A former member appears only if they have rows to show."""
    if firm_id != my_firm:
        raise HTTPException(status_code=404, detail="Not found.")
    entries = _visible(db, principal, my_firm, filters, person=False)
    counts = Counter()
    for column in (ActivityEntry.actor_user_id, ActivityEntry.on_behalf_of_user_id):
        counts.update(dict(entries.filter(column.isnot(None)).with_entities(column, func.count()).group_by(column).all()))
    bde, manager = own_scope(principal), team_scope(principal)
    people = []
    for user in scoped(db, User, my_firm).order_by(User.name, User.id):
        if bde is not None and user.id != bde:
            continue
        in_view = user.is_active and (manager is None or manager in (user.id, user.manager_id))
        # A manager also reads the assignments others made; that doesn't make the owner a member of their team.
        was_member = counts[user.id] > 0 and (manager is None or user.role == "BDE")
        if in_view or was_member:
            people.append({"user_id": str(user.id), "name": user.name, "role": user.role,
                           "manager_id": str(user.manager_id) if user.manager_id else None,
                           "is_former": not in_view, "actions": counts[user.id]})
    types = [] if bde is not None else [t for t in LEDGER_ACTOR_TYPES if manager is None or t in ("USER", "AGENT")]
    return {"timezone": db.get(Firm, my_firm).primary_timezone, "actor_types": types, "total": entries.count(),
            "people": people}


@router.get("/ledger/candidates", summary="The candidates the reader can pick in the log")
def ledger_candidates(firm_id: uuid.UUID, filters: Filters = Depends(),
                      principal: Principal = Depends(current_principal), my_firm: uuid.UUID = Depends(reader_firm_id),
                      db: DbSession = Depends(get_db)):
    """The candidates with a row the reader can see, narrowed by the person or team picked."""
    if firm_id != my_firm:
        raise HTTPException(status_code=404, detail="Not found.")
    entries = _visible(db, principal, my_firm, filters, candidate=False)
    ids = entries.filter(ActivityEntry.candidate_id.isnot(None)).with_entities(ActivityEntry.candidate_id).distinct()
    rows = scoped(db, Candidate, my_firm).filter(Candidate.id.in_(ids.scalar_subquery())).all()
    profile.prime(db, my_firm, rows)
    return candidate_options(rows)


def candidate_options(candidates) -> list[dict]:
    """Candidates by name: the name is the résumé's (07 Q57), so it is sorted here, not in the query."""
    named = sorted(((candidate.full_name, str(candidate.id)) for candidate in candidates), key=lambda row: (row[0].lower(), row[1]))
    return [{"id": candidate_id, "name": name} for name, candidate_id in named]
