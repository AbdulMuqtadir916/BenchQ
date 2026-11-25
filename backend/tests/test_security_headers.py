"""The security headers (backend/security_headers.py; docs/team/uzair.md, step 6) on every kind of answer: a route's,
each error the middleware makes, the crash 500 (sent outside every user middleware), and the route sweep covers every
route (test_log_every_route.py). A route's own headers stay."""
import pathlib

import pytest
from fastapi.testclient import TestClient

from backend import config, security_headers
from backend.body_limit import LIMIT
from backend.tests.header_support import assert_security_headers
from backend.tests.test_candidates_api import world  # noqa: F401  (the fixture)
from backend.tests.test_resume_versions import _candidate, _url, _v, parser  # noqa: F401

START_SH = pathlib.Path(__file__).resolve().parents[1] / "scripts" / "start.sh"


def _cookie(token):
    return {"cookie": f"bq_session={token}"}


def _sign_in(client, email="nobody@acme.test", password="wrong-password", **kw):
    return client.post("/api/auth/sign-in", json={"email": email, "password": password}, **kw)


def test_a_200_has_the_set(anonymous_client):
    r = anonymous_client.get("/health")
    assert r.status_code == 200
    assert_security_headers(r, "GET /health")
    assert r.headers["content-security-policy"] == "default-src 'none'; frame-ancestors 'none'"
    assert r.headers["cache-control"] == "no-store"


@pytest.mark.parametrize("case", ["401", "403 origin", "404", "405", "413", "422"])
def test_each_refusal_has_the_set(anonymous_client, case):
    send = {
        "401": lambda c: c.get("/api/auth/me"),
        "403 origin": lambda c: _sign_in(c, headers={"Origin": "https://evil.example"}),
        "404": lambda c: c.get("/api/no-such-route"),
        "405": lambda c: c.delete("/health"),
        "413": lambda c: c.post("/api/auth/sign-in", content=b"x" * (LIMIT + 1),
                                headers={"Content-Type": "application/json"}),
        "422": lambda c: c.post("/api/auth/sign-in", json={}),
    }[case]
    r = send(anonymous_client)
    assert r.status_code == int(case.split()[0]), r.text
    assert_security_headers(r, case)


def test_a_429_has_the_set(anonymous_client, accounts):
    for _ in range(5):
        _sign_in(anonymous_client, "owner@acme.test")
    r = _sign_in(anonymous_client, "owner@acme.test")
    assert r.status_code == 429
    assert_security_headers(r, "429")
    assert r.headers["retry-after"]


def test_the_busy_503_has_the_set(anonymous_client, accounts, monkeypatch):
    from sqlalchemy.exc import TimeoutError as PoolTimeout
    import backend.auth.access as access

    def drained(*_args, **_kwargs):
        raise PoolTimeout("pool drained")

    monkeypatch.setattr(access, "resolve", drained)
    r = anonymous_client.get("/api/auth/me", headers=_cookie(accounts.firm_token))
    assert r.status_code == 503
    assert_security_headers(r, "busy 503")


