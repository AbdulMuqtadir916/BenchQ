"""The Super Admin's billing record and the firm actions that go with it (07 Q64-Q66, docs/02 §3.5): the base plan's
price, a firm's BDE count, 30-day billing periods, and suspending or reactivating a firm. Super Admin only
(backend/auth/access.py classifies each route PLATFORM); each write needs its platform action and is logged.

Money never reaches a firm. A firm's own ledger shows a BDE-count change as counts only; every entry that carries an
amount or a price is platform-only (`firm_id` null), so no firm-side read can return it."""
import uuid
from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session as DbSession

from backend.auth import ledger
from backend.auth.billing import (candidate_limit_for, dollars, latest_period, new_period, period_json,
                                  sync_current_period, today_ist)
from backend.auth.invites import bad_request, conflict, lock_firm
from backend.auth.policy import require
from backend.auth.sessions import Principal
from backend.models.db import get_db, utcnow
from backend.models.tenancy import BillingPeriod, Firm, Plan, PlatformUser
from backend.api.routes_admin import MAX_SEATS, _get, plan_json
from backend.auth.serialize import admin_firm_json

router = APIRouter(prefix="/admin", tags=["admin"])

MAX_PRICE_CENTS = 10_000_000
MAX_CANDIDATES = 100_000
_ONE_DAY = timedelta(days=1)


# ── The base plan ────────────────────────────────────────────────────────────

class PlanBody(BaseModel):
    name: str | None = Field(default=None, max_length=100)
    seat_limit: int | None = Field(default=None, ge=1, le=MAX_SEATS)           # the default BDE count of a new firm
    price_cents_per_seat: int | None = Field(default=None, ge=0, le=MAX_PRICE_CENTS)


@router.patch("/plans/{plan_id}", summary="Edit the base plan: its name, default BDE count and price per BDE")
def edit_plan(plan_id: uuid.UUID, body: PlanBody, principal: Principal = Depends(require("plan.edit")),
              db: DbSession = Depends(get_db)):
    """Existing firms keep what they were given (A3); only firms created later copy the new numbers."""
    admin = db.get(PlatformUser, principal.user_id)
    plan = _get(db, Plan, plan_id, "Plan")
    changes = []
    if body.name is not None:
        name = body.name.strip()
        if not name:
            raise bad_request("Enter the plan's name.")
        if name != plan.name:
            if db.query(Plan.id).filter(Plan.name == name, Plan.id != plan.id).first() is not None:
                raise bad_request("Another plan already has this name.")
            changes.append(f"name {plan.name} → {name}")
            plan.name = name
    if body.seat_limit is not None and body.seat_limit != plan.seat_limit:
        changes.append(f"BDE seats {plan.seat_limit} → {body.seat_limit}")
        plan.seat_limit = body.seat_limit
        plan.candidate_limit = candidate_limit_for(body.seat_limit)
    if body.price_cents_per_seat is not None and body.price_cents_per_seat != plan.price_cents_per_seat:
        changes.append(f"price per BDE {dollars(plan.price_cents_per_seat)} → {dollars(body.price_cents_per_seat)}")
        plan.price_cents_per_seat = body.price_cents_per_seat
    if changes:
        ledger.record(db, actor=admin, action="PLAN_CHANGED", entity_type="plan", entity_id=plan.id,
                      entity_label=plan.name, summary="Edited the plan: " + "; ".join(changes), firm_id=None)
    db.commit()
    return plan_json(plan)


# ── A firm's BDE count and price ─────────────────────────────────────────────

class SeatsBody(BaseModel):
    seat_limit: int = Field(ge=1, le=MAX_SEATS)
    candidate_limit: int | None = Field(default=None, ge=0, le=MAX_CANDIDATES)   # left out: the firm keeps its own
    price_cents_per_seat: int | None = Field(default=None, ge=0, le=MAX_PRICE_CENTS)


