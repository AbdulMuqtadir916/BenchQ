"""One logging setup (backend/logging_setup.py) and the request log (backend/request_log.py): docs/team/uzair.md §1,
step 4a. What leaks is the canary's job (test_logging_canary.py); this is how lines look and what they carry."""
import asyncio
import io
import json
import logging
from contextlib import contextmanager

import pytest
from fastapi.testclient import TestClient

import backend.main  # noqa: F401  configures logging, as the running app does
import backend.models.db as db_mod
from backend import logging_setup
from backend.logging_setup import REDACTED, installed_handler, redact


@pytest.fixture
def log():
    handler = installed_handler()
    buffer = io.StringIO()
    previous_stream = handler.setStream(buffer)
    root = logging.getLogger()
    previous_level = root.level
    root.setLevel(logging.INFO)
    try:
        yield buffer
    finally:
        handler.setStream(previous_stream)
        root.setLevel(previous_level)


@pytest.fixture
def json_log(monkeypatch, log):
    monkeypatch.setenv("LOG_FORMAT", "json")
    handler = logging_setup.configure_logging()
    handler.setStream(log)
    yield log
    monkeypatch.delenv("LOG_FORMAT")
    logging_setup.configure_logging()


def _lines(buffer, logger_name=None):
    return [line for line in buffer.getvalue().splitlines() if logger_name is None or f" {logger_name} " in line]


def _access(buffer):
    return [line for line in _lines(buffer, "benchq.request") if "Unhandled error" not in line]


@contextmanager
def _route_session(make):
    from backend.main import app
    previous = app.dependency_overrides.get(db_mod.get_db)
    app.dependency_overrides[db_mod.get_db] = make
    try:
        yield
    finally:
        app.dependency_overrides[db_mod.get_db] = previous


# ── Masking ──────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("raw, kept, gone", [
    ("Polling inbox for fatima@hyderabad-tech-staffing.benchq.test", "f***@***.test", "fatima"),
    ("Authorization: Bearer abc.def-ghi", "Authorization:", "abc.def-ghi"),
    ("sent Bearer abc.def-ghi upstream", "Bearer [redacted] upstream", "abc.def-ghi"),
    ("jwt eyJhbGciOi.eyJzdWIiOiIx.c2lnbmF0dXJl here", "here", "eyJhbGciOi"),
    ("key sk-or-v1-0123456789abcdef in use", "in use", "0123456789abcdef"),
    ("password=hunter22 token: s3cret&x=1", "password=", "hunter22"),
    ('{"refresh_token": "1//0gAbC", "ok": 1}', '"ok": 1', "1//0gAbC"),
    ("link Xk3v9Qm2pL7nB4cR8tY6wE1uI5oA0sDfGhJkLzXc sent", "link", "Xk3v9Qm2pL7nB4cR8tY6wE1uI5oA0sDfGhJkLzXc"),
    ('DETAIL:  Key (email)=(a@b.co) already exists.\n[SQL: INSERT …]', "[SQL: INSERT …]", "Key (email)"),
    ("[parameters: {'name': 'Ravi'}]", "[parameters:", "Ravi"),
    ("input_value='Ravi Teja', input_type=str]", "input_type=str", "Ravi Teja"),
    ('Failed: (psycopg.errors.InvalidTextRepresentation) invalid input syntax for type integer: "Ravi Teja"',
     "invalid input syntax for type integer:", "Ravi Teja"),
    ('invalid input value for enum status: "Ravi Teja"\nLINE 1: SELECT', "LINE 1:", "Ravi Teja"),
    ("invalid input syntax for type integer: \"x\"\nLINE 1: SELECT CAST('Ravi Teja' AS integer)\n        ^",
     "LINE 1: [redacted]", "Ravi Teja"),
    ("call 555-013-7799 today", "call", "013-7799"),
    ("call +1 (555) 013-7799 today", "today", "013-7799"),
    ("ph +91 98765 43210.", "ph", "98765"),
    ("ph 9876543210", "ph", "9876543210"),
])
def test_what_looks_secret_or_personal_is_masked(raw, kept, gone):
    masked = redact(raw)
    assert kept in masked and gone not in masked and (REDACTED in masked or "***" in masked)


