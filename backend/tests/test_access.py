"""Who may call each endpoint (07 Q38, backend/auth/access.py): every route classified, each class enforced."""
from datetime import timedelta

import pytest

from backend.auth.access import ROUTE_ACCESS, Access
from backend.tests.auth_support import make_admin, make_firm, make_plan, make_user

COOKIE = "bq_session"


def _cookie(token):
    return {"cookie": f"{COOKIE}={token}"}


def _app_route_keys():
    from backend.main import app
    return {f"{m} {r.path}" for r in app.router.routes for m in (getattr(r, "methods", None) or ()) if m != "HEAD"}


# ── The table ────────────────────────────────────────────────────────────────

def test_every_route_is_classified():
    """A new endpoint must be added to ROUTE_ACCESS; until it is, the middleware refuses it."""
    missing = sorted(_app_route_keys() - set(ROUTE_ACCESS))
    assert not missing, f"add these to backend/auth/access.py: {missing}"


def test_the_table_names_no_route_that_does_not_exist():
    stale = sorted(set(ROUTE_ACCESS) - _app_route_keys())
    assert not stale, f"remove these from backend/auth/access.py: {stale}"


def test_the_public_allowlist_is_exactly_the_agreed_one():
    """Q38: sign-in, invite lookup/accept, health, tracer links, the Telegram webhook."""
    public = sorted(k for k, v in ROUTE_ACCESS.items() if v is Access.PUBLIC)
    assert public == sorted([
        "GET /health", "GET /", "GET /cv/{token}", "POST /api/telegram/webhook",
        "POST /api/auth/sign-in", "POST /api/auth/sign-out",
        "GET /api/invites/{token}", "POST /api/invites/{token}/accept",
    ])


def test_telegram_and_platform_operations_are_super_admin_only():
    for key, access in ROUTE_ACCESS.items():
        path = key.split(" ", 1)[1]
        if path.startswith(("/api/telegram/", "/api/scrape", "/api/db/", "/api/monitor/", "/api/settings",
                            "/api/linkedin/", "/api/searches")) and key not in (
                "POST /api/telegram/webhook", "GET /api/searches/countries"):
            assert access is Access.PLATFORM, key


def test_an_unclassified_route_is_refused(api_client, monkeypatch, caplog):
    import backend.auth.access as access_mod
    table = dict(ROUTE_ACCESS)
    del table["GET /api/jobs"]
    monkeypatch.setattr(access_mod, "ROUTE_ACCESS", table)
    r = api_client.get("/api/jobs")
    assert r.status_code == 403
    assert "GET /api/jobs" in caplog.text


def test_an_unknown_path_is_still_a_plain_404(anonymous_client):
    assert anonymous_client.get("/api/no-such-thing").status_code == 404


# ── Signed out ───────────────────────────────────────────────────────────────

SAMPLE = {
    Access.SIGNED_IN: ("GET", "/api/auth/me"),
    Access.FIRM: ("GET", "/api/jobs"),
    Access.PLATFORM: ("GET", "/api/settings"),
}


@pytest.mark.parametrize("access", list(SAMPLE))
def test_signed_out_is_401(anonymous_client, access):
    method, path = SAMPLE[access]
    r = anonymous_client.request(method, path)
    assert r.status_code == 401
    assert r.json() == {"detail": "Sign in to continue."}


def test_an_unknown_cookie_is_401_and_cleared(anonymous_client):
    r = anonymous_client.get("/api/jobs", headers=_cookie("forged"))
    assert r.status_code == 401
    assert f'{COOKIE}=""' in r.headers["set-cookie"] or "Max-Age=0" in r.headers["set-cookie"]


def test_the_old_api_key_opens_nothing(anonymous_client):
    assert anonymous_client.get("/api/jobs", headers={"X-API-Key": "anything"}).status_code == 401
    assert anonymous_client.get("/api/jobs", headers={"cookie": "jn_session=x"}).status_code == 401
    assert anonymous_client.post("/api/auth/set-session", json={"api_key": ""}).status_code == 404
    assert anonymous_client.post("/api/auth/verify", json={"api_key": ""}).status_code == 404


@pytest.mark.parametrize("path", ["/health", "/cv/zzzzzzzz"])
def test_public_routes_need_no_session(anonymous_client, path):
    assert anonymous_client.get(path).status_code in (200, 404)
    assert anonymous_client.get(path).status_code != 401


# ── Each class ───────────────────────────────────────────────────────────────

def test_a_firm_user_reaches_firm_routes_but_not_platform_ones(anonymous_client, accounts):
    assert anonymous_client.get("/api/jobs", headers=_cookie(accounts.firm_token)).status_code == 200
    r = anonymous_client.get("/api/settings", headers=_cookie(accounts.firm_token))
    assert r.status_code == 403
    assert r.json() == {"detail": "Platform admins only."}


def test_a_super_admin_reaches_platform_routes_but_not_firm_data(anonymous_client, accounts):
    """Q38: JobNavigator's firm data has no firm filter yet, so a Super Admin is refused rather than shown
    every firm's rows."""
    assert anonymous_client.get("/api/settings", headers=_cookie(accounts.admin_token)).status_code == 200
    r = anonymous_client.get("/api/jobs", headers=_cookie(accounts.admin_token))
    assert r.status_code == 403
    assert r.json() == {"detail": "A platform admin can't act inside a firm."}


@pytest.mark.parametrize("who", ["firm_token", "admin_token"])
def test_signed_in_routes_take_either_account(anonymous_client, accounts, who):
    assert anonymous_client.get("/api/companies", headers=_cookie(getattr(accounts, who))).status_code == 200


