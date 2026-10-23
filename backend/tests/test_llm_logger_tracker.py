"""Tests for track_llm_call async context manager."""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

pytestmark = pytest.mark.usefixtures("jobs_in_default_firm")


@pytest.fixture
def test_db(monkeypatch):
    from backend.models.db import Base, LlmCallLog
    from backend.models.db import engine   # the Postgres test database (tests/conftest.py)
    Session = sessionmaker(bind=engine)
    import backend.analyzer.llm_logger as llm_logger
    monkeypatch.setattr(llm_logger, "SessionLocal", Session)
    session = Session()
    yield session
    session.close()


@pytest.mark.asyncio
async def test_track_llm_call_logs_success(test_db):
    """Successful path: usage captured, success=True persisted."""
    from backend.analyzer.llm_logger import track_llm_call
    from backend.models.db import LlmCallLog

    async with track_llm_call("email", "claude_api", "claude-sonnet-4-6") as tracker:
        tracker.usage = {"input_tokens": 500, "output_tokens": 50,
                         "cache_read_tokens": 0, "cache_write_tokens": 0}

    row = test_db.query(LlmCallLog).first()
    assert row is not None
    assert row.purpose == "email"
    assert row.provider == "claude_api"
    assert row.input_tokens == 500
    assert row.output_tokens == 50
    assert row.success is True
    assert row.error is None


@pytest.mark.asyncio
async def test_track_llm_call_logs_failure(test_db):
    """Exception path: success=False + error stored, exception re-raised."""
    from backend.analyzer.llm_logger import track_llm_call
    from backend.models.db import LlmCallLog

    with pytest.raises(RuntimeError, match="boom"):
        async with track_llm_call("tailor", "claude_api", "claude-sonnet-4-6") as tracker:
            raise RuntimeError("boom")

    row = test_db.query(LlmCallLog).first()
    assert row is not None
    assert row.purpose == "tailor"
    assert row.success is False
    assert "boom" in row.error


@pytest.mark.asyncio
async def test_track_llm_call_job_id(test_db):
    """job_id is forwarded to the log row when provided."""
    import uuid
    from backend.analyzer.llm_logger import track_llm_call
    from backend.models.db import LlmCallLog

    from backend.tests.r4_support import make_job
    jid = uuid.uuid4()
    make_job(test_db, id=jid)   # llm_call_log.job_id is a real foreign key on Postgres
    async with track_llm_call("score_full", "claude_api", "claude-sonnet-4-6", job_id=jid) as tracker:
        tracker.usage = {"input_tokens": 100, "output_tokens": 10,
                         "cache_read_tokens": 0, "cache_write_tokens": 0}

    row = test_db.query(LlmCallLog).first()
    assert row.job_id == jid
