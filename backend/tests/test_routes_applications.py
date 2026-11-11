"""Tests for /api/applications endpoints: status transitions and the list's filter.

Logging a job with no candidate (with its URL dedup, company auto-create and JD fetch) is retired since applications
moved onto job_postings (2026-11-11); adding a job for a candidate is test_applications_on_postings.py's."""
import pytest

# Bound at import time, before the autouse fixture below replaces the module attribute.
from backend.api.routes_applications import (
    _fetch_and_store_description as real_fetch_and_store_description,
)

pytestmark = pytest.mark.usefixtures("jobs_in_default_firm")


@pytest.fixture(autouse=True)
def _stub_background_tasks(monkeypatch):
    """Stub slow / network-hitting background work so tests are fast + isolated."""
    # _cache_job_page is what the route schedules in background; no-op it so tests don't hit the network.
    async def _noop_cache(*a, **kw):
        return None
    monkeypatch.setattr(
        "backend.api.routes_applications._cache_job_page",
        _noop_cache,
        raising=False,
    )
    # _fetch_and_store_description is the second task the route schedules.
    monkeypatch.setattr(
        "backend.api.routes_applications._fetch_and_store_description",
        _noop_cache,
        raising=False,
    )

    # fetch_h1b_for_company_id — scheduled when a new Company is auto-created.
    def _noop_h1b(*a, **kw):
        return None
    monkeypatch.setattr(
        "backend.analyzer.h1b_checker.fetch_h1b_for_company_id",
        _noop_h1b,
        raising=False,
    )


def _application(test_db, title):
    """A candidate's Applied application on a posting of theirs (every application is one since migration 0027)."""
    from backend.models.db import Application
    from backend.models.tenancy import DEFAULT_FIRM_ID
    from backend.tests.posting_support import posting_for
    from backend.tests.resume_support import make_version
    candidate_id = make_version(test_db, DEFAULT_FIRM_ID).candidate_id
    posting = posting_for(test_db, DEFAULT_FIRM_ID, candidate_id, title=title, company="Acme", url="https://x.com/1")
    app = Application(firm_id=DEFAULT_FIRM_ID, candidate_id=candidate_id, job_id=posting.id, status="applied")
    test_db.add(app)
    test_db.commit()
    return app


def test_patch_application_status_records_transition(api_client, test_db):
    """PATCH status → Application.status_transitions has an entry with source='ui'."""
    aid = _application(test_db, "Senior PM").id

    resp = api_client.patch(f"/api/applications/{aid}", json={"status": "interview_scheduled", "expected_revision": 0})
    assert resp.status_code == 200, resp.text

    from backend.models.db import Application
    test_db.expire_all()
    app = test_db.query(Application).filter(Application.id == aid).first()
    assert app is not None
    assert app.status == "interview_scheduled"
    assert any(
        t.get("to") == "interview_scheduled" and t.get("source") == "ui"
        for t in (app.status_transitions or [])
    ), f"Expected ui-sourced transition to interview_scheduled, got: {app.status_transitions}"


def test_list_applications_filters_by_status(api_client, test_db):
    """GET /api/applications?status=move_on returns only the applications moved on."""
    _application(test_db, "PM1")
    a2 = _application(test_db, "PM2")
    moved = api_client.patch(f"/api/applications/{a2.id}", json={"status": "move_on", "expected_revision": 0})
    assert moved.status_code == 200, moved.text

    resp = api_client.get("/api/applications?status=move_on")
    assert resp.status_code == 200
    data = resp.json()
    # Response shape: {"total": N, "applications": [...]}
    apps = data.get("applications") if isinstance(data, dict) else data
    assert apps is not None, f"Unexpected response shape: {data}"
    titles = [a.get("title") for a in apps]
    assert "PM2" in titles, f"Expected PM2 in the moved-on list, got titles: {titles}"
    assert "PM1" not in titles, f"PM1 should not be in the moved-on list, got titles: {titles}"


@pytest.mark.asyncio
async def test_fetch_and_store_description_writes_the_job(test_db, monkeypatch):
    """The task delegates to the tailoring resolver, which persists the fetched text."""
    import uuid
    from backend.models.db import Job

    job = Job(id=uuid.uuid4(), external_id=uuid.uuid4().hex, company="Acme",
              title="Senior PM", url="https://acme.com/jobs/9", status="applied")
    test_db.add(job)
    test_db.commit()

    async def fake_fetch(url):
        return "Clean ATS JD for a Senior PM."

    monkeypatch.setattr("backend.scraper.ats._descriptions._fetch_job_description", fake_fetch)
    await real_fetch_and_store_description(str(job.id), job.url)

    test_db.expire_all()
    assert test_db.query(Job).filter(Job.id == job.id).first().description == "Clean ATS JD for a Senior PM."