def test_a_suspended_firm_is_refused_firm_routes_but_still_sees_its_session(anonymous_client, accounts, test_db):
    from backend.models.tenancy import Firm
    test_db.get(Firm, accounts.firm_id).status = "SUSPENDED"
    test_db.commit()
    r = anonymous_client.get("/api/jobs", headers=_cookie(accounts.firm_token))
    assert r.status_code == 403
    assert r.json() == {"detail": "This workspace is suspended."}
    # /me still answers, so the app can show the suspended screen.
    me = anonymous_client.get("/api/auth/me", headers=_cookie(accounts.firm_token))
    assert me.status_code == 200
    assert me.json()["firm"]["status"] == "SUSPENDED"


def test_an_onboarding_firm_works(anonymous_client, test_db):
    from backend.auth.sessions import start_session
    firm = make_firm(test_db, make_plan(test_db, name="P"), slug="newco", status="ONBOARDING")
    token, _ = start_session(test_db, make_user(test_db, firm, email="o@newco.test"))
    test_db.commit()
    assert anonymous_client.get("/api/jobs", headers=_cookie(token)).status_code == 200


def test_deactivating_a_user_ends_access_on_the_next_request(anonymous_client, accounts, test_db):
    from backend.models.tenancy import User
    assert anonymous_client.get("/api/jobs", headers=_cookie(accounts.firm_token)).status_code == 200
    test_db.get(User, accounts.user_id).is_active = False
    test_db.commit()
    assert anonymous_client.get("/api/jobs", headers=_cookie(accounts.firm_token)).status_code == 401


def test_deactivating_an_admin_ends_access_on_the_next_request(anonymous_client, accounts, test_db):
    from backend.models.tenancy import PlatformUser
    test_db.get(PlatformUser, accounts.admin_id).is_active = False
    test_db.commit()
    assert anonymous_client.get("/api/settings", headers=_cookie(accounts.admin_token)).status_code == 401


def test_a_role_change_applies_on_the_next_request(anonymous_client, accounts, test_db):
    from backend.models.tenancy import User
    test_db.get(User, accounts.user_id).role = "VIEWER"
    test_db.commit()
    me = anonymous_client.get("/api/auth/me", headers=_cookie(accounts.firm_token)).json()
    assert me["principal"]["role"] == "VIEWER"


def test_cors_preflight_needs_no_session(anonymous_client):
    r = anonymous_client.options("/api/jobs", headers={
        "Origin": "http://localhost:3000", "Access-Control-Request-Method": "GET"})
    assert r.status_code == 200


# ── API docs ─────────────────────────────────────────────────────────────────

def test_api_docs_are_open_in_development(anonymous_client):
    assert anonymous_client.get("/openapi.json").status_code == 200


def test_api_docs_are_gone_in_production(anonymous_client, monkeypatch):
    import backend.auth.access as access_mod
    monkeypatch.setattr(access_mod, "IS_PRODUCTION", True)
    for path in ("/openapi.json", "/docs", "/redoc"):
        assert anonymous_client.get(path).status_code == 404, path


# ── CSRF: the Origin check ───────────────────────────────────────────────────

def test_a_cross_origin_post_is_refused_even_signed_in(anonymous_client, accounts):
    r = anonymous_client.post("/api/jobs/manual", json={},
                              headers={**_cookie(accounts.firm_token), "Origin": "https://evil.example"})
    assert r.status_code == 403
    assert r.json() == {"detail": "Cross-origin request refused"}


def test_a_cross_origin_sign_in_is_refused(anonymous_client):
    r = anonymous_client.post("/api/auth/sign-in", json={"email": "a@b.test", "password": "x" * 8},
                              headers={"Origin": "null"})
    assert r.status_code == 403


def test_a_same_origin_post_passes(anonymous_client, accounts):
    r = anonymous_client.post("/api/auth/first-run-done",
                              headers={**_cookie(accounts.firm_token), "Origin": "http://localhost:3000"})
    assert r.status_code == 200


def test_a_get_from_another_origin_is_not_refused_by_the_origin_check(anonymous_client, accounts):
    r = anonymous_client.get("/api/jobs", headers={**_cookie(accounts.firm_token), "Origin": "https://evil.example"})
    assert r.status_code == 200


def test_a_post_without_an_origin_header_passes(anonymous_client):
    """Non-browser callers (Telegram's webhook) send none, and carry no cookie to abuse."""
    assert anonymous_client.post("/api/telegram/webhook", json={}).status_code != 403


# ── Sliding expiry ───────────────────────────────────────────────────────────

def test_the_cookie_is_sent_again_when_the_expiry_slides(anonymous_client, accounts, test_db):
    from backend.models.tenancy import Session
    from backend.auth.tokens import hash_token
    row = test_db.query(Session).filter(Session.token_hash == hash_token(accounts.firm_token)).one()
    row.last_seen_at = row.last_seen_at - timedelta(minutes=10)
    row.expires_at = row.expires_at - timedelta(minutes=10)
    test_db.commit()
    before = row.expires_at
    r = anonymous_client.get("/api/jobs", headers=_cookie(accounts.firm_token))
    assert r.status_code == 200
    assert f"{COOKIE}={accounts.firm_token}" in r.headers["set-cookie"]
    test_db.refresh(row)
    assert row.expires_at > before


def test_the_cookie_is_not_resent_on_every_request(anonymous_client, accounts):
    r = anonymous_client.get("/api/jobs", headers=_cookie(accounts.firm_token))
    assert "set-cookie" not in r.headers


def test_a_platform_account_with_no_firm_user_is_not_a_firm_principal(anonymous_client, test_db):
    from backend.auth.sessions import start_session
    token, _ = start_session(test_db, make_admin(test_db, email="other@benchq.test"))
    test_db.commit()
    assert anonymous_client.post("/api/auth/first-run-done", headers=_cookie(token)).status_code == 403
