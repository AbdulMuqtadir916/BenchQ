"""Tests for POST /api/jobs/linkedin-import — ensures JobRun tracking."""
import pytest


def test_linkedin_import_empty_ids(api_client, test_db):
    """Empty list -> 200 with accepted=0; no background task dispatched."""
    resp = api_client.post("/api/jobs/linkedin-import", json={"linkedin_ids": []})
    assert resp.status_code == 200
    data = resp.json()
    assert data.get("accepted") == 0


def test_linkedin_import_dispatches_via_launch_background(api_client, test_db, monkeypatch):
    """Non-empty IDs -> background task launched via launch_background, not bare create_task."""
    launched = []

    def fake_launch(job_type, coro_func, *args, **kwargs):
        launched.append({
            "job_type": job_type,
            "coro_func": coro_func,
            "args": args,
            "kwargs": kwargs,
        })
        # Don't actually run the coroutine factory.
        return "run-abc"

    # Patch launch_background at its source module (covers late-binding imports).
    monkeypatch.setattr("backend.job_monitor.launch_background", fake_launch, raising=True)
    # Also patch any name bound into routes_jobs at import time.
    import backend.api.routes_jobs as routes_jobs_mod
    if hasattr(routes_jobs_mod, "launch_background"):
        monkeypatch.setattr(routes_jobs_mod, "launch_background", fake_launch, raising=True)

    # Stub enrich so even if it somehow runs, it's a no-op.
    async def fake_enrich(ids, db=None):
        return {"imported": len(ids)}
    monkeypatch.setattr(
        "backend.scraper.sources.linkedin_extension.enrich",
        fake_enrich,
        raising=True,
    )

    resp = api_client.post("/api/jobs/linkedin-import", json={"linkedin_ids": ["111", "222"]})
    assert resp.status_code == 200
    assert len(launched) == 1, (
        f"Expected launch_background to be called once, got {len(launched)}"
    )
    assert launched[0]["job_type"] == "linkedin_import"


def test_linkedin_import_returns_run_id(api_client, test_db, monkeypatch):
    """Response should include run_id so callers can poll progress."""

    monkeypatch.setattr(
        "backend.job_monitor.launch_background",
        lambda *a, **kw: "run-xyz",
        raising=True,
    )
    import backend.api.routes_jobs as routes_jobs_mod
    if hasattr(routes_jobs_mod, "launch_background"):
        monkeypatch.setattr(
            routes_jobs_mod,
            "launch_background",
            lambda *a, **kw: "run-xyz",
            raising=True,
        )

    async def fake_enrich(ids, db=None):
        return None
    monkeypatch.setattr(
        "backend.scraper.sources.linkedin_extension.enrich",
        fake_enrich,
        raising=True,
    )

    resp = api_client.post("/api/jobs/linkedin-import", json={"linkedin_ids": ["333"]})
    assert resp.status_code == 200
    data = resp.json()
    assert data.get("run_id") == "run-xyz"
