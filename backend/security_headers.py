"""The security headers on every API response (docs/team/uzair.md, step 6). The pages' own headers and their CSP are the
frontend's (`next.config.ts`); these cover what the backend answers itself, JSON mostly, nothing meant to be framed,
cached or sniffed.

The outermost user middleware (added after RequestLog in backend/main.py), so every answer the app makes gets them: a
route's, a 401 or 403 from the access check, a 413, a 429, a busy 503. Set only when absent, so a route that sets its
own keeps it (the posting reader's sandboxed CSP, the notifications' `private, no-store`). A route's own Cache-Control
still says `no-store` (the route sweep checks every route: backend/tests/header_support.py). The crash 500 is answered
by Starlette outside every user middleware, so `backend/problem.py` adds the same set to every error body it builds.
"""
from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from backend import config

CSP = "Content-Security-Policy"
# Nothing an API answer could load or be framed by. The posting reader (routes_jobs.py) sets its own, sandboxed.
API_CSP = "default-src 'none'; frame-ancestors 'none'"
# No Strict-Transport-Security here: it is the HTTPS proxy's (Abdul's Caddy for app.benchq.io, 2026-11-23), and a
# second copy from the backend could contradict it.
# The API docs (development only; DEV_ONLY in backend/auth/access.py) load Swagger's script and styles.
DOCS_PATHS = frozenset({"/docs", "/docs/oauth2-redirect", "/redoc", "/openapi.json"})

_BASE = {
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Resource-Policy": "same-origin",
}


def headers_for(path: str | None = None) -> dict[str, str]:
    """The set for an answer to `path` (None: an error body, which is never the docs)."""
    headers = dict(_BASE)
    if not (path in DOCS_PATHS and not config.IS_PRODUCTION):
        headers[CSP] = API_CSP
    return headers


def add_missing(headers: MutableHeaders, path: str | None = None) -> None:
    """Each header of the set the response doesn't have yet. X-Frame-Options (DENY) only when the response has no CSP
    of its own: a route that set one (the posting reader, framed by the app) decides its framing there."""
    had_csp = CSP in headers
    for name, value in headers_for(path).items():
        if name == CSP and had_csp:
            continue
        if name not in headers:
            headers[name] = value
    if not had_csp and "X-Frame-Options" not in headers:
        headers["X-Frame-Options"] = "DENY"


class SecurityHeaders:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        path = scope.get("path")

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                add_missing(MutableHeaders(scope=message), path)
            await send(message)

        await self.app(scope, receive, send_with_headers)