def test_ids_and_ordinary_words_are_kept():
    line = ("job 9a02c4be-1f3e-4b7a-9c1d-2e5f6a7b8c9d scored by test_scheduled_work_gets_the_background_limit in "
            "/api/firms/{firm_id}/candidates; run 9a02c4be1f3e4b7a9c1d2e5f6a7b8c9d done")
    assert redact(line) == line


def test_a_sha256_hash_is_still_masked():
    digest = "9a02c4be1f3e4b7a9c1d2e5f6a7b8c9d" * 2               # 64 hex characters, like hashlib.sha256().hexdigest()
    assert redact(f"key {digest} locked") == f"key {REDACTED} locked"


@pytest.mark.parametrize("line", [
    "next run at: 2026-11-03 13:19:48 UTC, missed by 0:22:48.885146",
    "GET /api/notifications 200 24ms",
    "peer 192.168.1.20, cost 0.0012345678, took 1054.81s, version 2.2.0, size 10485760, years 2019-2024",
])
def test_dates_times_addresses_and_numbers_are_not_taken_for_phones(line):
    assert redact(line) == line


def test_a_database_error_names_its_type_code_and_statement_not_its_values(test_db):
    from sqlalchemy import text
    from sqlalchemy.exc import IntegrityError
    test_db.execute(text("CREATE TEMP TABLE t (v text UNIQUE)"))
    name = " ".join(["Ravi", "Teja"])                     # not written out: a traceback quotes the line of code
    with pytest.raises(IntegrityError) as caught:
        test_db.execute(text("INSERT INTO t VALUES (:v), (:v)"), {"v": name})
    assert "Ravi Teja" in str(caught.value)                  # Postgres repeats it in DETAIL
    formatted = logging_setup.format_exception(caught.value)
    assert "UniqueViolation SQLSTATE 23505 on: INSERT INTO t VALUES" in formatted
    assert "Ravi Teja" not in formatted and "Traceback (most recent call last)" in formatted


def test_a_validation_error_keeps_where_and_why_not_the_input():
    from pydantic import BaseModel, ValidationError

    class Candidate(BaseModel):
        years: int

    name = " ".join(["Ravi", "Teja"])
    with pytest.raises(ValidationError) as caught:
        Candidate.model_validate({"years": name})
    formatted = logging_setup.format_exception(caught.value)
    assert "1 validation error(s) for Candidate: years:" in formatted and "Ravi Teja" not in formatted


# ── The two formats ──────────────────────────────────────────────────────────

def test_text_lines_read_left_to_right(log):
    logging.getLogger("jobnavigator.test").warning("Scrape done: %d jobs", 214)
    (line,) = _lines(log)
    assert line.split(" ", 2)[2] == "WARNING jobnavigator.test  Scrape done: 214 jobs"


def test_json_lines_are_one_object_each(json_log):
    logging.getLogger("jobnavigator.test").info("Scrape done: %d jobs", 214)
    try:
        raise ValueError("bad row")
    except ValueError:
        logging.getLogger("jobnavigator.test").exception("It broke")
    first, second = (json.loads(line) for line in json_log.getvalue().splitlines())
    assert (first["level"], first["logger"], first["message"]) == ("INFO", "jobnavigator.test", "Scrape done: 214 jobs")
    assert first["time"].endswith("+00:00")
    assert second["message"] == "It broke" and "ValueError: bad row" in second["exc_info"]


def test_production_logs_json_by_default(monkeypatch):
    import backend.config
    monkeypatch.setattr(backend.config, "IS_PRODUCTION", True)
    try:
        assert isinstance(logging_setup.configure_logging().formatter, logging_setup.JsonFormatter)
    finally:
        monkeypatch.setattr(backend.config, "IS_PRODUCTION", False)
        logging_setup.configure_logging()


