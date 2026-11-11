"""F4 for the shared job pool: a firm sees only the jobs `firm_jobs` links it to (07 Q37). A job of the pool that
isn't linked to the signed-in firm is left out of the feed, its menus and counts, and its id answers 404."""
import pytest

from backend.models.db import Job, Resume
from backend.models.tenancy import FirmJob
from backend.tests.resume_support import old_resume
from backend.tests.auth_support import make_firm, make_plan


@pytest.fixture
def jobs(test_db, accounts):
    """One job linked to the signed-in firm ("acme"), one linked only to "globex"."""
    other = make_firm(test_db, make_plan(test_db, name="Other plan"), slug="globex").id
    mine = Job(external_id="ext-mine", title="Engineer", company="Acme", url="https://a.test", source="jobspy_indeed",
               status="new")
    theirs = Job(external_id="ext-theirs", title="Analyst", company="Globex", url="https://g.test",
                 source="jobspy_indeed", status="new")
    test_db.add_all([mine, theirs])
    test_db.flush()
    test_db.add_all([FirmJob(firm_id=accounts.firm_id, job_id=mine.id, origin="SCRAPED"),
                     FirmJob(firm_id=other, job_id=theirs.id, origin="SCRAPED")])
    test_db.commit()
    return {"mine": mine, "theirs": theirs}


def test_the_feed_and_its_menus_show_only_the_firms_jobs(api_client, jobs):
    feed = api_client.get("/api/jobs").json()
    assert [j["title"] for j in feed["jobs"]] == ["Engineer"]
    assert feed["total"] == 1
    assert api_client.get("/api/jobs/companies/list").json() == ["Acme"]
    assert [s["name"] for s in api_client.get("/api/jobs/sources/list?counts=1").json()] == ["jobspy_indeed"]
    assert api_client.get("/api/jobs/sources/list?counts=1").json()[0]["count"] == 1
    assert [c["name"] for c in api_client.get("/api/jobs/facets").json()["companies"]] == ["Acme"]
    assert api_client.get("/api/jobs/feed-stats").json()["unscored"] == 1
    assert api_client.get("/api/jobs/unscored-ids").json()["ids"] == [str(jobs["mine"].id)]
    assert api_client.get("/api/stats").json()["total_jobs"] == 1


@pytest.mark.parametrize("method, path", [
    ("GET", "/api/jobs/{job}"),
    ("GET", "/api/jobs/{job}/cached-page"),
    ("GET", "/api/jobs/{job}/frame-check"),
])
def test_another_firms_job_is_not_found(api_client, jobs, method, path):
    resp = api_client.request(method, path.format(job=jobs["theirs"].id), json={} if method != "GET" else None)
    assert resp.status_code == 404, resp.text


# POST /api/jobs/bulk-update is retired (job search PR 2): its 410 is tested in test_job_search_capture.py.
