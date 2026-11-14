"""A Super Admin's own operations, in the activity log.

The platform's settings, searches, companies, scrapes, backups and Telegram or LinkedIn controls are not a firm's activity,
but they are a person's actions, and the Super Admin's Activity page is the record of everything that happens on the
platform. Each such route lists `dependencies=[Depends(logs_platform_action(...))]`. When the route succeeds, one entry is
written with no firm and the Super Admin as the actor.

"Succeeds" is decided by the answer, not by the route returning: `PlatformActionLog` (installed on the app) writes the
entry once the response has a status below 400. So an exception, an HTTPException, or a returned `JSONResponse(409)`
("already running") writes nothing. A route that answers 200 but did nothing (a PIN with no digits, a refresh already
under way) calls `did_nothing(request)`.

What goes in the entry: what was done, the id in the path, and for a change the *names* of the fields in the request body.
Never their values (a setting can hold a key or a token), and never the body.
"""
import json
import logging
from functools import partial

from fastapi import Depends, Request
from starlette.concurrency import run_in_threadpool

from backend.api.routes_auth import current_principal
from backend.auth import ledger
from backend.auth.sessions import Principal
from backend.models.db import SessionLocal
from backend.models.tenancy import PlatformUser

logger = logging.getLogger("jobnavigator.platform_actions")
MAX_FIELDS_SHOWN = 12
PENDING = "platform_actions"          # request.state: the entries this request will write if it succeeds
UNCHANGED = "•" * 6                   # what the settings screen sends back for a secret it didn't change


def _field_names(body: bytes) -> list[str]:
    """The fields the request changes: a secret sent back as its placeholder is left as it was, so it isn't one."""
    try:
        data = json.loads(body) if body else None
    except ValueError:
        return []
    if not isinstance(data, dict):
        return []
    return sorted(str(key) for key, value in data.items() if value != UNCHANGED)[:MAX_FIELDS_SHOWN]


def _write(principal: Principal, *, action: str, entity_type: str, entity_id: str, summary: str) -> None:
    db = SessionLocal()
    try:
        actor = db.get(PlatformUser, principal.user_id)
        if actor is None:          # these routes are Super Admin only; anyone else is not a platform action
            return
        ledger.record(db, actor=actor, action=action, entity_type=entity_type, entity_id=entity_id,
                      entity_label=entity_type.replace("_", " ").title(), summary=summary, firm_id=None, candidate_id=None)
        db.commit()
    finally:
        db.close()


def did_nothing(request: Request) -> None:
    """For a route that answers 200 but changed nothing: no entry for this request."""
    request.scope.get("state", {}).pop(PENDING, None)


class PlatformActionLog:
    """ASGI middleware: after the response has gone out, writes the request's pending platform entries if its status was
    below 400. A failure to write is logged and never changes the answer."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        status = {}

        async def capture(message):
            if message["type"] == "http.response.start":
                status["code"] = message["status"]
            await send(message)

        await self.app(scope, receive, capture)
        pending = scope.get("state", {}).pop(PENDING, None)
        if not pending or status.get("code", 500) >= 400:
            return
        for entry in pending:
            try:
                await run_in_threadpool(entry)
            except Exception:                              # the answer has gone; the log can't change it
                logger.exception("platform action not logged")


def logs_platform_action(summary: str, *, entity_type: str, action: str = "STATE_CHANGE", id_param: str | None = None,
                         fields: bool = False):
    """A route dependency: after the route succeeds, one platform entry. `id_param` names the path parameter that says which
    record; `fields` adds the names of the fields the request changed."""
    async def dependency(request: Request, principal: Principal = Depends(current_principal)):
        body = await request.body() if fields else b""
        record_id = str(request.path_params.get(id_param)) if id_param and request.path_params.get(id_param) else None
        text = summary + (f" ({record_id})" if record_id else "")
        names = _field_names(body) if fields else []
        if fields and not names:
            return                                      # a change that changes no field is not an action
        if names:
            text += f": {', '.join(names)}"
        # Written by PlatformActionLog once the answer is known to be a success.
        request.scope.setdefault("state", {}).setdefault(PENDING, []).append(partial(
            _write, principal, action=action, entity_type=entity_type, entity_id=record_id or entity_type,
            summary=text + "."))
    return dependency