def test_configuring_twice_leaves_one_handler_and_other_handlers_alone():
    other = logging.NullHandler()
    logging.getLogger().addHandler(other)
    try:
        logging_setup.configure_logging()
        logging_setup.configure_logging()
        ours = [h for h in logging.getLogger().handlers if h is installed_handler()]
        assert len(ours) == 1 and other in logging.getLogger().handlers
    finally:
        logging.getLogger().removeHandler(other)


def test_libraries_go_through_the_same_handler_and_sqlalchemy_never_logs_rows():
    assert logging.getLogger("uvicorn.error").handlers == [] and logging.getLogger("uvicorn.error").propagate
    assert logging.getLogger("uvicorn.access").disabled
    assert logging.getLogger("sqlalchemy.engine").getEffectiveLevel() == logging.WARNING
    assert db_mod.engine.hide_parameters


# ── The request log ──────────────────────────────────────────────────────────

def test_every_request_gets_one_access_line_and_an_id(api_client, accounts, log):
    r = api_client.get("/api/auth/me")
    rid = r.headers["X-Request-ID"]
    (line,) = _access(log)
    assert f"GET /api/auth/me 200 " in line
    assert f"req={rid}" in line and f"user_id={accounts.user_id}" in line and f"firm_id={accounts.firm_id}" in line


def test_the_access_line_names_the_route_pattern_not_the_path(anonymous_client, log):
    anonymous_client.get("/api/invites/Xk3v9Qm2pL7nB4cR8tY6wE1uI5oA0sDfGhJkLzXc")
    anonymous_client.get("/nowhere/at/all")
    first, second = _access(log)
    assert "GET /api/invites/{token} " in first and "Xk3v9" not in log.getvalue()
    assert "GET (no route) 404" in second


def test_access_reuses_the_request_logs_route_lookup(api_client, monkeypatch):
    import backend.auth.access as access
    calls = []
    real = access.route_key
    monkeypatch.setattr(access, "route_key", lambda app, request: calls.append(1) or real(app, request))
    assert api_client.get("/api/auth/me").status_code == 200
    assert calls == []                                       # enforce used the request log's lookup


def test_a_saved_route_for_another_path_is_ignored():
    from starlette.requests import Request

    import backend.auth.access as access
    from backend.main import app
    scope = {"type": "http", "method": "GET", "path": "/api/auth/me", "headers": [], "query_string": b"", "app": app,
             "state": {access.SAVED_ROUTE: ("GET", "/api/invites/abc", "GET /api/invites/{token}")}}
    assert access._request_route_key(Request(scope)) == "GET /api/auth/me"


@pytest.mark.asyncio
async def test_a_client_that_left_before_the_answer_is_499_not_500(log):
    from backend.request_log import RequestLog

    async def _receive():
        return {"type": "http.disconnect"}

    async def _send(message):
        pass

    async def _gone(scope, receive, send):         # the client disconnected: the server stops without answering
        raise asyncio.CancelledError

    async def _broken(scope, receive, send):
        raise RuntimeError("boom")

    scope = {"type": "http", "method": "GET", "path": "/x", "headers": []}
    with pytest.raises(asyncio.CancelledError):
        await RequestLog(_gone)(dict(scope), _receive, _send)
    with pytest.raises(RuntimeError):
        await RequestLog(_broken)(dict(scope), _receive, _send)
    gone, broken = _access(log)
    assert "GET (no route) 499 " in gone
    assert "GET (no route) 500 " in broken


def test_a_refusal_before_the_route_is_logged_too(anonymous_client, accounts, log):
    anonymous_client.get(f"/api/firms/{accounts.firm_id}/candidates")
    (line,) = _access(log)
    assert f"GET /api/firms/{{firm_id}}/candidates 401" in line and "user_id" not in line


def test_a_safe_incoming_id_is_kept_and_anything_else_replaced(api_client):
    assert api_client.get("/api/auth/me", headers={"X-Request-ID": "next-7f3a_9c"}).headers["X-Request-ID"] == \
        "next-7f3a_9c"
    for unsafe in ("a b", "x" * 65, "<script>"):
        assert api_client.get("/api/auth/me", headers={"X-Request-ID": unsafe}).headers["X-Request-ID"] != unsafe


