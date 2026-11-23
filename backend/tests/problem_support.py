"""The error body every test checks against (backend/problem.py; docs/02-DATA-CONTRACTS.md §12)."""
from backend import problem

MEMBERS = {"type", "title", "status", "detail", "code", "request_id"}

# Routes whose hand-built errors keep the old `{"detail": …}` shape: JobNavigator leftovers no BenchQ screen or the
# extension calls, until Abdul's clean-up track (docs/02 §12.1, exceptions). Their raised errors have the new shape.
LEFTOVER_SHAPE = frozenset({
    # The "already running" 409s, built as JSONResponse in backend/main.py.
    "POST /api/scrape/run-all", "POST /api/email/check-now", "POST /api/h1b/refresh", "POST /api/analyze/{job_id}",
    "POST /api/db/cleanup", "POST /api/auto-reject/run", "POST /api/jobs/backfill-descriptions", "POST /api/db/backup",
    "POST /api/telegram/digest", "POST /api/scrape/company/{company_id}", "POST /api/telegram/test",
    "POST /api/searches/{search_id}/run",          # backend/api/routes_searches.py
    "POST /api/cover-letters/generate",            # backend/api/routes_cover_letters.py
})

# §12.2 rule 6: a 429, 503 or 500 with the status's default code comes only from its named sender, told by its words.
SENDER_DETAIL = {
    "RATE_LIMITED": "Too many attempts. Try again in a few minutes.",       # backend/auth/throttle.py TOO_MANY
    "UNAVAILABLE": "The service is busy. Try again in a few seconds.",      # backend/statement_timeout.py BUSY
    "INTERNAL": problem.INTERNAL_DETAIL,                                    # main.py's crash and DataError handlers
}
# JobNavigator leftovers whose raised 429/503/500 keep a default code until Abdul's clean-up (docs/02 §12.1).
LEFTOVER_DEFAULT_CODES = frozenset({
    "GET /api/persona", "PATCH /api/persona",                             # routes_persona.py:49,62
    "POST /api/companies/{company_id}/test-scrape",                       # routes_companies.py:670
    "POST /api/telegram/webhook",                                         # main.py: webhook secret not configured
    "POST /api/autofill/answer", "POST /api/autofill/answer/stream", "GET /api/autofill/config",  # routes_autofill
    "GET /api/cover-letters/{cl_id}/pdf", "POST /api/cover-letters/generate",                     # routes_cover_letters
})


def assert_problem(response, where: str = "") -> dict:
    """The response is one Problem Details body with a registered code; returns the body."""
    label = f"{where} {response.status_code}".strip()
    assert response.headers.get("content-type", "").startswith(problem.MEDIA_TYPE), \
        f"{label}: content type {response.headers.get('content-type')!r}: {response.text[:200]}"
    body = response.json()
    assert MEMBERS <= body.keys(), f"{label}: missing {sorted(MEMBERS - body.keys())}: {body}"
    assert body["type"] == "about:blank" and body["status"] == response.status_code, f"{label}: {body}"
    assert isinstance(body["detail"], str) and body["detail"], f"{label}: detail must be a string: {body}"
    assert body["code"] in problem.CODES, f"{label}: {body['code']} is not in the registry"
    assert isinstance(body["request_id"], str) and body["request_id"], f"{label}: no request id"
    if body["code"] in SENDER_DETAIL and where not in LEFTOVER_DEFAULT_CODES:
        assert body["detail"] == SENDER_DETAIL[body["code"]], (
            f"{label}: {body['code']} is only for its named sender (docs/02 §12.2, rule 6); give this error its own "
            f"code: {body['detail']!r}")
    if response.status_code in (403, 404):
        # One body for every not-found and forbidden: a code or a field can't confirm a record exists.
        assert body["code"] == problem.DEFAULT_CODES[response.status_code], f"{label}: specific code {body['code']}"
        assert body.keys() == MEMBERS, f"{label}: extra members {sorted(body.keys() - MEMBERS)}"
    if "errors" in body:
        assert response.status_code == 422 and body["code"] == "VALIDATION_FAILED", f"{label}: errors on {body}"
        for error in body["errors"]:
            assert error.keys() == {"loc", "msg", "type"}, f"{label}: {error}"
    return body


def body_of(response) -> dict:
    """A checked Problem body, whole, without its request id (each answer has its own; asserted present): for tests
    that compare an error to an expected body, or two answers that must be identical (tenancy)."""
    body = assert_problem(response)
    return {k: v for k, v in body.items() if k != "request_id"}


def expected(status: int, detail: str, code: str | None = None, **extensions) -> dict:
    """The body `body_of` returns for an error the backend makes with these words."""
    from http import HTTPStatus
    return {"type": "about:blank", "title": HTTPStatus(status).phrase, "status": status, "detail": detail,
            "code": code or problem.DEFAULT_CODES[status], **extensions}


def without_request_id(text: str) -> str:
    """A body's text with its request id blanked: two answers that must be the same differ only in that."""
    import re
    assert '"request_id":"' in text or not text.startswith('{"type"'), f"no request id: {text[:200]}"
    return re.sub(r'"request_id":"[^"]*"', '"request_id":"<rid>"', text)