@router.patch("/firms/{firm_id}/seats", summary="Set a firm's BDE count, candidate limit and (optionally) price per BDE")
def set_seats(firm_id: uuid.UUID, body: SeatsBody, principal: Principal = Depends(require("firm.edit")),
              db: DbSession = Depends(get_db)):
    """Q67: the candidate limit is its own number, set here by the Super Admin; a BDE-count change never moves it. It
    is only checked when a candidate is assigned to a BDE (Q45). Allowed below what the firm uses:
    nothing is removed, the firm is over its limit, and new BDE invites and assignments stay blocked until it is under
    (A4). The period running today takes the new numbers, no proration (Q65)."""
    admin = db.get(PlatformUser, principal.user_id)
    _get(db, Firm, firm_id, "Firm")
    firm = lock_firm(db, firm_id)
    old_seats, old_candidates, old_price = firm.seat_limit, firm.candidate_limit, firm.price_cents_per_seat
    price = old_price if body.price_cents_per_seat is None else body.price_cents_per_seat
    candidate_limit = old_candidates if body.candidate_limit is None else body.candidate_limit
    if (body.seat_limit, candidate_limit, price) == (old_seats, old_candidates, old_price):
        return admin_firm_json(firm)
    firm.seat_limit = body.seat_limit
    firm.candidate_limit = candidate_limit
    firm.price_cents_per_seat = price
    if (body.seat_limit, firm.candidate_limit) != (old_seats, old_candidates):
        ledger.record(db, actor=admin, action="PLAN_CHANGED", entity_type="firm_limits", entity_id=firm.id,
                      entity_label=firm.name, firm_id=firm.id,
                      summary=f"BDE seats {old_seats} → {firm.seat_limit}, candidates {old_candidates} → {firm.candidate_limit}")
    if price != old_price:        # a price is billing: platform-only, never in the firm's own ledger (Q66)
        ledger.record(db, actor=admin, action="PLAN_CHANGED", entity_type="billing_terms", entity_id=firm.id,
                      entity_label=firm.name, firm_id=None,
                      summary=f"Price per BDE {dollars(old_price)} → {dollars(price)} for {firm.name}")
    period = sync_current_period(db, firm, today_ist(utcnow()))
    if period is not None:
        ledger.record(db, actor=admin, action="UPDATE", entity_type="billing_period", entity_id=period.id,
                      entity_label=firm.name, firm_id=None,
                      summary=f"Period {period.starts_on} to {period.ends_on} for {firm.name} now "
                              f"{period.seat_limit} BDEs, {dollars(period.amount_cents)}")
    db.commit()
    return admin_firm_json(firm)


# ── Suspend and reactivate ───────────────────────────────────────────────────

class SuspendBody(BaseModel):
    reason: str = Field(max_length=500)


@router.post("/firms/{firm_id}/suspend", summary="Suspend a firm: its people are signed out and blocked")
def suspend_firm(firm_id: uuid.UUID, body: SuspendBody, principal: Principal = Depends(require("firm.suspend")),
                 db: DbSession = Depends(get_db)):
    """Manual only (07 Q18, Q65): an overdue period never suspends anyone. The reason is kept in the firm's ledger."""
    admin = db.get(PlatformUser, principal.user_id)
    reason = body.reason.strip()
    if not reason:
        raise bad_request("Say why the firm is being suspended.")
    _get(db, Firm, firm_id, "Firm")
    firm = lock_firm(db, firm_id)
    if firm.status != "ACTIVE":       # 07 Q29 (docs/04 §14.11): ACTIVE firms only
        raise conflict("This firm is already suspended." if firm.status == "SUSPENDED"
                       else "Only an active firm can be suspended.")
    firm.status = "SUSPENDED"
    ledger.record(db, actor=admin, action="FIRM_SUSPENDED", entity_type="firm", entity_id=firm.id,
                  entity_label=firm.name, summary=f"Suspended {firm.name}", note=reason, firm_id=firm.id)
    db.commit()
    return admin_firm_json(firm)


