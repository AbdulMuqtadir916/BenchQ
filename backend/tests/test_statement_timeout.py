"""Statement timeouts (backend/statement_timeout.py; docs/team/uzair.md §1, step 2b): 15 s per query inside a web
request, 1 minute in background work, and a query past its limit answers 503 with Retry-After."""
import asyncio
from contextlib import contextmanager

import pytest
from sqlalchemy import text
from sqlalchemy.exc import OperationalError, TimeoutError as PoolTimeout

import backend.main  # noqa: F401  installs the web limit on the engine, as the running app does
import backend.models.db as db_mod
from backend import statement_timeout
from backend.statement_timeout import BUSY

BUSY_BODY = {"detail": BUSY}


def _limit(db):
    return db.execute(text("SHOW statement_timeout")).scalar()


@contextmanager
def _route_session(make):
    """Serve the routes' `get_db` from `make` for the duration (conftest's own override comes back after)."""
    from backend.main import app
    previous = app.dependency_overrides.get(db_mod.get_db)
    app.dependency_overrides[db_mod.get_db] = make
    try:
        yield
    finally:
        app.dependency_overrides[db_mod.get_db] = previous


@contextmanager
def _in_web_request():
    token = statement_timeout._in_web_request.set(True)
    try:
        yield
    finally:
        statement_timeout._in_web_request.reset(token)


def _sleeping_session():
    db = db_mod.SessionLocal()
    try:
        db.execute(text("SELECT pg_sleep(1)"))
        yield db
    finally:
        db.close()


# ── The limits ───────────────────────────────────────────────────────────────

def test_a_web_requests_queries_get_15_seconds(api_client):
    seen = []

    def _recording_session():
        db = db_mod.SessionLocal()
        try:
            seen.append(_limit(db))
            yield db
        finally:
            db.close()

    with _route_session(_recording_session):
        assert api_client.get("/api/auth/me").status_code == 200
    assert seen == ["15s"]


def test_background_queries_get_1_minute(test_db):
    assert _limit(test_db) == "1min"


def test_the_web_limit_ends_with_its_transaction():
    with db_mod.engine.connect() as conn:
        with _in_web_request():
            with conn.begin():
                assert conn.execute(text("SHOW statement_timeout")).scalar() == "15s"
        with conn.begin():                                 # the same connection, its next user
            assert conn.execute(text("SHOW statement_timeout")).scalar() == "1min"


def test_opening_a_connection_gives_up_after_5_seconds():
    assert db_mod._engine_kwargs["connect_args"]["connect_timeout"] == 5


async def test_work_launched_from_a_request_gets_the_background_limit(test_db):
    from backend.job_monitor import launch_background
    seen = []

    async def _work():
        db = db_mod.SessionLocal()
        try:
            seen.append(_limit(db))
        finally:
            db.close()

    with _in_web_request():
        launch_background("statement_timeout_test", _work)
    for _ in range(100):
        if seen:
            break
        await asyncio.sleep(0.05)
    assert seen == ["1min"]


async def test_scheduled_work_gets_the_background_limit_even_from_a_request_context(test_db):
    from backend.job_monitor import tracked_run

    async def _scheduled():
        async with tracked_run("statement_timeout_test", "scheduler"):
            db = db_mod.SessionLocal()
            try:
                return _limit(db)
            finally:
                db.close()

    with _in_web_request():                                # e.g. the scheduler woken from PATCH /api/settings
        assert await asyncio.create_task(_scheduled()) == "1min"


# ── What a timed-out query answers ───────────────────────────────────────────

def test_a_route_query_past_the_limit_answers_503(api_client, monkeypatch):
    monkeypatch.setattr(statement_timeout, "WEB_STATEMENT_TIMEOUT", "200ms")
    with _route_session(_sleeping_session):
        r = api_client.get("/api/auth/me")
    assert r.status_code == 503
    assert r.headers.get("Retry-After") == "5"
    assert r.json() == BUSY_BODY                           # no SQL, no "database"


def test_a_session_check_past_the_limit_answers_503(api_client, monkeypatch):
    import backend.auth.access as access_mod

    def _slow_resolve(db, token):
        db.execute(text("SELECT pg_sleep(1)"))

    monkeypatch.setattr(statement_timeout, "WEB_STATEMENT_TIMEOUT", "200ms")
    monkeypatch.setattr(access_mod, "resolve", _slow_resolve)
    r = api_client.get("/api/auth/me")
    assert (r.status_code, r.headers.get("Retry-After"), r.json()) == (503, "5", BUSY_BODY)


def test_any_other_database_error_is_not_answered_as_busy(api_client):
    def _broken_session():
        raise OperationalError("SELECT 1", {}, Exception("server closed the connection unexpectedly"))
        yield  # pragma: no cover

    with _route_session(_broken_session), pytest.raises(OperationalError):
        api_client.get("/api/auth/me")


def test_a_drained_pool_answers_in_the_same_words(api_client):
    def _drained():
        raise PoolTimeout("QueuePool limit of size 20 overflow 10 reached")

    with _route_session(_drained):
        r = api_client.get("/api/auth/me")
    assert (r.status_code, r.headers.get("Retry-After"), r.json()) == (503, "5", BUSY_BODY)
