"""A Super Admin's own operations, in the activity log.

The platform's settings, searches, companies, scrapes, backups and Telegram or LinkedIn controls are not a firm's activity,
but they are a person's actions, and the Super Admin's Activity page is the record of everything that happens on the
platform. Each such route lists `dependencies=[Depends(logs_platform_action(...))]`. When the route succeeds, one entry is
written with no firm and the Super Admin as the actor. A route that fails writes nothing.

What goes in the entry: what was done, the id in the path, and for a change the *names* of the fields in the request body.
Never their values (a setting can hold a key or a token), and never the body.
"""
import json

from fastapi import Depends, Request
from starlette.concurrency import run_in_threadpool

from backend.api.routes_auth import current_principal
from backend.auth import ledger
from backend.auth.sessions import Principal
from backend.models.db import SessionLocal
from backend.models.tenancy import PlatformUser

MAX_FIELDS_SHOWN = 12


def _field_names(body: bytes) -> list[str]:
    try:
        data = json.loads(body) if body else None
    except ValueError:
        return []
    return sorted(str(key) for key in data)[:MAX_FIELDS_SHOWN] if isinstance(data, dict) else []


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


def logs_platform_action(summary: str, *, entity_type: str, action: str = "STATE_CHANGE", id_param: str | None = None,
                         fields: bool = False):
    """A route dependency: after the route succeeds, one platform entry. `id_param` names the path parameter that says which
    record; `fields` adds the names of the fields the request changed."""
    async def dependency(request: Request, principal: Principal = Depends(current_principal)):
        body = await request.body() if fields else b""
        yield                                           # the route runs; if it raises, we never get past here
        record_id = str(request.path_params.get(id_param)) if id_param and request.path_params.get(id_param) else None
        text = summary + (f" ({record_id})" if record_id else "")
        if fields and (names := _field_names(body)):
            text += f": {', '.join(names)}"
        await run_in_threadpool(_write, principal, action=action, entity_type=entity_type,
                                entity_id=record_id or entity_type, summary=text + ".")
    return dependency