@router.post("/firms/{firm_id}/reactivate", summary="Reactivate a suspended firm")
def reactivate_firm(firm_id: uuid.UUID, principal: Principal = Depends(require("firm.suspend")),
                    db: DbSession = Depends(get_db)):
    """Back to ACTIVE: only an ACTIVE firm can be suspended, so it had an OWNER who accepted."""
    admin = db.get(PlatformUser, principal.user_id)
    _get(db, Firm, firm_id, "Firm")
    firm = lock_firm(db, firm_id)
    if firm.status != "SUSPENDED":
        raise conflict("This firm isn't suspended.")
    firm.status = "ACTIVE"
    ledger.record(db, actor=admin, action="FIRM_REACTIVATED", entity_type="firm", entity_id=firm.id,
                  entity_label=firm.name, summary=f"Reactivated {firm.name}", firm_id=firm.id)
    db.commit()
    return admin_firm_json(firm)


# ── Billing periods ──────────────────────────────────────────────────────────

class StartPeriodBody(BaseModel):
    starts_on: date | None = None
    note: str | None = Field(default=None, max_length=500)


class PeriodBody(BaseModel):
    status: str | None = Field(default=None, pattern="^(PAID|UNPAID)$")
    paid_on: date | None = None
    note: str | None = Field(default=None, max_length=500)


@router.get("/billing-periods", summary="Every billing period, or one firm's")
def list_periods(firm_id: uuid.UUID | None = Query(default=None), db: DbSession = Depends(get_db)):
    query = db.query(BillingPeriod)
    if firm_id is not None:
        query = query.filter(BillingPeriod.firm_id == firm_id)
    return [period_json(p) for p in query.order_by(BillingPeriod.firm_id, BillingPeriod.starts_on.desc())]


@router.post("/firms/{firm_id}/billing-periods", status_code=201,
             summary="Start the firm's next 30 days from its current limits and price")
def start_period(firm_id: uuid.UUID, body: StartPeriodBody, principal: Principal = Depends(require("billing.edit")),
                 db: DbSession = Depends(get_db)):
    admin = db.get(PlatformUser, principal.user_id)
    _get(db, Firm, firm_id, "Firm")
    firm = lock_firm(db, firm_id)
    last = latest_period(db, firm.id)
    starts_on = body.starts_on or (last.ends_on + _ONE_DAY if last else today_ist(utcnow()))
    if last is not None and starts_on <= last.ends_on:
        raise bad_request(f"The last period runs to {last.ends_on}; the next one must start after that.")
    period = new_period(firm, starts_on, (body.note or "").strip() or None)
    db.add(period)
    db.flush()
    ledger.record(db, actor=admin, action="CREATE", entity_type="billing_period", entity_id=period.id,
                  entity_label=firm.name, firm_id=None,
                  summary=f"Started {period.starts_on} to {period.ends_on} for {firm.name}: {period.seat_limit} BDEs, "
                          f"{dollars(period.amount_cents)}")
    db.commit()
    return period_json(period)


@router.patch("/billing-periods/{period_id}", summary="Mark a period paid or unpaid, or edit its note")
def edit_period(period_id: uuid.UUID, body: PeriodBody, principal: Principal = Depends(require("billing.edit")),
                db: DbSession = Depends(get_db)):
    admin = db.get(PlatformUser, principal.user_id)
    period = _get(db, BillingPeriod, period_id, "Billing period")
    firm = db.get(Firm, period.firm_id)
    if body.status == "PAID":
        period.status, period.paid_on = "PAID", body.paid_on or today_ist(utcnow())
    elif body.status == "UNPAID":
        period.status, period.paid_on = "UNPAID", None
    elif body.paid_on is not None:
        raise bad_request("Set the period paid to give it a paid date.")
    if body.note is not None:
        period.note = body.note.strip() or None
    ledger.record(db, actor=admin, action="UPDATE", entity_type="billing_period", entity_id=period.id,
                  entity_label=firm.name, firm_id=None,
                  summary=f"Period {period.starts_on} to {period.ends_on} for {firm.name} is "
                          f"{period.status.lower()} ({dollars(period.amount_cents)})")
    db.commit()
    return period_json(period)

