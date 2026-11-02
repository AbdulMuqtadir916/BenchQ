"""Request body size cap (docs/team/uzair.md §1, step 2): an oversized request is refused with 413 before the app reads
it, so nobody can make the backend hold a huge body in memory.

The file uploads may carry a 10 MB file plus the form around it; every other request is JSON that the app keeps well
under 1 MB. The upload routes still check their own 10 MB limit and answer with their own message.

A request that declares its length (`Content-Length`, what browsers send) is judged from the header without reading
anything. One that doesn't (chunked) is read up to the cap and then handed on, or refused once it passes the cap.
"""
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from backend.auth.access import route_key

MB = 1024 * 1024
LIMIT = 1 * MB
UPLOAD_LIMIT = 11 * MB
UPLOAD_ROUTES = frozenset({
    "POST /api/firms/{firm_id}/candidates/parse-resume",
    "POST /api/resumes/import-pdf",
    "POST /api/persona/import",
})

TOO_LARGE = "This request is too large."
FILE_TOO_LARGE = "That file is too large. Up to 10 MB."


class BodySizeLimit:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        is_upload = "app" in scope and route_key(scope["app"], Request(scope)) in UPLOAD_ROUTES
        limit, detail = (UPLOAD_LIMIT, FILE_TOO_LARGE) if is_upload else (LIMIT, TOO_LARGE)
        refuse = JSONResponse(status_code=413, content={"detail": detail})

        declared = Request(scope).headers.get("content-length")
        if declared is not None:
            # The server already refuses a malformed length and holds the body to the one declared.
            if declared.isdigit() and int(declared) > limit:
                await refuse(scope, receive, send)
                return
            await self.app(scope, receive, send)
            return

        received: list[Message] = []
        size = 0
        while True:
            message = await receive()
            received.append(message)
            if message["type"] != "http.request":
                break
            size += len(message.get("body", b""))
            if size > limit:
                await refuse(scope, receive, send)
                return
            if not message.get("more_body", False):
                break

        async def replay() -> Message:
            return received.pop(0) if received else await receive()

        await self.app(scope, replay, send)
