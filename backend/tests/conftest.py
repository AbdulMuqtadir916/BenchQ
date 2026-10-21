"""Pytest fixtures for JobNavigator tests."""
import os
import pytest
import pytest_asyncio
from unittest.mock import AsyncMock, MagicMock

# The tests run on Postgres (docs/integration/07, F1): `docker compose up -d db-test`. DATABASE_URL is
# forced to the test database before any import creates the engine, and the name must end in _test so a
# test run can never truncate a real database.
TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL", "postgresql://jobnavigator:password@localhost:5433/jobnavigator_test"
)
if not TEST_DATABASE_URL.split("?")[0].endswith("_test"):
    raise RuntimeError(f"TEST_DATABASE_URL must name a database ending in _test, got {TEST_DATABASE_URL!r}")
os.environ["DATABASE_URL"] = TEST_DATABASE_URL


# A bug SQLite hid and Postgres does not (found when the tests moved to Postgres, F1): the model declares
# tracer_links.token as VARCHAR(10), but routes_resumes._rewrite_urls_with_tracers mints
# secrets.token_urlsafe(8), which is 11 characters. On Postgres that insert fails with
# StringDataRightTruncation, so any résumé that needs a random tracer token errors in production.
# Fixing it is a behaviour change (widen the column in a new Alembic revision); until the backend
# owner decides, these tests are strict expected failures, so fixing the bug makes them XPASS and
# forces this list to be deleted.
_TRACER_TOKEN_TOO_LONG = {
    "backend/tests/test_tracer_token_collision.py::test_two_jobless_resumes_with_the_same_stubs",
    "backend/tests/test_tracer_token_collision.py::test_second_owner_still_gets_working_links",
    "backend/tests/test_tracer_token_collision.py::test_disabled_and_styles_never_raise[path]",
    "backend/tests/test_tracer_token_collision.py::test_disabled_and_styles_never_raise[param]",
    "backend/tests/test_routes_cover_letters.py::test_base_resume_without_stub_stays_random",
    "backend/tests/test_r4_t5.py::test_random_tokens_come_from_secrets",
    "backend/tests/test_r4_t5.py::test_random_tokens_are_long_and_unguessable",
    "backend/tests/test_r4_t5.py::test_a_web_url_still_gets_a_tracer",
    "backend/tests/test_preview_tracer_rewrite.py::test_preview_then_pdf_mints_no_extra_links",
    "backend/tests/test_preview_tracer_rewrite.py::test_preview_serves_the_tracked_urls",
    "backend/tests/test_preview_tracer_rewrite.py::test_preview_and_pdf_carry_the_same_tokens",
}


def pytest_collection_modifyitems(config, items):
    for item in items:
        if item.nodeid in _TRACER_TOKEN_TOO_LONG:
            item.add_marker(pytest.mark.xfail(
                strict=True, reason="tracer_links.token is VARCHAR(10) but 11-char tokens are minted (see conftest)"))


def pytest_configure(config):
    """Register markers here too — the container runs pytest from /app, where the
    repo's pytest.ini is not mounted."""
    config.addinivalue_line(
        "markers",
        "live: hits the running stack over HTTP (read-only); auto-skips when unreachable",
    )


@pytest.fixture(autouse=True)
def _clean_auth_throttle():
    """The per-IP auth failure counter (R4-T5-06) is process-global by design, so a test
    that posts wrong keys would otherwise lock out the tests that follow it."""
    import sys

    def _reset():
        mod = sys.modules.get("backend.main")
        if mod is not None:
            mod._reset_auth_throttle()

    _reset()
    yield
    _reset()


# ── Anthropic mock fixtures ───────────────────────────────────────────────

@pytest.fixture
def mock_anthropic_response():
    """Factory for a fake anthropic.messages.create response."""
    def _make(text: str = '{"scores":{"CV":75},"best_cv":"CV"}',
              input_tokens: int = 1000,
              output_tokens: int = 50,
              cache_read: int = 0,
              cache_write: int = 0):
        resp = MagicMock()
        resp.content = [MagicMock(type="text", text=text)]
        resp.usage = MagicMock(
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cache_read_input_tokens=cache_read,
            cache_creation_input_tokens=cache_write,
        )
        return resp
    return _make


@pytest.fixture
def mock_anthropic_client(mock_anthropic_response, monkeypatch):
    """Replace anthropic.AsyncAnthropic with a mock that returns a canned response."""
    client = MagicMock()
    client.messages.create = AsyncMock(return_value=mock_anthropic_response())

    def _fake_ctor(*args, **kwargs):
        return client

    import anthropic
    monkeypatch.setattr(anthropic, "AsyncAnthropic", _fake_ctor)
    return client


# ── DB + TestClient fixtures ─────────────────────────────────────────────

@pytest.fixture(scope="session", autouse=True)
def _schema():
    """Build the schema once per run, the way production does: `alembic upgrade head` on an empty database."""
    from sqlalchemy import create_engine, text
    from sqlalchemy.pool import NullPool
    from backend.db_schema import upgrade_database

    engine = create_engine(TEST_DATABASE_URL, poolclass=NullPool)
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA IF EXISTS public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
    engine.dispose()
    upgrade_database()
    yield


