"""Signed-in test clients (07 Q38): every endpoint needs a session now, so the shared clients carry one.

`seed_accounts` makes an ACTIVE firm with an OWNER, and a Super Admin, each with a session. `send_sessions`
puts the right cookie on each request by the route's class in backend/auth/access.py: the Super Admin's for
PLATFORM routes, the firm user's for the rest. A request that already carries `bq_session` is left alone,
so a test can still send its own cookie, or none (see `anonymous_client`).
"""
from dataclasses import dataclass
from functools import lru_cache
import uuid

import httpx
from starlette.requests import Request

TEST_PASSWORD = "correct-horse-battery"


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
    plan = Plan(name=name, seat_limit=seat_limit, candidate_limit=candidate_limit)
    db.add(plan)
    db.flush()
    return plan


def make_firm(db, plan, slug="acme", status="ACTIVE", name=None, id=None):
    from backend.models.tenancy import Firm
    firm = Firm(id=id, name=name or slug.title(), slug=slug, status=status, plan_id=plan.id,
                seat_limit=plan.seat_limit, candidate_limit=plan.candidate_limit)
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
    db.commit()
    return Accounts(plan.id, firm.id, user.id, admin.id, firm_token, admin_token)


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
