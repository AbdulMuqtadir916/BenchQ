"""One line per request, and the request id every log line of it carries (docs/team/uzair.md §1, step 4a).

The outermost middleware. On the way in it takes the caller's `X-Request-ID` when it is safe (up to 64 letters,
digits, `_` or `-`; the frontend or a proxy may send one) or makes one, and sets it for the request's log lines
(backend/logging_setup.py). On the way out it sends the id back in `X-Request-ID` and logs the method, the route
pattern (never the raw path: invite links carry their token there), the status, the time taken and who asked.

An error no handler caught is logged here with its traceback and request id, then re-raised: Starlette answers the
plain "Internal Server Error" (with the id, `backend/main.py`), and the test client still sees the exception.
"""
import logging
import re
import time
import uuid

from starlette.datastructures import MutableHeaders
from starlette.requests import Request
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from backend.auth.access import SAVED_ROUTE, route_key
from backend.logging_setup import LOGGED_MARK, request_id

logger = logging.getLogger("benchq.request")

HEADER = "X-Request-ID"
_SAFE_ID = re.compile(r"[A-Za-z0-9_-]{1,64}")
NO_ROUTE = "(no route)"
# Polled by the deployment; logged at DEBUG so it doesn't bury everything else.
QUIET_ROUTES = frozenset({"GET /health"})
# No response was started and nothing failed: the client went away first (nginx's "client closed request").
CLIENT_CLOSED = 499


def _incoming_id(scope: Scope) -> str:
    for name, value in scope.get("headers") or []:
        if name == b"x-request-id":
            candidate = value.decode("latin-1").strip()
            if _SAFE_ID.fullmatch(candidate):
                return candidate
    return uuid.uuid4().hex[:16]


def _who(scope: Scope) -> dict:
    """The signed-in account, from what backend/auth/access.py resolved: ids only."""
    principal = (scope.get("state") or {}).get("principal")
    if principal is None:
        return {}
    who = {"user_id": str(principal.user_id)}
    if principal.firm_id is not None:
        who["firm_id"] = str(principal.firm_id)
    if principal.support_firm_id is not None:            # a Super Admin reading a firm through a support view
        who["support_firm_id"] = str(principal.support_firm_id)
    return who


class RequestLog:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        rid = _incoming_id(scope)
        token = request_id.set(rid)
        scope.setdefault("state", {})["request_id"] = rid
        key = route_key(scope["app"], Request(scope)) if "app" in scope else None
        method = scope["method"]
        # backend/auth/access.py reuses it instead of matching every route again, while the method and path still match.
        scope["state"][SAVED_ROUTE] = (method, scope["path"], key)
        route = key.split(" ", 1)[1] if key else NO_ROUTE
        status: int | None = None                       # set when the response starts
        failed = False
        started = time.perf_counter()

        async def _send(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
                MutableHeaders(scope=message).append(HEADER, rid)
            await send(message)

        try:
            await self.app(scope, receive, _send)
        except Exception as exc:
            failed = True
            logger.exception("Unhandled error on %s %s", method, route)
            try:
                setattr(exc, LOGGED_MARK, True)
            except Exception:
                pass
            raise
        finally:
            if status is None:
                status = 500 if failed else CLIENT_CLOSED
            duration_ms = round((time.perf_counter() - started) * 1000)
            fields = {"method": method, "route": route, "status": status, "duration_ms": duration_ms, **_who(scope)}
            level = logging.DEBUG if key in QUIET_ROUTES else logging.INFO
            logger.log(level, "%s %s %s %sms", method, route, status, duration_ms, extra={"fields": fields})
            request_id.reset(token)