def test_the_crash_500_has_the_set(api_client, accounts, monkeypatch):
    """Starlette answers an unhandled error outside every user middleware: backend/problem.py adds the set there."""
    import backend.auth.access as access
    from backend.main import app

    def crash(*_args, **_kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(access, "resolve", crash)
    with TestClient(app, raise_server_exceptions=False) as client:
        r = client.get("/api/auth/me", headers=_cookie(accounts.firm_token))
    assert r.status_code == 500
    assert_security_headers(r, "crash 500")


def test_the_backend_never_sends_hsts(anonymous_client, monkeypatch):
    """HSTS is the HTTPS proxy's (Caddy, app.benchq.io): a second one from the backend could contradict it."""
    for production in (False, True):
        monkeypatch.setattr(config, "IS_PRODUCTION", production)
        for r in (anonymous_client.get("/health"), anonymous_client.get("/api/auth/me")):
            assert_security_headers(r, "HSTS check", production=production)
            assert "strict-transport-security" not in r.headers


def test_the_api_docs_load_their_scripts_in_development_and_are_gone_in_production(anonymous_client, monkeypatch):
    r = anonymous_client.get("/docs")
    assert r.status_code == 200
    assert_security_headers(r, "GET /docs")                      # no CSP: Swagger's own script and styles
    import backend.auth.access as access
    monkeypatch.setattr(access, "IS_PRODUCTION", True)
    monkeypatch.setattr(config, "IS_PRODUCTION", True)
    r = anonymous_client.get("/docs")
    assert r.status_code == 404
    assert_security_headers(r, "/docs in production", production=True)
    assert r.headers["content-security-policy"] == security_headers.API_CSP


# ── A route's own headers stay ───────────────────────────────────────────────

def test_the_resume_file_keeps_its_headers(anonymous_client, test_db, world, parser):
    c = _candidate(anonymous_client, test_db, world, bde="adnan")
    resume_id = _v(anonymous_client, world, c, who="adnan")["id"]
    r = anonymous_client.get(_url(world, c, f"/{resume_id}/file"), headers=world["as"]["adnan"])
    assert r.status_code == 200, r.text
    assert_security_headers(r, "résumé file")
    assert (r.headers["cache-control"], r.headers["x-resume-file"]) == ("no-store", "uploaded")
    assert r.headers["content-disposition"].startswith("attachment;")


def test_the_notifications_keep_their_cache_control(api_client):
    r = api_client.get("/api/notifications")
    assert r.status_code == 200, r.text
    assert_security_headers(r, "notifications")
    assert r.headers["cache-control"] == "private, no-store"


def test_the_autofill_stream_is_never_cached(api_client, test_db, monkeypatch):
    """The drafted answer streams with its own headers: `no-store` (it was `no-cache`, which a cache may keep and
    revalidate), and X-Accel-Buffering so a proxy doesn't hold the stream back."""
    from backend.models.db import Setting
    from backend.seed import seed_persona
    seed_persona(test_db)
    test_db.add(Setting(key="autofill_prompt", value="{persona} {qa_bank} {question} {company} {position} {max_chars}"))
    test_db.commit()

    async def chunks(*args, **kwargs):
        yield "I have five years."
    monkeypatch.setattr("backend.api.routes_autofill.call_autofill_llm_stream", chunks, raising=False)
    r = api_client.post("/api/autofill/answer/stream", json={"question": "Why?", "company": "Acme", "position": "PM"})
    assert r.status_code == 200 and "[DONE]" in r.text
    assert_security_headers(r, "POST /api/autofill/answer/stream")
    assert (r.headers["cache-control"], r.headers["x-accel-buffering"]) == ("no-store", "no")
    assert r.headers["content-type"].startswith("text/event-stream")


def test_a_route_that_sets_its_own_csp_keeps_it_and_decides_its_framing():
    """The posting reader (routes_jobs.py `_READER_CSP`) is framed by the app: its sandboxed CSP stays, and no
    X-Frame-Options is added on top."""
    from starlette.datastructures import MutableHeaders
    own = "sandbox; default-src 'unsafe-inline'; style-src 'unsafe-inline'"
    headers = MutableHeaders({"Content-Security-Policy": own, "Cache-Control": "private"})
    security_headers.add_missing(headers, "/api/jobs/1/cached-page")
    assert headers["content-security-policy"] == own
    assert headers["cache-control"] == "private"
    assert "x-frame-options" not in headers
    assert headers["x-content-type-options"] == "nosniff"


def test_uvicorn_sends_no_server_header():
    """The `server` header is uvicorn's, below the app: start.sh switches it off."""
    assert "--no-server-header" in START_SH.read_text(encoding="utf-8")



def test_the_routes_with_their_own_csp_exist():
    from fastapi.routing import APIRoute
    from backend.main import app
    from backend.tests.header_support import OWN_CSP
    routes = {f"{m} {r.path}" for r in app.router.routes if isinstance(r, APIRoute) for m in r.methods}
    assert set(OWN_CSP) <= routes, f"remove from header_support.OWN_CSP: {sorted(set(OWN_CSP) - routes)}"
