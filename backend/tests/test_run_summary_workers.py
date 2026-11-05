"""Every background job type's worker must return a summary string for JobRun.result_summary (free-form; that it exists is what's pinned)."""
import pytest

from backend.models.db import Company, Job, Search, Setting
from backend.models.tenancy import DEFAULT_FIRM_ID
from backend.tests.resume_support import make_version

pytestmark = pytest.mark.usefixtures("jobs_in_default_firm")


@pytest.mark.asyncio
async def test_score_single_job_returns_summary(test_db, monkeypatch):
    import backend.analyzer.cv_scorer as scorer

    job = Job(company="Acme", title="Staff PM", url="https://acme.test/1",
              external_id="e1", description="Long job description " * 20, status="new")
    resume = make_version(test_db, DEFAULT_FIRM_ID, full_name="PM", summary="x " * 60)
    test_db.add(job)
    test_db.commit()

    async def fake_score(job_obj, cv_texts, db=None, depth="full", preloaded_text=None):
        return {"scores": {"Test candidate": 84}, "best_cv": "Test candidate"}

    monkeypatch.setattr(scorer, "score_job_sync", fake_score)

    summary = await scorer.score_single_job(str(job.id), cv_ids=[str(resume.id)], depth="light", firm_id=DEFAULT_FIRM_ID)
    assert isinstance(summary, str) and summary
    assert "Staff PM" in summary and "84" in summary and "light" in summary


@pytest.mark.asyncio
async def test_score_single_job_summarises_a_no_op(test_db, monkeypatch):
    """Even the early exits say why nothing happened, instead of a blank cell."""
    import uuid
    import backend.analyzer.cv_scorer as scorer

    summary = await scorer.score_single_job(str(uuid.uuid4()), firm_id=DEFAULT_FIRM_ID)
    assert summary == "Job not found"


@pytest.mark.asyncio
async def test_search_run_worker_returns_counts(test_db, monkeypatch):
    import backend.api.routes_searches as rs
    import backend.scraper.orchestrator as orch

    search = Search(firm_id=DEFAULT_FIRM_ID, name="Remote PM", search_mode="keyword", active=True)
    test_db.add(search)
    test_db.commit()

    async def fake_run(search_id, auto_score=None):
        return {"jobs_found": 12, "new_jobs": 4, "error": None, "duration": 3.0}

    monkeypatch.setattr(orch, "_run_search_by_id", fake_run)

    captured = {}

    def fake_launch(job_type, coro_func, **kw):
        captured["coro"] = coro_func
        return "run-1"

    monkeypatch.setattr("backend.job_monitor.launch_background", fake_launch)

    resp = await rs.trigger_search(str(search.id), db=test_db)
    assert resp["status"] == "running"

    summary = await captured["coro"]()
    assert summary == "Remote PM - 12 seen, +4 new"


@pytest.mark.asyncio
async def test_company_scrape_worker_still_returns_counts(test_db, monkeypatch):
    """The one job type that already had a summary keeps it."""
    pytest.importorskip("apscheduler")
    import backend.main as main_mod
    import backend.scraper.sources.company_pages as cp

    c = Company(name="Acme", active=True, playwright_enabled=True,
                scrape_urls=["https://jobs.lever.co/acme"], auto_scoring_depth="off")
    test_db.add(c)
    test_db.commit()

    async def fake_scrape(company, **kw):
        return {"jobs_found": 9, "new_jobs": 2, "duration": 1.0}

    monkeypatch.setattr(cp, "scrape_single_career_page", fake_scrape)

    captured = {}

    def fake_launch(job_type, coro_func, **kw):
        captured["coro"] = coro_func
        return "run-2"

    monkeypatch.setattr(main_mod, "launch_background", fake_launch)
    await main_mod.trigger_company_scrape(str(c.id))
    assert await captured["coro"]() == "Acme - 9 seen, +2 new"


# The score-check and tailor workers went with the old /api/resumes router (résumé versioning PR 6); the tailoring
# module rebuilds them.
