"""The security headers every API answer carries (backend/security_headers.py; docs/team/uzair.md, step 6), checked by
test_security_headers.py and, for every route, by the route sweep (test_log_every_route.py). The `server` header is
uvicorn's, below the app: test_security_headers.py checks start.sh switches it off."""
from backend.security_headers import API_CSP

# Always these values: no route has a reason to send others.
FIXED = {"x-content-type-options": "nosniff", "referrer-policy": "no-referrer",
         "cross-origin-resource-policy": "same-origin"}
# "METHOD path" -> why the route sends its own CSP instead of the API's. A route that sets one and isn't listed fails.
OWN_CSP = {
    "GET /api/jobs/{job_id}/cached-page": "the posting reader, framed by the app: a sandboxed CSP (routes_jobs.py)",
    "GET /api/jobs/{job_id}/live-page": "the same reader, live",
}
# The API docs load Swagger's script and styles, so they have no CSP; development only (DEV_ONLY in access.py).
NO_CSP_IN_DEVELOPMENT = {"GET /docs", "GET /docs/oauth2-redirect", "GET /redoc", "GET /openapi.json"}


def assert_security_headers(response, where: str = "", production: bool = False) -> None:
    """The set, as backend/security_headers.py adds it. `where` is the route ("METHOD path") when there is one: the
    API's CSP is required unless the route is named above (its own CSP, which then decides its framing)."""
    label = f"{where} {response.status_code}".strip()
    headers = response.headers
    for name, value in FIXED.items():
        assert headers.get(name) == value, f"{label}: {name} is {headers.get(name)!r}"
    # A route may set its own Cache-Control (`private, no-store`), but never one a cache may keep (`no-cache` only
    # revalidates): every API answer is private data or an error.
    assert "no-store" in headers.get("cache-control", ""), f"{label}: Cache-Control {headers.get('cache-control')!r}"
    csp = headers.get("content-security-policy")
    if where in OWN_CSP and csp != API_CSP:
        assert csp, f"{label}: no CSP"
        assert "x-frame-options" not in headers, f"{label}: a route's own CSP decides its framing"
    elif where in NO_CSP_IN_DEVELOPMENT and not production:
        assert csp is None, f"{label}: the docs' CSP would block Swagger"
        assert headers.get("x-frame-options") == "DENY", f"{label}: X-Frame-Options {headers.get('x-frame-options')!r}"
    else:
        assert csp == API_CSP, f"{label}: CSP {csp!r}; a route with its own CSP is listed in header_support.OWN_CSP"
        assert headers.get("x-frame-options") == "DENY", f"{label}: X-Frame-Options {headers.get('x-frame-options')!r}"
    # HSTS is the HTTPS proxy's (Caddy), in every environment: the backend never sends it, so it can't double it.
    assert "strict-transport-security" not in headers, f"{label}: the backend sent Strict-Transport-Security"
