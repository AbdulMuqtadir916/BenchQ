"""Signed-in test clients (07 Q38): every endpoint needs a session now, so the shared clients carry one.

`seed_accounts` makes an ACTIVE firm with an OWNER, and a Super Admin, each with a session. `send_sessions`
puts the right cookie on each request by the route's class in backend/auth/access.py: the Super Admin's for
PLATFORM routes, the firm user's for the rest. A request that already carries `bq_session` is left alone,
so a test can still send its own cookie, or none (see `anonymous_client`).
"""
from dataclasses import dataclass
from datetime import time
from functools import lru_cache
import uuid

import httpx
from sqlalchemy import event, text
from sqlalchemy.orm import Session as OrmSession, defer
from starlette.requests import Request

TEST_PASSWORD = "correct-horse-battery"


def _has_column(db, table: str, column: str) -> bool:
    return db.execute(text("SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() "
                           "AND table_name = :t AND column_name = :c"), {"t": table, "c": column}).first() is not None


def has_work_hours(db) -> bool:
    """False on a scratch database a migration test holds below 0031, whose `firms` has no work hours yet."""
    return _has_column(db, "firms", "work_start")


def has_billing_prices(db) -> bool:
    """False below 0033, whose `plans` and `firms` have no price per BDE yet."""
    return _has_column(db, "plans", "price_cents_per_seat")


@event.listens_for(OrmSession, "do_orm_execute")
def _read_firms_without_missing_work_hours(state) -> None:
    """The `Firm` model has the newest columns; a migration test still reads firms at an older revision."""
    from backend.models.tenancy import Firm, Plan
    if not state.is_select:
        return
    if state.bind_mapper is Firm.__mapper__:
        if not has_work_hours(state.session):
            state.statement = state.statement.options(defer(Firm.work_start), defer(Firm.work_end))
        if not has_billing_prices(state.session):
            state.statement = state.statement.options(defer(Firm.price_cents_per_seat))
    elif state.bind_mapper is Plan.__mapper__ and not has_billing_prices(state.session):
        state.statement = state.statement.options(defer(Plan.price_cents_per_seat))


@lru_cache(maxsize=1)
def password_hash() -> str:
    """Argon2 is slow on purpose, so the tests hash their one password once per run."""
    from backend.auth.passwords import hash_password
    return hash_password(TEST_PASSWORD)


@dataclass
class Accounts:
    plan_id: uuid.UUID
    firm_id: uuid.UUID
    user_id: uuid.UUID
    admin_id: uuid.UUID
    firm_token: str
    admin_token: str


def make_plan(db, name="Test plan", seat_limit=10, candidate_limit=100):
    from backend.models.tenancy import Plan
    if not has_billing_prices(db):          # below 0033: the model's INSERT would name the missing price column
        plan_id = uuid.uuid4()
        db.execute(Plan.__table__.insert().values(id=plan_id, name=name, seat_limit=seat_limit,
                                                  candidate_limit=candidate_limit))
        return db.get(Plan, plan_id)
    plan = Plan(name=name, seat_limit=seat_limit, candidate_limit=candidate_limit)
    db.add(plan)
    db.flush()
    return plan


def make_firm(db, plan, slug="acme", status="ACTIVE", name=None, id=None, work_start=time(18, 30),
              work_end=time(4, 0)):
    from backend.models.tenancy import Firm
    fields = {"name": name or slug.title(), "slug": slug, "status": status, "plan_id": plan.id,
              "seat_limit": plan.seat_limit, "candidate_limit": plan.candidate_limit}
    if not has_work_hours(db) or not has_billing_prices(db):   # below 0031 / 0033: the INSERT names missing columns
        firm_id = id or uuid.uuid4()
        columns = {"work_start": work_start, "work_end": work_end} if has_work_hours(db) else {}
        db.execute(Firm.__table__.insert().values(id=firm_id, **fields, **columns))
        return db.get(Firm, firm_id)
    firm = Firm(id=id, work_start=work_start, work_end=work_end, **fields)
    db.add(firm)
    db.flush()
    return firm


def make_user(db, firm, email="owner@acme.test", role="OWNER", name="Olivia Owner", is_active=True):
    from backend.models.tenancy import User
    user = User(firm_id=firm.id, role=role, name=name, email=email, password_hash=password_hash(),
                is_active=is_active)
    db.add(user)
    db.flush()
    return user


def make_admin(db, email="admin@benchq.test", name="Sam Admin", is_active=True):
    from backend.models.tenancy import PlatformUser
    admin = PlatformUser(name=name, email=email, password_hash=password_hash(), is_active=is_active)
    db.add(admin)
    db.flush()
    return admin


def _signed_in_firm(db, plan):
    """The signed-in firm, "acme", takes the Default firm's id, so the rows a test writes with DEFAULT_FIRM_ID
    (tests/firm_support.py) are the signed-in user's. When the `default_firm` fixture put the Default firm in
    first, that row becomes acme."""
    from backend.models.tenancy import DEFAULT_FIRM_ID, Firm
    firm = db.get(Firm, DEFAULT_FIRM_ID)
    if firm is None:
        return make_firm(db, plan, id=DEFAULT_FIRM_ID)
    firm.name, firm.slug, firm.status, firm.plan_id = "Acme", "acme", "ACTIVE", plan.id
    firm.seat_limit, firm.candidate_limit = plan.seat_limit, plan.candidate_limit
    db.flush()
    return firm


def seed_accounts(db) -> Accounts:
    from backend.auth.sessions import start_session
    plan = make_plan(db)
    firm = _signed_in_firm(db, plan)
    user = make_user(db, firm)
    admin = make_admin(db)
    firm_token, _ = start_session(db, user)
    admin_token, _ = start_session(db, admin)
    # Read before the commit expires them: a migration test's older `firms` can't be reloaded through the model.
    accounts = Accounts(plan.id, firm.id, user.id, admin.id, firm_token, admin_token)
    db.commit()
    return accounts


def send_sessions(client, app, accounts: Accounts) -> None:
    from backend.auth.access import ROUTE_ACCESS, Access, route_key
    from backend.auth.sessions import COOKIE_NAME

    def _add_cookie(request: httpx.Request) -> None:
        if f"{COOKIE_NAME}=" in request.headers.get("cookie", ""):
            return
        scope = {"type": "http", "method": request.method, "path": request.url.path, "root_path": "",
                 "query_string": b"", "headers": []}
        key = route_key(app, Request(scope))
        token = accounts.admin_token if ROUTE_ACCESS.get(key) is Access.PLATFORM else accounts.firm_token
        cookie = request.headers.get("cookie")
        request.headers["cookie"] = f"{cookie}; {COOKIE_NAME}={token}" if cookie else f"{COOKIE_NAME}={token}"

    client.event_hooks = {**client.event_hooks, "request": [*client.event_hooks.get("request", []), _add_cookie]}
