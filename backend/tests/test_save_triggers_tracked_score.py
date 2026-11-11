"""Saving a job triggers scoring as a TRACKED op (launch_background) so dashboard monitors/toasts can see it, but only when on_save_action enables it and the job isn't already scored."""
import uuid
import pytest
from backend.models.db import Setting, Job

pytestmark = pytest.mark.usefixtures("jobs_in_default_firm")


def _seed(test_db, on_save="light"):
    test_db.add(Setting(key="on_save_action", value=on_save))
    test_db.commit()


def _job(test_db, cv_scores=None):
    j = Job(id=uuid.uuid4(), external_id=uuid.uuid4().hex, company="Acme", title="PM",
            status="new", saved=False, cv_scores=cv_scores)
    test_db.add(j)
    test_db.commit()
    return j


@pytest.fixture(autouse=True)
def _noop_scorer(monkeypatch):
    async def _noop(*a, **k):
        return None
    monkeypatch.setattr("backend.analyzer.cv_scorer.score_single_job", _noop, raising=True)


def _capture_launch(monkeypatch):
    calls = []
    monkeypatch.setattr("backend.api.routes_jobs.launch_background",
                        lambda *a, **k: calls.append((a, k)) or "run-x", raising=True)
    return calls


def test_update_job_is_async():
    """launch_background() needs a running event loop, so the PATCH handler must stay `async def` — a sync endpoint runs in a threadpool with no loop and the scoring task silently fails to register."""
    import inspect
    from backend.api.routes_jobs import update_job
    assert inspect.iscoroutinefunction(update_job), "update_job must be `async def`"


