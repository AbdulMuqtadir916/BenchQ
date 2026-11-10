"""Every route, sent planted values, writes none of them to the log (docs/team/uzair.md §1, step 4a).

The canary (test_logging_canary.py) checks the flows it was written for; this checks every route the app has,
found from the app itself, so a new route is checked the day it is added and nobody has to list it. Per route: a
fresh database with one row in every table, planted values in people's rows, the request, and the AI's and Google's
replies (backend/tests/route_sweep.py); then the log is searched for the planted values, after masking, at INFO, as
production writes it.

It runs the path the request takes. A branch it doesn't reach (an `except` that logs) is test_log_lint.py's.

NOT_REACHED lists the routes the built request doesn't get through yet (the route answers 4xx before its work), with
why. A route listed there is still checked for what it logged on the way, but its normal path isn't run; the list
only shrinks, and the stale check makes sure.
"""
import threading

import pytest
from fastapi import FastAPI
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from sqlalchemy import text as sql_text

import backend.main  # noqa: F401  configures logging, as the running app does
import backend.tests.log_leak_cases as leak_cases
from backend.tests.route_sweep import build_request, seed_every_table, stub_outside
from backend.tests.test_logging_canary import MARKERS

SKIPPED_METHODS = {"HEAD", "OPTIONS"}
SECONDS = 60

# "METHOD path" -> why the built request doesn't reach the route's work.
NOT_REACHED: dict[str, str] = {
    "GET /": "404: Not found",
    "POST /api/applications": "400: Saving requires candidate_id, job_id, and status='saved'",
    "POST /api/applications/bulk-delete":
        "409: Candidate applications are removed through Saved/favorite actions; move their status instead",
    "POST /api/applications/bulk-update": "400: status is required",
    "DELETE /api/applications/{app_id}":
        "409: Candidate applications are removed through Saved/favorite actions; move their status instead",
    "PATCH /api/applications/{app_id}": "400: Send only {unfavorite: true} to remove a favorite",
    "PATCH /api/applications/{app_id}/candidate-status": "400: Unsupported candidate application status",
    "PATCH /api/applications/{app_id}/review": "404: Review not found",
    "POST /api/auth/password-reset/complete":
        "400: This link has expired. Contact your manager or firm owner for a new one",
    "POST /api/auth/sign-in": "401: Email or password is incorrect",
    "POST /api/companies/{company_id}/test-scrape": "400: No scrape URLs configured",
    "POST /api/cover-letters": "400: name is required",
    "GET /api/cover-letters/{cl_id}/pdf": "422: Unknown template: <planted>",
    "POST /api/firms/{firm_id}/candidates": "404: That résumé read has expired. Upload it again",
    "GET /api/firms/{firm_id}/candidates/{candidate_id}/inbox": "400: Invalid email cursor",
    "GET /api/firms/{firm_id}/candidates/{candidate_id}/mailbox/confirm/{attempt_id}":
        "404: Mailbox confirmation expired. Connect again",
    "POST /api/firms/{firm_id}/candidates/{candidate_id}/mailbox/confirm/{attempt_id}":
        "409: Mailbox confirmation expired. Connect again",
    "POST /api/firms/{firm_id}/candidates/{candidate_id}/mailbox/oauth": "400: Invalid local return path",
    # Only the candidate's BDE searches (decided 2026-11-10) and the sweep signs in as the OWNER. The search's own
    # logging (ids, codes, counts; never the query) is checked in test_job_search_api.py.
    "POST /api/firms/{firm_id}/candidates/{candidate_id}/job-searches": "403: Only this candidate's BDE searches jobs for them",
    "DELETE /api/firms/{firm_id}/candidates/{candidate_id}/resumes/bases/{base_id}":
        "409: Base 1 holds what an owner or manager added, so it can't be deleted",
    "DELETE /api/firms/{firm_id}/candidates/{candidate_id}/resumes/{resume_id}":
        "409: Version 1 is the base itself. Delete the whole base instead",
    "POST /api/firms/{firm_id}/candidates/{candidate_id}/resumes/{resume_id}/save":
        "400: This version names an item it doesn't have. Reload the résumé and edit it again",
    "POST /api/firms/{firm_id}/invites": "400: Only a BDE reports to a manager",
    "POST /api/firms/{firm_id}/invites/{invite_id}/resend": "403: Only BenchQ can resend or revoke the owner's invite",
    "POST /api/firms/{firm_id}/invites/{invite_id}/revoke": "403: Only BenchQ can resend or revoke the owner's invite",
    "PATCH /api/firms/{firm_id}/members/{user_id}/manager": "404: Not found",
    "POST /api/invites/{token}/accept": "410: This invite link isn't valid",
    "POST /api/jobs/bulk-update": "422: updates must be an object",
    "POST /api/jobs/manual": "400: title, company, and url are required",
    "POST /api/jobs/save-from-extension": "400: title, company, and url are required",
    "PATCH /api/jobs/{job_id}": "400: saved must be true or false",
    "GET /api/jobs/{job_id}/live-page": "502: Posting is rendered client-side — needs the extension",
    "POST /api/notifications/{notification_id}/password-reset-decision": "404: Notification not found",
    "POST /api/notifications/{notification_id}/password-reset-link": "404: Notification not found",
    "GET /api/oauth/google/callback": "404: Not found",
    "POST /api/persona/qa-bank": "400: question and answer are required",
    "GET /api/searches/test-result/{run_id}": "404: Test run not found",
    "POST /api/searches/{search_id}/test":
        "400: Test only supports keyword, levels_fyi, linkedin_personal, jobright, and freehire searches",
    "POST /api/telegram/webhook": "503: Telegram webhook secret not configured",
    "GET /cv/{token}": "404: Link not found",
}

