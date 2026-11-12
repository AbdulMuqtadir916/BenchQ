"""Billing records (07 Q64-Q66, docs/02 §3.5): a firm's BDE count and the candidate limit that follows, 30-day
periods, the base plan's price, suspend and reactivate, and the rule that no money reaches a firm."""
from datetime import date, timedelta
import json

import pytest

from backend.auth.billing import today_ist
from backend.models.db import utcnow
from backend.models.tenancy import BillingPeriod, Firm, LedgerEntry, Plan
from backend.tests.auth_support import make_firm, make_user

SEATS = "/api/admin/firms/{}/seats"
PERIODS = "/api/admin/firms/{}/billing-periods"


def _firm(accounts):
    return str(accounts.firm_id)


def _start(api_client, accounts, **body):
    return api_client.post(PERIODS.format(_firm(accounts)), json=body)


# ── BDE count ────────────────────────────────────────────────────────────────

def test_the_candidate_limit_is_set_on_its_own_and_a_bde_change_never_moves_it(api_client, accounts, test_db):
    url = SEATS.format(_firm(accounts))
    r = api_client.patch(url, json={"seat_limit": 12, "candidate_limit": 37})
    assert r.status_code == 200, r.text
    assert (r.json()["seat_limit"], r.json()["candidate_limit"]) == (12, 37)
    r = api_client.patch(url, json={"seat_limit": 5})          # no candidate_limit: the firm keeps its own
    assert (r.json()["seat_limit"], r.json()["candidate_limit"]) == (5, 37)
    assert api_client.patch(url, json={"seat_limit": 5, "candidate_limit": -1}).status_code == 422
    firm = test_db.get(Firm, accounts.firm_id)
    assert (firm.seat_limit, firm.candidate_limit) == (5, 37)


def test_a_new_firm_starts_at_ten_candidates_per_bde_unless_a_limit_is_given(api_client, accounts, test_db):
    from backend.models.tenancy import Plan
    plan = test_db.query(Plan).filter(Plan.is_active.is_(True)).first()
    body = {"name": "Zed Co", "slug": "zed-co", "plan_id": str(plan.id), "seat_limit": 3,
            "owner_name": "Zed Owner", "owner_email": "zed@zed.test"}
    r = api_client.post("/api/admin/firms", json=body)
    assert r.status_code in (200, 201), r.text
    assert r.json()["firm"]["candidate_limit"] == 30
    r = api_client.post("/api/admin/firms", json={**body, "slug": "zed-two", "owner_email": "zed2@zed.test", "candidate_limit": 7})
    assert r.json()["firm"]["candidate_limit"] == 7


def test_the_count_may_go_below_what_the_firm_uses_and_nothing_is_removed(api_client, accounts, test_db):
    for n in range(3):
        make_user(test_db, test_db.get(Firm, accounts.firm_id), email=f"bde{n}@acme.test", role="BDE")
    test_db.commit()
    assert api_client.patch(SEATS.format(_firm(accounts)), json={"seat_limit": 1}).status_code == 200
    from backend.models.tenancy import User
    assert test_db.query(User).filter(User.firm_id == accounts.firm_id, User.role == "BDE", User.is_active.is_(True)).count() == 3


def test_a_count_change_is_in_the_firms_ledger_as_counts_only(api_client, accounts, test_db):
    api_client.patch(SEATS.format(_firm(accounts)), json={"seat_limit": 12, "candidate_limit": 120})
    entry = test_db.query(LedgerEntry).filter(LedgerEntry.firm_id == accounts.firm_id, LedgerEntry.entity_type == "firm_limits").one()
    assert entry.action == "PLAN_CHANGED"
    assert entry.summary == "BDE seats 10 → 12, candidates 100 → 120"


def test_a_price_change_is_logged_platform_only(api_client, accounts, test_db):
    api_client.patch(SEATS.format(_firm(accounts)), json={"seat_limit": 10, "price_cents_per_seat": 4000})
    assert test_db.get(Firm, accounts.firm_id).price_cents_per_seat == 4000
    entry = test_db.query(LedgerEntry).filter(LedgerEntry.entity_type == "billing_terms").one()
    assert entry.firm_id is None
    assert "$35.00 → $40.00" in entry.summary


def test_an_unchanged_count_writes_nothing(api_client, accounts, test_db):
    before = test_db.query(LedgerEntry).count()
    assert api_client.patch(SEATS.format(_firm(accounts)), json={"seat_limit": 10}).status_code == 200
    assert test_db.query(LedgerEntry).count() == before


@pytest.mark.parametrize("body", [{"seat_limit": 0}, {"seat_limit": 1001}, {"seat_limit": 5, "price_cents_per_seat": -1}])
def test_bad_counts_and_prices_are_refused(api_client, accounts, body):
    assert api_client.patch(SEATS.format(_firm(accounts)), json=body).status_code == 422


def test_an_unknown_firm_is_not_found(api_client):
    assert api_client.patch(SEATS.format("00000000-0000-4000-8000-0000000000ff"), json={"seat_limit": 3}).status_code == 404


