"""Every background job type's worker must return a summary string for JobRun.result_summary (free-form; that it exists is what's pinned)."""
import pytest

from backend.models.db import Job
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


# The old pool's search run and company scrape workers were only reached through their triggers, which answer 410 since
# job search PR 2 (backend/job_search/retired.py); their tests went with them, and the workers go in the clean-up PR.
# The score-check and tailor workers went with the old /api/resumes router (résumé versioning PR 6); the tailoring
# module rebuilds them.
