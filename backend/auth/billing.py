"""Billing records (07 Q64-Q66, docs/02 §3.5): Super Admin only, no payment provider. A new firm's candidate limit starts at
CANDIDATES_PER_SEAT times its BDE count and is then set by the Super Admin (Q67); a 30-day period snapshots the numbers it was billed on, and the amount
is the BDE count times the price, calculated here and nowhere else. Nothing here is serialized to a firm user."""
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session as DbSession

from backend.job_search.limits import JOBS_PER_CANDIDATE_PER_DAY
from backend.models.tenancy import BillingPeriod, Firm

CANDIDATES_PER_SEAT = 10
PERIOD_DAYS = 30
IST = ZoneInfo("Asia/Kolkata")     # the Super Admin works in India; "today" for a period is the date there


def today_ist(now: datetime) -> date:
    return now.astimezone(IST).date()


def candidate_limit_for(seat_limit: int) -> int:
    return CANDIDATES_PER_SEAT * seat_limit


def amount_cents(seat_limit: int, price_cents_per_seat: int) -> int:
    return seat_limit * price_cents_per_seat


def period_json(period: BillingPeriod) -> dict:
    return {
        "id": str(period.id), "firm_id": str(period.firm_id),
        "starts_on": period.starts_on.isoformat(), "ends_on": period.ends_on.isoformat(),
        "seat_limit": period.seat_limit, "candidate_limit": period.candidate_limit,
        "jobs_per_candidate_per_day": period.jobs_per_candidate_per_day,
        "price_cents_per_seat": period.price_cents_per_seat, "amount_cents": period.amount_cents,
        "status": period.status, "paid_on": period.paid_on.isoformat() if period.paid_on else None,
        "note": period.note, "created_at": period.created_at.isoformat(),
    }


def latest_period(db: DbSession, firm_id) -> BillingPeriod | None:
    return (db.query(BillingPeriod).filter(BillingPeriod.firm_id == firm_id)
            .order_by(BillingPeriod.starts_on.desc()).first())


def current_period(db: DbSession, firm_id, today: date) -> BillingPeriod | None:
    return (db.query(BillingPeriod)
            .filter(BillingPeriod.firm_id == firm_id, BillingPeriod.starts_on <= today, BillingPeriod.ends_on >= today)
            .first())


def new_period(firm: Firm, starts_on: date, note: str | None) -> BillingPeriod:
    """A period from the firm's limits and price as they are now (Q65)."""
    return BillingPeriod(
        firm_id=firm.id, starts_on=starts_on, ends_on=starts_on + timedelta(days=PERIOD_DAYS),
        seat_limit=firm.seat_limit, candidate_limit=firm.candidate_limit,
        jobs_per_candidate_per_day=JOBS_PER_CANDIDATE_PER_DAY, price_cents_per_seat=firm.price_cents_per_seat,
        amount_cents=amount_cents(firm.seat_limit, firm.price_cents_per_seat), status="UNPAID", note=note)


def sync_current_period(db: DbSession, firm: Firm, today: date) -> BillingPeriod | None:
    """A change to the firm's BDE count or price applies to the period running today, without proration (Q65)."""
    period = current_period(db, firm.id, today)
    if period is not None:
        period.seat_limit = firm.seat_limit
        period.candidate_limit = firm.candidate_limit
        period.price_cents_per_seat = firm.price_cents_per_seat
        period.amount_cents = amount_cents(firm.seat_limit, firm.price_cents_per_seat)
    return period


def dollars(cents: int) -> str:
    return f"${cents / 100:,.2f}"
