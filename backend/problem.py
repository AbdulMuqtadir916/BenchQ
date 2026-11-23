"""One error body for every error the backend makes (docs/team/uzair.md step 4b; docs/02-DATA-CONTRACTS.md §12).

RFC 9457 "Problem Details", `application/problem+json`:

    {"type": "about:blank", "title": "Conflict", "status": 409, "detail": "…", "code": "DUPLICATE_RESUME",
     "request_id": "…", <extension members at the top level>}

`detail` is always a string written for the user. `code` is the status's default (`DEFAULT_CODES`) unless the raise
site names one of `CODES`: raise `Problem(...)` instead of `HTTPException(...)` for that. `request_id` is the
request's id (backend/request_log.py), the same as the `X-Request-ID` header. A 422 from request validation carries
`errors: [{loc, msg, type}]`, never the submitted input.

No specific code on a 404 or 403, ever (`Problem` refuses one): a code must not confirm that a record exists in
another firm.
"""
import uuid
from http import HTTPStatus
from typing import Any

from fastapi import HTTPException
from starlette.responses import JSONResponse, Response

from backend.logging_setup import request_id

MEDIA_TYPE = "application/problem+json"

# The code an error gets from its status alone. The names the frontend already uses (src/lib/api/http.ts) are kept.
DEFAULT_CODES = {
    400: "BAD_REQUEST",
    401: "UNAUTHENTICATED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    405: "METHOD_NOT_ALLOWED",
    409: "CONFLICT",
    410: "GONE",
    413: "TOO_LARGE",
    415: "UNSUPPORTED_TYPE",
    422: "VALIDATION_FAILED",
    429: "RATE_LIMITED",
    500: "INTERNAL",
    502: "UPSTREAM_FAILED",
    503: "UNAVAILABLE",
    504: "TIMEOUT",
}

# The specific codes (docs/02 §12.1), each sent from the places the registry names.
DAILY_LIMIT = "DAILY_LIMIT"                        # a BDE's or a candidate's daily quota; the text says when it resets
TAILORINGS_RUNNING = "TAILORINGS_RUNNING"          # a BDE's tailorings running at once
NOT_CONFIGURED = "NOT_CONFIGURED"                  # a feature this server isn't set up for; the text says which
RESUME_READER_FAILED = "RESUME_READER_FAILED"      # the résumé reader's model didn't answer
RESUME_READER_TIMEOUT = "RESUME_READER_TIMEOUT"    # the résumé reader's model ran out of time
RESUME_FILE_FAILED = "RESUME_FILE_FAILED"          # a résumé version's PDF or Word file couldn't be made; try again
SEARCH_NOT_STARTED = "SEARCH_NOT_STARTED"          # a job search couldn't be launched
DUPLICATE_RESUME = "DUPLICATE_RESUME"              # the file is already one of the candidate's bases
MAILBOX_BUSY = "MAILBOX_BUSY"                      # a Google account's connect or clean-up is running; try shortly

CODES = frozenset(DEFAULT_CODES.values()) | {
    DAILY_LIMIT, TAILORINGS_RUNNING, NOT_CONFIGURED, RESUME_READER_FAILED, RESUME_READER_TIMEOUT,
    RESUME_FILE_FAILED, SEARCH_NOT_STARTED, DUPLICATE_RESUME, MAILBOX_BUSY,
}

# The validation 422's detail: what the person can do (docs/02 §12.2, rule 4). The fields are in `errors`.
VALIDATION_DETAIL = "BenchQ couldn't take this as it was sent. Refresh the page and try again."
INTERNAL_DETAIL = "Something went wrong on BenchQ's side."


class Problem(HTTPException):
    """An `HTTPException` with a specific code and extension members, for the raise sites the registry names."""

    def __init__(self, status_code: int, detail: str, code: str, headers: dict[str, str] | None = None,
                 **extensions: Any) -> None:
        if code not in CODES:
            raise ValueError(f"{code} is not in the error code registry (backend/problem.py)")
        if status_code in (403, 404) and (code != DEFAULT_CODES[status_code] or extensions):
            raise ValueError("A 403 or 404 carries no specific code or extra field (docs/02 §12.2, rule 1)")
        super().__init__(status_code=status_code, detail=detail, headers=headers)
        self.code = code
        self.extensions = extensions


def _title(status: int) -> str:
    try:
        return HTTPStatus(status).phrase
    except ValueError:
        return "Error"


def current_request_id(request=None) -> str:
    """The request's id (backend/request_log.py keeps it in the request's state and in a context variable); outside a
    request (a middleware tested alone) a fresh one, so the body always has one."""
    state = getattr(request, "state", None)
    return getattr(state, "request_id", None) or request_id.get() or uuid.uuid4().hex[:16]


def problem_response(status: int, detail: str, code: str | None = None, headers: dict[str, str] | None = None,
                     errors: list[dict] | None = None, request=None, **extensions: Any) -> JSONResponse:
    """The one error body. `code` defaults to the status's; `errors` is for the validation 422 only. `request`, when
    given, is where the request id is read from (the outermost 500 handler runs after the context variable is reset).
    """
    body: dict[str, Any] = {
        "type": "about:blank",
        "title": _title(status),
        "status": status,
        "detail": detail,
        "code": code or DEFAULT_CODES.get(status, f"HTTP_{status}"),
        "request_id": current_request_id(request),
    }
    if errors is not None:
        body["errors"] = errors
    for name, value in extensions.items():
        if name not in body:
            body[name] = value
    return JSONResponse(status_code=status, content=body, headers=headers, media_type=MEDIA_TYPE)


def from_http_exception(exc, request=None) -> Response:
    """FastAPI's and Starlette's `HTTPException` (unknown paths and wrong methods raise Starlette's), `exc.headers`
    kept. A non-string `detail` is a leftover's: its words are lost rather than sent as an object."""
    if exc.status_code < 400 or exc.status_code in (204, 304):      # not an error: no body, as Starlette answers it
        return Response(status_code=exc.status_code, headers=exc.headers)
    detail = exc.detail if isinstance(exc.detail, str) else _title(exc.status_code)
    return problem_response(exc.status_code, detail, getattr(exc, "code", None), headers=exc.headers,
                            request=request, **getattr(exc, "extensions", {}))


def validation_errors(errors) -> list[dict]:
    """Pydantic's errors, each cut to where, what and which kind: never `input` (it would echo an email or a
    password back) or `ctx`."""
    return [{"loc": list(e.get("loc", ())), "msg": str(e.get("msg", "")), "type": str(e.get("type", ""))}
            for e in errors]
