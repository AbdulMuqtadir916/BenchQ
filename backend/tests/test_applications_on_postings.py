"""Applications on `job_postings`, and adding a job for a candidate (the add-job plan, decided 2026-11-11; docs/02
§6.y): a job the BDE adds becomes one of the candidate's postings, in a batch of its own, and a Saved application at
once; the same job again is the one they have; an application reads its job from its posting, in the JSON it always
had; the hand log with no candidate is retired."""
import pytest

from backend.applications.postings import job_hash, posting_job, read_content
from backend.models.db import Application
from backend.models.job_search import JobPosting, ScrapeJob
from backend.tests.test_candidates_api import _create, world  # noqa: F401  (the fixture)

JOB = {"source": "extension", "title": "Senior QA Engineer", "company": "Acme Bank",
       "description": "<h2>About</h2><p>Test the payments API &amp; more.</p><script>x()</script>",
       "url": "https://boards.example.test/acme/123", "location": "Atlanta, GA"}


def _candidate(client, world, bde="adnan", manager="fatima"):
    r = _create(client, world, bde=bde, manager=manager)
    assert r.status_code == 201, r.text
    return r.json()


def _add(client, world, candidate, job=None, who="adnan"):
    return client.post("/api/applications", json={"candidate_id": candidate["id"], "job": job or JOB},
                       headers=world["as"][who])


# ── Reading a posting ───────────────────────────────────────────────────────

def test_a_posting_reads_the_one_way_whatever_wrote_it():
    added = read_content("extension", JOB)
    assert (added.title, added.company, added.url, added.location) == (
        "Senior QA Engineer", "Acme Bank", "https://boards.example.test/acme/123", "Atlanta, GA")
    assert added.description == "About\nTest the payments API & more."        # the employer's HTML as plain text
    legacy = read_content("legacy", {"title": "Java Developer", "company": "Acme", "url": "javascript:alert(1)",
                                     "posted_at": "2026-10-01T00:00:00+00:00", "old_job_id": "x"})
    assert (legacy.title, legacy.url, legacy.posted_at) == ("Java Developer", None, "2026-10-01T00:00:00+00:00")
    assert posting_job(None).title == "" and read_content("manual", None).title == ""
    assert job_hash("Acme", "QA  Lead", "Text") == job_hash(" acme", "qa lead", "text ")
    assert job_hash("Acme", "QA Lead", "Text") != job_hash("Acme", "QA Lead", "Other text")


# ── Adding a job ────────────────────────────────────────────────────────────

def test_an_added_job_is_a_posting_in_its_own_batch_and_a_saved_application(anonymous_client, test_db, world):
    candidate = _candidate(anonymous_client, world)
    r = _add(anonymous_client, world, candidate)
    assert r.status_code == 201, r.text
    body = r.json()
    assert (body["status"], body["title"], body["company"], body["url"], body["source"]) == (
        "saved", "Senior QA Engineer", "Acme Bank", "https://boards.example.test/acme/123", "extension")
    assert (body["job_created"], body["application_created"], body["applied_at"]) == (True, True, None)
    posting = test_db.query(JobPosting).filter(JobPosting.candidate_id == candidate["id"]).one()
    assert str(posting.id) == body["job_id"] and posting.source == "extension"
    assert posting.content["description"].startswith("<h2>")                  # kept as sent; read as plain text
    batch = test_db.query(ScrapeJob).filter(ScrapeJob.batch_id == posting.batch_id).one()
    assert (batch.state, batch.meta) == ("success", {"kind": "capture", "request": {"source": "extension"}})


def test_the_same_job_again_is_the_one_the_candidate_has(anonymous_client, test_db, world):
    candidate = _candidate(anonymous_client, world)
    first = _add(anonymous_client, world, candidate).json()
    again = _add(anonymous_client, world, candidate, {**JOB, "title": " senior qa  ENGINEER", "location": None})
    assert again.status_code == 200, again.text
    assert (again.json()["id"], again.json()["job_created"], again.json()["application_created"]) == (
        first["id"], False, False)
    assert test_db.query(JobPosting).count() == 1 and test_db.query(ScrapeJob).count() == 1


def test_the_same_link_and_title_with_other_text_is_the_job_the_candidate_has(anonymous_client, test_db, world):
    candidate = _candidate(anonymous_client, world)
    first = _add(anonymous_client, world, candidate).json()
    again = _add(anonymous_client, world, candidate, {**JOB, "description": "<p>Reworded since.</p>", "url": f"{JOB['url']}/#apply"})
    assert (again.status_code, again.json()["id"], again.json()["job_created"]) == (200, first["id"], False)
    other = _add(anonymous_client, world, candidate, {**JOB, "title": "Staff QA Engineer", "description": "<p>Another role.</p>"})
    assert (other.status_code, other.json()["job_created"]) == (201, True)
    assert test_db.query(JobPosting).count() == 2