# "METHOD path" -> the state a seeded row needs for the route to do its work, set just before its request.
ROUTE_STATE = {
    "POST /api/firms/{firm_id}/candidates/{candidate_id}/inbox-messages/{message_id}/classification/retry":
        {"inbox_messages": {"classification_state": "ERROR"}},
    "POST /api/firms/{firm_id}/candidates/{candidate_id}/inbox-messages/{message_id}/classification/reclassify":
        {"inbox_messages": {"classification_state": "DONE"}},
}

# "METHOD path" -> who was told: routes that do write planted values today (as test_log_lint.KNOWN for the code).
# Delete an entry when its route is fixed; the test fails until then, and fails if it's fixed and still listed.
KNOWN_LEAKS: dict[str, str] = {}


def _routes(app) -> list[str]:
    return sorted(f"{m} {r.path}" for r in app.router.routes if isinstance(r, APIRoute)
                  for m in r.methods if m not in SKIPPED_METHODS)


def _send(client, app, route: str, ids: dict):
    method, path = route.split(" ", 1)
    kwargs = build_request(app, method, path, ids)
    result = {}

    def run():
        try:
            result["response"] = client.request(**kwargs)
        except Exception as e:                                # raise_server_exceptions=False: shouldn't happen
            result["error"] = e

    worker = threading.Thread(target=run, daemon=True)
    worker.start()
    worker.join(SECONDS)
    assert not worker.is_alive(), f"{route} didn't answer in {SECONDS}s"
    assert "error" not in result, f"{route}: {result['error']!r}"
    # A route that wakes the email worker runs it on another thread: wait, so what it logs is checked with this route.
    from backend.inbox import classification_worker
    if classification_worker._FUTURE is not None:
        classification_worker._FUTURE.result(timeout=SECONDS)
    return result["response"]


def _leaked(buffer) -> list[str]:
    written = buffer.getvalue().lower()
    return [m for m in MARKERS if m in written]


@pytest.fixture
def swept(api_client, accounts, test_db, monkeypatch):
    """A database with a row in every table, the outside services stubbed, and a client that doesn't raise."""
    ids, failed = seed_every_table(test_db, accounts)
    stub_outside(monkeypatch)
    api_client._transport.raise_server_exceptions = False
    return ids, failed


