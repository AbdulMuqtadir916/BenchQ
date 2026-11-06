"""Activity Log PR 5 part 2: jobs and analysis write their entries."""
import pytest

from backend.models.db import Job
from backend.models.tenancy import ActivityEntry, FirmJob, User


def _entries(test_db, **filters):
    test_db.expire_all()
    return test_db.query(ActivityEntry).filter_by(**filters).order_by(ActivityEntry.created_at).all()


@pytest.fixture(autouse=True)
def _no_page_fetch(monkeypatch):
    async def nothing(*args, **kwargs):
        return None
    monkeypatch.setattr("backend.api.routes_applications._cache_job_page", nothing)
    monkeypatch.setattr("backend.api.routes_applications._fetch_and_store_description", nothing)


@pytest.fixture
def job(test_db, accounts):
    row = Job(external_id="activity-job", title="Data Engineer", company="Acme", url="https://jobs.example.test/1",
              source="manual", status="new")
    test_db.add(row)
    test_db.flush()
    test_db.add(FirmJob(firm_id=accounts.firm_id, job_id=row.id, origin="CAPTURED"))
    test_db.commit()
    return row


def _manual(api_client, title="Cloud Architect", url="https://jobs.example.test/2"):
    response = api_client.post("/api/jobs/manual", json={"title": title, "company": "Globex", "url": url})
    assert response.status_code == 200, response.text
    return response.json()


def test_adding_a_job_by_hand_writes_an_entry(api_client, test_db, accounts):
    made = _manual(api_client)
    entry = _entries(test_db, entity_type="job", entity_id=made["id"], action="CREATE")[0]
    assert entry.summary == "Added Cloud Architect at Globex to the feed."
    assert (entry.entity_label, entry.candidate_id, entry.actor_user_id) == ("Cloud Architect · Globex", None, accounts.user_id)


def test_adding_a_job_the_firm_already_sees_writes_nothing(api_client, test_db):
    _manual(api_client)
    assert _manual(api_client)["created"] is False
    assert len(_entries(test_db, entity_type="job")) == 1


def test_a_job_only_another_firm_had_is_logged_when_this_firm_captures_it(api_client, test_db):
    test_db.add(Job(external_id="x", content_hash=None, title="Other", company="Globex", url="https://jobs.example.test/3", source="manual"))
    test_db.commit()
    from backend.scraper._shared.dedup import make_content_hash, make_external_id
    row = test_db.query(Job).filter_by(external_id="x").one()
    row.external_id = make_external_id("Globex", "Other", "https://jobs.example.test/3")
    row.content_hash = make_content_hash("Globex", "Other")
    test_db.commit()
    assert _manual(api_client, "Other", "https://jobs.example.test/3")["created"] is False
    assert [e.action for e in _entries(test_db, entity_type="job")] == ["CREATE"]


def test_saving_from_the_extension_writes_an_entry(api_client, test_db):
    response = api_client.post("/api/jobs/save-from-extension", json={"title": "Extension Job", "company": "Initech", "url": "https://jobs.example.test/ext"})
    assert response.status_code == 200, response.text
    assert _entries(test_db, entity_type="job")[0].summary == "Added Extension Job at Initech to the feed."


def test_a_status_change_keeps_before_and_after(api_client, test_db, job):
    assert api_client.patch(f"/api/jobs/{job.id}", json={"status": "saved", "saved": True}).status_code == 200
    entry = _entries(test_db, entity_type="job", action="UPDATE")[0]
    assert entry.changes == {"status": {"before": "new", "after": "saved"}, "saved": {"before": False, "after": True}}


def test_opening_a_job_is_a_read_and_writes_nothing(api_client, test_db, job):
    assert api_client.patch(f"/api/jobs/{job.id}", json={"seen": True}).status_code == 200
    assert _entries(test_db, entity_type="job") == []


def test_marking_a_job_applied_also_logs_the_application(api_client, test_db, job):
    assert api_client.patch(f"/api/jobs/{job.id}", json={"status": "applied"}).status_code == 200
    assert _entries(test_db, entity_type="application", action="CREATE")[0].summary == "Marked Data Engineer as applied."


def test_a_bulk_update_logs_what_changed_only(api_client, test_db, job):
    other = _manual(api_client)["id"]
    body = {"job_ids": [str(job.id), other], "updates": {"status": "ignored"}}
    assert api_client.post("/api/jobs/bulk-update", json=body).json()["updated"] == 2
    assert api_client.post("/api/jobs/bulk-update", json=body).json()["updated"] == 2
    assert len(_entries(test_db, entity_type="job", action="UPDATE")) == 2


def test_analysing_a_job_is_logged_as_the_agent(api_client, test_db, accounts, job, monkeypatch):
    import backend.main as main
    monkeypatch.setattr(main, "launch_background", lambda *args, **kwargs: "run")
    assert api_client.post(f"/api/analyze/{job.id}", json={}).status_code == 202
    entry = _entries(test_db, action="AI_GENERATE")[0]
    owner = test_db.get(User, accounts.user_id)
    assert (entry.actor_type, entry.on_behalf_of_user_id) == ("AGENT", owner.id)
    assert entry.summary == f"AI agent scored Data Engineer against the résumés on behalf of {owner.name}"


def test_an_analysis_already_running_writes_nothing(api_client, test_db, job, monkeypatch):
    import backend.main as main
    from backend.job_monitor import JobAlreadyRunningError

    def busy(*args, **kwargs):
        raise JobAlreadyRunningError("analyze_job", 1.0)
    monkeypatch.setattr(main, "launch_background", busy)
    assert api_client.post(f"/api/analyze/{job.id}", json={}).status_code == 409
    assert _entries(test_db, action="AI_GENERATE") == []