# ── Periods ──────────────────────────────────────────────────────────────────

def test_start_a_period_snapshots_the_firm_and_calculates_the_amount(api_client, accounts):
    r = _start(api_client, accounts, starts_on="2026-11-12", note="First month")
    assert r.status_code == 201, r.text
    p = r.json()
    assert (p["starts_on"], p["ends_on"]) == ("2026-11-12", "2026-12-12")
    assert (p["seat_limit"], p["candidate_limit"], p["jobs_per_candidate_per_day"]) == (10, 100, 100)
    assert (p["price_cents_per_seat"], p["amount_cents"]) == (3500, 35000)
    assert (p["status"], p["paid_on"], p["note"]) == ("UNPAID", None, "First month")


def test_the_next_period_starts_the_day_after_the_last_ends(api_client, accounts):
    _start(api_client, accounts, starts_on="2026-11-12")
    p = _start(api_client, accounts).json()
    assert p["starts_on"] == "2026-12-13"


def test_a_period_cannot_overlap_the_last(api_client, accounts):
    _start(api_client, accounts, starts_on="2026-11-12")
    r = _start(api_client, accounts, starts_on="2026-12-12")
    assert r.status_code == 400
    assert "2026-12-12" in r.json()["detail"]


def test_without_a_period_the_first_starts_today(api_client, accounts):
    assert _start(api_client, accounts).json()["starts_on"] == today_ist(utcnow()).isoformat()


def test_mark_paid_and_unpaid(api_client, accounts):
    pid = _start(api_client, accounts, starts_on="2026-11-12").json()["id"]
    paid = api_client.patch(f"/api/admin/billing-periods/{pid}", json={"status": "PAID", "paid_on": "2026-11-13"}).json()
    assert (paid["status"], paid["paid_on"]) == ("PAID", "2026-11-13")
    back = api_client.patch(f"/api/admin/billing-periods/{pid}", json={"status": "UNPAID", "note": "bounced"}).json()
    assert (back["status"], back["paid_on"], back["note"]) == ("UNPAID", None, "bounced")


def test_a_paid_date_without_paying_is_refused(api_client, accounts):
    pid = _start(api_client, accounts, starts_on="2026-11-12").json()["id"]
    assert api_client.patch(f"/api/admin/billing-periods/{pid}", json={"paid_on": "2026-11-13"}).status_code == 400


def test_a_count_change_updates_the_period_running_today_and_leaves_past_ones(api_client, accounts, test_db):
    today = today_ist(utcnow())
    old = _start(api_client, accounts, starts_on=(today - timedelta(days=60)).isoformat()).json()
    now = _start(api_client, accounts, starts_on=(today - timedelta(days=5)).isoformat()).json()
    api_client.patch(SEATS.format(_firm(accounts)), json={"seat_limit": 12, "candidate_limit": 120})
    test_db.expire_all()
    assert test_db.get(BillingPeriod, old["id"]).seat_limit == 10
    running = test_db.get(BillingPeriod, now["id"])
    assert (running.seat_limit, running.candidate_limit, running.amount_cents) == (12, 120, 42000)


def test_listing_periods_for_one_firm_or_all(api_client, accounts, test_db):
    other = make_firm(test_db, test_db.get(Plan, accounts.plan_id), slug="other")
    test_db.commit()
    _start(api_client, accounts, starts_on="2026-11-12")
    api_client.post(PERIODS.format(other.id), json={"starts_on": "2026-11-12"})
    assert len(api_client.get("/api/admin/billing-periods").json()) == 2
    assert len(api_client.get("/api/admin/billing-periods", params={"firm_id": _firm(accounts)}).json()) == 1


def test_the_database_refuses_an_amount_that_is_not_count_times_price(test_db, accounts):
    from sqlalchemy.exc import IntegrityError
    test_db.add(BillingPeriod(firm_id=accounts.firm_id, starts_on=date(2026, 11, 12), ends_on=date(2026, 12, 12),
                              seat_limit=10, candidate_limit=100, jobs_per_candidate_per_day=100,
                              price_cents_per_seat=3500, amount_cents=1))
    with pytest.raises(IntegrityError):
        test_db.flush()
    test_db.rollback()


# ── Plan ─────────────────────────────────────────────────────────────────────

def test_editing_the_plan_changes_new_firms_not_existing_ones(api_client, accounts, test_db):
    r = api_client.patch(f"/api/admin/plans/{accounts.plan_id}", json={"seat_limit": 8, "price_cents_per_seat": 4000})
    assert r.status_code == 200, r.text
    assert (r.json()["seat_limit"], r.json()["candidate_limit"], r.json()["price_cents_per_seat"]) == (8, 80, 4000)
    firm = test_db.get(Firm, accounts.firm_id)
    assert (firm.seat_limit, firm.candidate_limit, firm.price_cents_per_seat) == (10, 100, 3500)
    entry = test_db.query(LedgerEntry).filter(LedgerEntry.entity_type == "plan").one()
    assert entry.firm_id is None