def test_lines_written_during_a_request_carry_its_id(api_client, log):
    r = api_client.post("/api/auth/sign-out", headers={"origin": "https://elsewhere.example"})
    refused = [line for line in _lines(log) if "refused cross-origin" in line]
    assert r.status_code == 403 and refused and f"req={r.headers['X-Request-ID']}" in refused[0]


def test_health_is_logged_at_debug_only(anonymous_client, log):
    anonymous_client.get("/health")
    assert _access(log) == []
    logging.getLogger().setLevel(logging.DEBUG)
    anonymous_client.get("/health")
    assert "GET /health 200" in _access(log)[0]


def test_a_super_admin_in_a_support_view_is_logged_with_the_firm_it_reads():
    import uuid

    from backend.auth.sessions import Principal
    from backend.request_log import _who
    admin, firm = uuid.uuid4(), uuid.uuid4()
    principal = Principal(kind="platform", user_id=admin, session_id=uuid.uuid4(), role="PLATFORM_ADMIN",
                          support_view_id=uuid.uuid4(), support_firm_id=firm)
    assert _who({"state": {"principal": principal}}) == {"user_id": str(admin), "support_firm_id": str(firm)}
    assert _who({"state": {}}) == {}


def test_an_unexpected_error_is_logged_once_with_its_id_and_answers_plain_500(api_client, accounts, log):
    from backend.main import app

    def _broken():
        raise KeyError("skills")
        yield  # pragma: no cover

    with TestClient(app, raise_server_exceptions=False) as client, _route_session(_broken):
        r = client.get("/api/auth/me", headers={"cookie": f"bq_session={accounts.firm_token}"})
    assert (r.status_code, r.text) == (500, "Internal Server Error")
    rid = r.headers["X-Request-ID"]
    errors = [line for line in _lines(log) if "Unhandled error" in line]
    assert len(errors) == 1 and f"req={rid}" in errors[0]
    assert "KeyError: 'skills'" in log.getvalue()
    assert f"GET /api/auth/me 500" in _access(log)[0]


def test_uvicorns_copy_of_an_error_already_logged_is_dropped(log):
    error = RuntimeError("boom")
    setattr(error, logging_setup.LOGGED_MARK, True)
    logging.getLogger("uvicorn.error").error("Exception in ASGI application\n", exc_info=error)
    logging.getLogger("uvicorn.error").error("Something else", exc_info=RuntimeError("other"))
    assert "Exception in ASGI application" not in log.getvalue() and "Something else" in log.getvalue()


# ── Background runs ──────────────────────────────────────────────────────────

async def test_a_launched_run_carries_its_run_id_and_the_request_that_started_it(test_db, log):
    from backend.job_monitor import launch_background
    from backend.logging_setup import request_id
    done = asyncio.Event()

    async def _work():
        logging.getLogger("jobnavigator.test").info("working")
        done.set()

    token = request_id.set("req-123")
    try:
        run_id = launch_background("logging_test", _work)
    finally:
        request_id.reset(token)
    await asyncio.wait_for(done.wait(), 5)
    (line,) = [line for line in _lines(log) if "working" in line]
    assert f"run={run_id}" in line and "req=req-123" in line


async def test_a_scheduled_run_carries_its_run_id_and_no_request(test_db, log):
    from backend.job_monitor import tracked_run
    from backend.logging_setup import request_id, run_id

    token = request_id.set("req-from-settings")              # the scheduler woken from PATCH /api/settings
    try:
        async with tracked_run("logging_test", "scheduler") as run:
            logging.getLogger("jobnavigator.test").info("scheduled work")
        assert (request_id.get(), run_id.get()) == ("req-from-settings", None)
    finally:
        request_id.reset(token)
    (line,) = [line for line in _lines(log) if "scheduled work" in line]
    assert f"run={run.run_id}" in line and "req=" not in line