@pytest.mark.parametrize("route", _routes(backend.main.app))
def test_no_route_writes_planted_values_to_the_log(route, swept, api_client, test_db, log):
    ids, _ = swept
    for table, values in ROUTE_STATE.get(route, {}).items():
        test_db.execute(sql_text(f'UPDATE "{table}" SET ' + ", ".join(f"{k} = :{k}" for k in values)), values)
    test_db.commit()
    response = _send(api_client, backend.main.app, route, ids)
    leaked = _leaked(log)
    if route in KNOWN_LEAKS:
        assert leaked, f"{route} no longer writes planted values: remove it from KNOWN_LEAKS"
    else:
        assert not leaked, f"{route} wrote planted values to the log: {leaked}\n{log.getvalue()[-3000:]}"
    reached = response.status_code < 400
    if route in NOT_REACHED:
        assert not reached, f"{route} gets through now: remove it from NOT_REACHED"
    else:
        assert reached, (f"{route} answered {response.status_code} to the built request, so its work never ran and "
                         f"wasn't checked: {response.text[:300]}. Make the seed or the request fit (route_sweep.py), or "
                         f"list it in NOT_REACHED with why")


def test_every_table_is_seeded(swept):
    """A table the seed can't fill is one whose rows no route is checked with."""
    _, failed = swept
    assert not failed, f"these tables have no seeded row: {failed}"


def test_the_list_names_only_routes_that_exist():
    stale = sorted((set(NOT_REACHED) | set(KNOWN_LEAKS)) - set(_routes(backend.main.app)))
    assert not stale, f"these routes no longer exist; remove them from NOT_REACHED or KNOWN_LEAKS: {stale}"


# ── The check, measured against log_leak_cases.py ─────────────────────────

# What the run-time check misses among the leak cases, and why; test_log_lint.py catches each of them.
MISSED_CASES = {
    "POST /leak/only-on-timeout": "the branch that logs runs only when a timeout happens, and none does",
    "POST /leak/only-if-senior": "the branch that logs runs only for more than 40 years' experience",
    "GET /leak/http-reply": "a reply from a host not in PERSONAL_HOSTS gets a neutral reply",
    "GET /leak/http-json": "a reply from a host not in PERSONAL_HOSTS gets a neutral reply",
    "GET /leak/path-token/{token}": "the planted token is a long random string, which redact() masks: nothing leaks",
    "POST /leak/upload-content": "a PDF's first bytes are compressed: the planted text isn't in them",
}


def _leak_app():
    from backend.models.db import get_db
    app = FastAPI()
    app.include_router(leak_cases.router)
    for dependency, override in backend.main.app.dependency_overrides.items():
        if dependency is get_db:
            app.dependency_overrides[get_db] = override
    return app


def test_the_check_catches_the_leak_cases(swept, api_client, log):
    """Measured, not assumed: every leak in log_leak_cases.py is caught but the ones MISSED_CASES names, and none of
    its safe routes leaks."""
    ids, _ = swept
    app = _leak_app()
    caught, unreached = set(), set()
    with TestClient(app, raise_server_exceptions=False) as client:
        for route in _routes(app):
            log.seek(0)
            log.truncate()
            response = _send(client, app, route, ids)
            if response.status_code >= 400:
                unreached.add(f"{route} ({response.status_code}: {response.text[:120]})")
            if _leaked(log):
                caught.add(route)
    leaks = {r for r in _routes(app) if " /leak/" in r}
    assert not unreached, f"the built request didn't get through: {sorted(unreached)}"
    assert leaks - caught == set(MISSED_CASES), (
        f"missed: {sorted(leaks - caught - set(MISSED_CASES))}; now caught, remove from MISSED_CASES: "
        f"{sorted(set(MISSED_CASES) & caught)}")
    assert not caught - leaks, f"safe routes leaked: {sorted(caught - leaks)}"