def test_create_firm_takes_a_bde_count_and_copies_the_price(api_client, accounts, test_db):
    api_client.patch(f"/api/admin/plans/{accounts.plan_id}", json={"price_cents_per_seat": 4000})
    r = api_client.post("/api/admin/firms", json={
        "name": "Northwind", "slug": "northwind", "plan_id": str(accounts.plan_id), "seat_limit": 12,
        "owner_name": "Nora", "owner_email": "nora@northwind.test"})
    assert r.status_code == 201, r.text
    assert (r.json()["firm"]["seat_limit"], r.json()["firm"]["candidate_limit"]) == (12, 120)
    assert test_db.get(Firm, r.json()["firm"]["id"]).price_cents_per_seat == 4000


# ── Suspend and reactivate ───────────────────────────────────────────────────

def test_suspend_and_reactivate(api_client, accounts, test_db):
    r = api_client.post(f"/api/admin/firms/{_firm(accounts)}/suspend", json={"reason": "  Unpaid since October  "})
    assert r.status_code == 200 and r.json()["status"] == "SUSPENDED"
    entry = test_db.query(LedgerEntry).filter(LedgerEntry.action == "FIRM_SUSPENDED").one()
    assert (entry.firm_id, entry.note) == (accounts.firm_id, "Unpaid since October")
    assert api_client.post(f"/api/admin/firms/{_firm(accounts)}/suspend", json={"reason": "again"}).status_code == 409
    r = api_client.post(f"/api/admin/firms/{_firm(accounts)}/reactivate")
    assert r.status_code == 200 and r.json()["status"] == "ACTIVE"
    assert api_client.post(f"/api/admin/firms/{_firm(accounts)}/reactivate").status_code == 409


def test_a_suspended_firms_people_are_blocked(api_client, anonymous_client, accounts):
    api_client.post(f"/api/admin/firms/{_firm(accounts)}/suspend", json={"reason": "x"})
    r = anonymous_client.get(f"/api/firms/{accounts.firm_id}/members", headers={"cookie": f"bq_session={accounts.firm_token}"})
    assert r.status_code in (401, 403)


def test_only_an_active_firm_can_be_suspended(api_client, accounts, test_db):
    plan = test_db.get(Plan, accounts.plan_id)
    firm = make_firm(test_db, plan, slug="fresh", status="ONBOARDING")
    test_db.commit()
    r = api_client.post(f"/api/admin/firms/{firm.id}/suspend", json={"reason": "pause"})
    assert r.status_code == 409 and r.json()["detail"] == "Only an active firm can be suspended."


def test_a_reason_is_required(api_client, accounts):
    assert api_client.post(f"/api/admin/firms/{_firm(accounts)}/suspend", json={"reason": "  "}).status_code == 400


def test_the_admin_firm_carries_the_price_and_the_firm_side_firm_does_not(api_client, anonymous_client, accounts):
    assert api_client.get(f"/api/admin/firms/{_firm(accounts)}").json()["price_cents_per_seat"] == 3500
    mine = anonymous_client.get("/api/firms/by-slug/acme", headers={"cookie": f"bq_session={accounts.firm_token}"}).json()
    assert "price_cents_per_seat" not in mine


# ── Only the Super Admin ─────────────────────────────────────────────────────

@pytest.mark.parametrize("method,path,body", [
    ("PATCH", SEATS.format("{f}"), {"seat_limit": 3}),
    ("POST", "/api/admin/firms/{f}/suspend", {"reason": "x"}),
    ("POST", "/api/admin/firms/{f}/reactivate", None),
    ("POST", PERIODS.format("{f}"), {}),
    ("GET", "/api/admin/billing-periods", None),
    ("PATCH", "/api/admin/plans/{p}", {"price_cents_per_seat": 1}),
])
def test_a_firm_user_cannot_reach_billing_or_firm_actions(anonymous_client, accounts, method, path, body):
    r = anonymous_client.request(method, path.format(f=accounts.firm_id, p=accounts.plan_id), json=body,
                                 headers={"cookie": f"bq_session={accounts.firm_token}"})
    assert r.status_code == 403


# ── No money reaches a firm (Q66) ────────────────────────────────────────────

def test_no_firm_side_response_carries_price_amount_or_periods(api_client, anonymous_client, accounts):
    _start(api_client, accounts, starts_on="2026-11-12")
    api_client.patch(SEATS.format(_firm(accounts)), json={"seat_limit": 12, "price_cents_per_seat": 4100})
    firm_cookie = {"cookie": f"bq_session={accounts.firm_token}"}
    seen = ""
    fid = accounts.firm_id
    for path in ("/api/auth/me", f"/api/firms/{fid}/members", f"/api/firms/{fid}/ledger", f"/api/firms/{fid}/invites",
                 "/api/firms/by-slug/acme"):
        r = anonymous_client.get(path, headers=firm_cookie)
        assert r.status_code == 200, (path, r.status_code)
        seen += json.dumps(r.json())
    for word in ("price", "amount", "billing", "period", "$", "41.00", "4100", "49200"):
        assert word not in seen.lower(), word
