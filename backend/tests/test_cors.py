"""CORS and the Origin check share one origin list (backend/config.py ALLOWED_ORIGINS; docs/team/uzair.md, step 6):
an allowed origin gets its own exact Access-Control-Allow-Origin with credentials, a refused one none, never `*`; the
preflight names only the methods and headers BenchQ uses. The extension's chrome-extension:// origin passes the Origin
check when it is listed."""
import pytest

from backend import config

SITE = "http://localhost:3000"                       # in the development default list
EXTENSION = "chrome-extension://" + "abcdefghijklmnopabcdefghijklmnop"
OTHER_EXTENSION = "chrome-extension://" + "ponmlkjihgfedcbaponmlkjihgfedcba"
SAFELISTED = {"accept", "accept-language", "content-language", "content-type"}   # CORS always allows these


@pytest.fixture
def extension_listed():
    """The extension's origin added to the one list, in place: CORS and the Origin check both hold this list."""
    config.ALLOWED_ORIGINS.append(EXTENSION)
    try:
        yield
    finally:
        config.ALLOWED_ORIGINS.remove(EXTENSION)


def _cookie(token):
    return {"cookie": f"bq_session={token}"}


def test_cors_and_the_origin_check_hold_the_same_list():
    import backend.auth.access as access
    from backend.main import app
    cors = next(m for m in app.user_middleware if m.cls.__name__ == "CORSMiddleware")
    assert cors.kwargs["allow_origins"] is config.ALLOWED_ORIGINS is access.ALLOWED_ORIGINS


def test_an_allowed_origin_gets_its_exact_origin_and_credentials(anonymous_client):
    r = anonymous_client.get("/health", headers={"Origin": SITE})
    assert r.headers["access-control-allow-origin"] == SITE
    assert r.headers["access-control-allow-credentials"] == "true"
    assert set(h.strip() for h in r.headers["access-control-expose-headers"].lower().split(",")) == {
        "retry-after", "x-request-id"}


def test_a_refused_origin_gets_no_allow_origin(anonymous_client):
    r = anonymous_client.get("/health", headers={"Origin": "https://evil.example"})
    assert r.status_code == 200
    assert "access-control-allow-origin" not in r.headers


@pytest.mark.parametrize("origin", [SITE, "https://evil.example", "null"])
def test_never_a_wildcard(anonymous_client, origin):
    for r in (anonymous_client.get("/health", headers={"Origin": origin}),
              anonymous_client.options("/api/jobs", headers={"Origin": origin, "Access-Control-Request-Method": "GET"})):
        assert r.headers.get("access-control-allow-origin") != "*"


def test_the_preflight_lists_only_the_methods_and_headers_benchq_uses(anonymous_client):
    r = anonymous_client.options("/api/jobs", headers={
        "Origin": SITE, "Access-Control-Request-Method": "PATCH", "Access-Control-Request-Headers": "content-type"})
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == SITE
    assert {m.strip() for m in r.headers["access-control-allow-methods"].split(",")} == {
        "GET", "POST", "PUT", "PATCH", "DELETE"}
    assert {h.strip().lower() for h in r.headers["access-control-allow-headers"].split(",")} == SAFELISTED | {
        "x-request-id"}
    assert r.headers["access-control-max-age"] == "600"


def test_a_preflight_asking_for_another_header_or_from_another_origin_is_refused(anonymous_client):
    asks_header = anonymous_client.options("/api/jobs", headers={
        "Origin": SITE, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization"})
    assert asks_header.status_code == 400
    other_origin = anonymous_client.options("/api/jobs", headers={
        "Origin": "https://evil.example", "Access-Control-Request-Method": "POST"})
    assert other_origin.status_code == 400
    assert "access-control-allow-origin" not in other_origin.headers


def test_a_listed_extension_passes_the_origin_check(anonymous_client, accounts, extension_listed):
    r = anonymous_client.post("/api/auth/first-run-done",
                              headers={**_cookie(accounts.firm_token), "Origin": EXTENSION})
    assert r.status_code == 200, r.text


def test_an_unlisted_extension_is_refused(anonymous_client, accounts, extension_listed):
    r = anonymous_client.post("/api/auth/first-run-done",
                              headers={**_cookie(accounts.firm_token), "Origin": OTHER_EXTENSION})
    assert r.status_code == 403
    assert r.json()["detail"] == "Cross-origin request refused"


def test_the_origin_check_compares_lower_case(anonymous_client, accounts):
    r = anonymous_client.post("/api/auth/first-run-done",
                              headers={**_cookie(accounts.firm_token), "Origin": "HTTP://LOCALHOST:3000"})
    assert r.status_code == 200, r.text


def test_the_list_is_read_lower_case_and_trimmed():
    assert config.parse_origins(" HTTPS://App.Example.com ,, chrome-extension://ABC ") == [
        "https://app.example.com", "chrome-extension://abc"]