@pytest.fixture(autouse=True)
def _clean_db(_schema):
    """Every test starts from empty tables. Runs for all tests, so one that touches SessionLocal
    without asking for test_db still cannot see another test's rows."""
    from sqlalchemy import text
    from sqlalchemy.orm import close_all_sessions
    import backend.models.db as db_mod

    def _truncate():
        db_mod.engine.dispose()           # drops connections a failed test left mid-transaction
        with db_mod.engine.begin() as conn:
            conn.execute(text("SET LOCAL lock_timeout = '10s'"))
            names = [r[0] for r in conn.execute(text(
                "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'alembic_version'"))]
            conn.execute(text("TRUNCATE " + ", ".join(f'"{n}"' for n in names) + " RESTART IDENTITY CASCADE"))
            conn.execute(text("ALTER SEQUENCE jobs_short_id_seq RESTART"))

    _truncate()
    yield
    close_all_sessions()


@pytest.fixture
def add_legacy_h1b_columns(test_db):
    """Returns a function that adds the old companies.h1b_* columns (a database from before visa_cache).
    The schema is built once per run, so they are always dropped again afterwards."""
    from sqlalchemy import text
    cols = [("h1b_lca_count", "INTEGER"), ("h1b_approval_rate", "DOUBLE PRECISION"),
            ("h1b_median_salary", "INTEGER"), ("h1b_last_checked", "TIMESTAMPTZ")]

    def _add():
        for col, typ in cols:
            test_db.execute(text(f"ALTER TABLE companies ADD COLUMN IF NOT EXISTS {col} {typ}"))
        test_db.commit()

    yield _add
    test_db.rollback()
    import backend.models.db as db_mod
    with db_mod.engine.begin() as conn:   # own connection: a test may have patched test_db.execute
        for col, _ in cols:
            conn.execute(text(f"ALTER TABLE companies DROP COLUMN IF EXISTS {col}"))


@pytest.fixture
def test_db():
    """A session on the Postgres test database (tables are emptied around every test by _clean_db)."""
    import backend.models.db as db_mod

    session = db_mod.SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def api_client(test_db, monkeypatch):
    """FastAPI TestClient for endpoint tests; test_db already rebound SessionLocal, so this only stubs lifespan deps and the scheduler."""
    from fastapi.testclient import TestClient

    # Pre-import backend.main + heavy modules so lazy imports capture bindings before monkeypatches.
    import backend.main  # noqa: F401
    import backend.scraper.sources.linkedin_extension  # noqa: F401

    # Stub the lifespan dependencies so TestClient startup is a no-op.
    import backend.main as main_mod
    monkeypatch.setattr(main_mod, "check_schema_at_head", lambda: None)
    monkeypatch.setattr(main_mod, "run_seeds", lambda: None)
    monkeypatch.setattr(main_mod, "cleanup_stale_runs", lambda: None)
    # Prevent the real scheduler from booting.
    import backend.scheduler as sched_mod
    monkeypatch.setattr(sched_mod, "configure_scheduler", lambda: None)
    fake_scheduler = MagicMock()
    fake_scheduler.start = MagicMock()
    fake_scheduler.shutdown = MagicMock()
    monkeypatch.setattr(sched_mod, "scheduler", fake_scheduler)

    # Override get_db so route handlers share the test DB session.
    import backend.models.db as db_mod

    def override_get_db():
        s = db_mod.SessionLocal()
        try:
            yield s
        finally:
            s.close()

    from backend.main import app
    from backend.models.db import get_db
    app.dependency_overrides[get_db] = override_get_db

    try:
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides.pop(get_db, None)


# ── httpx + Telegram mock fixtures ───────────────────────────────────────

@pytest.fixture
def mock_httpx(monkeypatch):
    """Replace httpx.AsyncClient with a MagicMock returning a canned response; returns {"client", "response"} for inspection."""
    resp = MagicMock()
    resp.status_code = 200
    resp.json = MagicMock(return_value={})
    resp.text = ""
    resp.raise_for_status = MagicMock()

    client = MagicMock()
    client.get = AsyncMock(return_value=resp)
    client.post = AsyncMock(return_value=resp)
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=False)

    import httpx
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: client)
    return {"client": client, "response": resp}


@pytest.fixture
def mock_telegram(monkeypatch):
    """Replace the Telegram notifier's httpx call with a recorder; returns a list of {"url", "json"} dicts."""
    sent = []

    async def fake_post(url, json=None, **kwargs):
        sent.append({"url": url, "json": json})
        resp = MagicMock()
        resp.status_code = 200
        resp.json = MagicMock(return_value={"ok": True})
        resp.raise_for_status = MagicMock()
        return resp

    client = MagicMock()
    client.post = AsyncMock(side_effect=fake_post)
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=False)

    import httpx
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: client)
    return sent
