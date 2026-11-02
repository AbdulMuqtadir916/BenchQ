"""Database statement timeouts (docs/team/uzair.md §1, step 2b): no single query runs for ever.

Every connection starts with a 1-minute limit per query (`backend/models/db.py`), which is what background work gets:
the scheduler, `launch_background()` and scripts. A web request tightens it to 15 s for its own queries, because a
person is waiting: the `WebRequestMarker` middleware marks the request, and each transaction it opens starts with
`SET LOCAL statement_timeout`, which ends with that transaction, so it never carries over to the connection's next
user. Migrations and the backup's `pg_dump` use their own connections and have no limit.

Work launched from a request inherits the mark (asyncio copies it into new tasks), so `job_monitor` clears it at the
start of background work with `leave_web_request()`.

A query past its limit is cancelled by Postgres (SQLSTATE 57014). The request answers 503 with `Retry-After`, in the
same words as a drained pool; the route and the statement (without its values) go to the server log only.
"""
import contextvars

from sqlalchemy import event
from sqlalchemy.engine import Engine
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

WEB_STATEMENT_TIMEOUT = "15s"
BUSY = "The service is busy. Try again in a few seconds."
QUERY_CANCELED = "57014"

_in_web_request = contextvars.ContextVar("in_web_request", default=False)


class WebRequestMarker:
    """Marks every HTTP request, so the queries it runs get the web limit."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        token = _in_web_request.set(True)
        try:
            await self.app(scope, receive, send)
        finally:
            _in_web_request.reset(token)


def leave_web_request() -> None:
    """From here on in this task, queries get the background limit (the connection's own)."""
    _in_web_request.set(False)


def install(engine: Engine) -> None:
    """Start each transaction opened inside a web request with the web limit. Postgres only."""
    if engine.dialect.name != "postgresql":
        return

    @event.listens_for(engine, "begin")
    def _limit_web_queries(conn) -> None:
        if _in_web_request.get():
            conn.exec_driver_sql(f"SET LOCAL statement_timeout = '{WEB_STATEMENT_TIMEOUT}'")


def is_statement_timeout(exc: BaseException) -> bool:
    """Whether a database error is Postgres cancelling a query past its limit."""
    return getattr(getattr(exc, "orig", None), "pgcode", None) == QUERY_CANCELED


def busy_response() -> JSONResponse:
    """A timed-out query or a drained pool: try again shortly."""
    return JSONResponse(status_code=503, content={"detail": BUSY}, headers={"Retry-After": "5"})
