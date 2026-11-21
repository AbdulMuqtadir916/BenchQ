"""One error body (docs/team/uzair.md step 4b; docs/02-DATA-CONTRACTS.md §12): the cases the route sweep
(test_log_every_route.py, which checks every route's error) doesn't make. backend/problem.py is the helper."""
import json

import pytest

from backend import problem, statement_timeout
from backend.tests.problem_support import assert_problem

PLANTED = "planted-secret-7f3a"


def test_a_validation_422_names_the_fields_but_never_echoes_what_was_sent(anonymous_client):
    r = anonymous_client.post("/api/auth/sign-in", json={"email": PLANTED * 40, "password": {"x": PLANTED}})
    assert r.status_code == 422
    body = assert_problem(r)
    assert (body["code"], body["detail"]) == ("VALIDATION_FAILED", problem.VALIDATION_DETAIL)
    assert {tuple(e["loc"]) for e in body["errors"]} == {("body", "email"), ("body", "password")}
    assert PLANTED not in r.text


def test_a_wrong_method_answers_405_with_allow_kept(anonymous_client):
    r = anonymous_client.get("/api/auth/sign-in")
    assert r.status_code == 405
    assert assert_problem(r)["code"] == "METHOD_NOT_ALLOWED"
    assert "POST" in r.headers["allow"]


def test_an_unknown_path_answers_404(anonymous_client):
    r = anonymous_client.get("/api/no-such-route")
    assert r.status_code == 404
    assert assert_problem(r)["code"] == "NOT_FOUND"


def test_signed_out_answers_401_with_the_request_id_in_body_and_header(anonymous_client):
    r = anonymous_client.get("/api/auth/me", headers={"X-Request-ID": "trace-123"})
    body = assert_problem(r)
    assert (r.status_code, body["code"], body["request_id"], r.headers["X-Request-ID"]) == \
        (401, "UNAUTHENTICATED", "trace-123", "trace-123")


def test_busy_is_the_only_unavailable_and_keeps_retry_after():
    response = statement_timeout.busy_response()
    body = json.loads(response.body)
    assert response.media_type == problem.MEDIA_TYPE and response.headers["Retry-After"] == "5"
    assert (body["status"], body["code"], body["detail"]) == (503, "UNAVAILABLE", statement_timeout.BUSY)
    assert body["request_id"]


def test_extension_members_sit_at_the_top_level():
    response = problem.from_http_exception(
        problem.Problem(409, "This résumé is already Base 2.", problem.DUPLICATE_RESUME, base_resume_id="b1",
                        hidden=False))
    body = json.loads(response.body)
    assert (body["detail"], body["code"], body["base_resume_id"], body["hidden"]) == \
        ("This résumé is already Base 2.", "DUPLICATE_RESUME", "b1", False)


@pytest.mark.parametrize("status", [403, 404])
def test_a_403_or_404_never_takes_a_specific_code(status):
    with pytest.raises(ValueError):
        problem.Problem(status, "Not found", problem.DUPLICATE_RESUME)


@pytest.mark.parametrize("status", [403, 404])
def test_a_403_or_404_never_takes_an_extra_field(status):
    with pytest.raises(ValueError):
        problem.Problem(status, "Not found", problem.DEFAULT_CODES[status], base_resume_id="b1")


def test_a_default_code_from_another_sender_fails_the_check():
    """§12.2 rule 6, as the route sweep enforces it: a busy-coded 503 that isn't the busy answer is refused."""
    import httpx
    response = problem.problem_response(503, "Something else is down.")
    fake = httpx.Response(503, content=response.body, headers=dict(response.headers))
    with pytest.raises(AssertionError, match="rule 6"):
        assert_problem(fake, "GET /api/some/route")


def test_a_code_outside_the_registry_is_refused():
    with pytest.raises(ValueError):
        problem.Problem(409, "No.", "MADE_UP")


def test_a_leftover_object_detail_is_never_sent_as_an_object():
    from fastapi import HTTPException
    body = json.loads(problem.from_http_exception(HTTPException(409, detail={"message": "x"})).body)
    assert body["detail"] == "Conflict" and body["code"] == "CONFLICT"


def test_the_mailbox_connect_refusal_is_fixed_words_not_the_exception(api_client, accounts, test_db,
                                                                       jobs_in_default_firm, monkeypatch):
    """routes_inbox.py: a server not set up for Gmail answers NOT_CONFIGURED in BenchQ's words, never the error's."""
    from backend.api import routes_inbox
    from backend.tests.test_candidate_application_status import _saved_candidate_application

    def _not_set_up():
        raise RuntimeError(f"library said {PLANTED}")

    candidate = _saved_candidate_application(test_db, accounts, jobs_in_default_firm, "OWNER")[0]
    monkeypatch.setattr(routes_inbox, "build_authorization", _not_set_up)
    r = api_client.post(f"/api/firms/{candidate.firm_id}/candidates/{candidate.id}/mailbox/oauth",
                        json={"return_to": "/"})
    assert r.status_code == 503 and PLANTED not in r.text
    body = assert_problem(r)
    assert (body["code"], body["detail"]) == ("NOT_CONFIGURED", routes_inbox.GMAIL_NOT_SET_UP)