def test_the_same_role_at_the_same_company_is_the_job_they_have_at_any_link(anonymous_client, test_db, world):
    candidate = _candidate(anonymous_client, world)
    first = _add(anonymous_client, world, candidate).json()
    copy = {**JOB, "title": "senior QA engineer", "company": " acme  bank ", "url": "https://jobs.example.test/copy/9",
            "description": "<p>The same role, posted again elsewhere.</p>"}
    again = _add(anonymous_client, world, candidate, copy)
    assert (again.status_code, again.json()["id"], again.json()["job_created"]) == (200, first["id"], False)
    elsewhere = _add(anonymous_client, world, candidate, {**copy, "location": "Boston, MA"})
    assert (elsewhere.status_code, elsewhere.json()["job_created"]) == (201, True)


def test_the_same_job_code_in_another_link_is_the_job_they_have(anonymous_client, test_db, world):
    candidate = _candidate(anonymous_client, world)
    board = {**JOB, "url": "https://boards.greenhouse.io/acmebank/jobs/8329677"}
    first = _add(anonymous_client, world, candidate, board).json()
    careers = {**board, "url": "https://careers.acmebank.com/open-roles?gh_jid=8329677", "title": "QA Engineer (Payments)",
               "description": "<p>Our own page for the role.</p>"}
    again = _add(anonymous_client, world, candidate, careers)
    assert (again.status_code, again.json()["id"], again.json()["job_created"]) == (200, first["id"], False)
    other = _add(anonymous_client, world, candidate, {**careers, "url": "https://careers.acmebank.com/open-roles?gh_jid=1111111"})
    assert (other.status_code, other.json()["job_created"]) == (201, True)


def test_adding_a_job_already_applied_to_keeps_its_application(anonymous_client, test_db, world):
    candidate = _candidate(anonymous_client, world)
    first = _add(anonymous_client, world, candidate).json()
    moved = anonymous_client.patch(f"/api/applications/{first['id']}/candidate-status",
                                   json={"status": "applied", "expected_revision": first["status_revision"]},
                                   headers=world["as"]["adnan"])
    assert moved.status_code == 200, moved.text
    assert moved.json()["applied_at"] is not None
    again = _add(anonymous_client, world, candidate).json()
    assert (again["id"], again["status"]) == (first["id"], "applied")
    assert test_db.query(Application).count() == 1


@pytest.mark.parametrize("job, problem", [
    ({**JOB, "url": "javascript:alert(1)"}, "an http(s) link"),
    ({**JOB, "source": "freehire"}, "source"),
    ({**JOB, "title": "  "}, "title"),
])
def test_an_added_job_needs_its_parts(anonymous_client, world, job, problem):
    candidate = _candidate(anonymous_client, world)
    r = _add(anonymous_client, world, candidate, job)
    assert r.status_code == 422 and problem in r.text


def test_a_job_is_added_only_for_a_candidate_in_scope_and_never_by_a_viewer(anonymous_client, world):
    candidate = _candidate(anonymous_client, world, bde="vikram", manager="priya")    # Priya's team
    assert _add(anonymous_client, world, candidate, who="adnan").status_code == 404   # not his candidate: not found
    assert _add(anonymous_client, world, candidate, who="rohan").status_code == 403


def test_only_the_candidates_bde_adds_a_job_for_them(anonymous_client, world):
    candidate = _candidate(anonymous_client, world)                                    # Adnan's, on Fatima's team
    assert _add(anonymous_client, world, candidate, who="fatima").status_code == 403   # their manager
    assert _add(anonymous_client, world, candidate, who="vikram").status_code in (403, 404)
    assert _add(anonymous_client, world, candidate, who="adnan").status_code == 201


# ── Saving one of the candidate's jobs, and reading applications ───────────

def test_saving_names_one_of_the_candidates_own_postings(anonymous_client, test_db, world):
    mine, theirs = _candidate(anonymous_client, world), _candidate(anonymous_client, world, bde="vikram", manager="priya")
    added = _add(anonymous_client, world, theirs, who="vikram").json()
    r = anonymous_client.post("/api/applications", json={"candidate_id": mine["id"], "job_id": added["job_id"],
                                                         "status": "saved"}, headers=world["as"]["adnan"])
    assert r.status_code == 404, r.text


def test_the_saved_list_reads_each_job_from_its_posting(anonymous_client, world):
    candidate = _candidate(anonymous_client, world)
    _add(anonymous_client, world, candidate)
    r = anonymous_client.get(f"/api/applications?status=saved&tracked_only=true&candidate_id={candidate['id']}",
                             headers=world["as"]["adnan"])
    assert r.status_code == 200, r.text
    [row] = r.json()["applications"]
    assert {k: row[k] for k in ("title", "company", "url", "location", "source", "salary_min", "has_cached_page")} == {
        "title": "Senior QA Engineer", "company": "Acme Bank", "url": "https://boards.example.test/acme/123",
        "location": "Atlanta, GA", "source": "extension", "salary_min": None, "has_cached_page": False}
    assert row["discovered_at"] and row["company_canonical"] == "Acme Bank"


def test_the_hand_log_with_no_candidate_is_retired(anonymous_client, world):
    r = anonymous_client.post("/api/applications", json={"title": "QA", "company": "Acme", "url": "https://a.test/1"},
                              headers=world["as"]["adnan"])
    assert r.status_code == 410 and "Add it for its candidate" in r.text
