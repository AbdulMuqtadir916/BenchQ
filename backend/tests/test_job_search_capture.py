"""Job search PR 2 (decided 2026-11-10): a captured job (by hand or from the extension) is its own batch with one
posting; a repeated search of the same role continues where the last one stopped; and the old pool's scheduled
scrape and write routes are retired. A fake provider: no network, made-up jobs."""
import uuid
from datetime import timedelta

import pytest

from backend.job_search import limits
from backend.tests.test_candidates_api import _create, world  # noqa: F401  (the fixture)
from backend.tests.test_job_search_api import (FakeProvider, _job, _lose, _open, _post, _rows, _run,  # noqa: F401
                                               _url, adnans, fake, launched)


def _capture(client, world, candidate, who="adnan", **over):
    body = {"source": "manual", "title": "Java Developer", "company": "Example Corp",
            "description": "A made-up captured job.", "url": "https://jobs.example.test/captured", **over}
    return client.post(_url(world, candidate, "job-postings"), json=body, headers=world["as"][who])


# ── capture ──────────────────────────────────────────────────────────────────

def test_the_bde_captures_a_job_as_its_own_batch(anonymous_client, world, adnans, test_db):
    from backend.models.tenancy import LedgerEntry
    r = _capture(anonymous_client, world, adnans, location="Remote")
    assert r.status_code == 201, r.text
    job = r.json()
    assert (job["source"], job["title"], job["company"], job["location"], job["description"]) == (
        "manual", "Java Developer", "Example Corp", "Remote", "A made-up captured job.")
    (batch,), (posting,) = _rows(test_db, adnans)
    assert (batch.kind, batch.state, batch.user_id) == ("capture", "success", world["people"]["adnan"].id)
    assert batch.finished_at is not None and posting.batch_id == batch.batch_id
    entry = test_db.query(LedgerEntry).filter(LedgerEntry.entity_type == "job_posting").one()
    assert (entry.summary, entry.entity_label) == ("Captured a job (manual)", "Java Developer at Example Corp")


def test_the_same_job_captured_again_is_the_one_the_candidate_has(anonymous_client, world, adnans, test_db):
    first = _capture(anonymous_client, world, adnans).json()
    again = _capture(anonymous_client, world, adnans, title="  java developer ", url="https://jobs.example.test/x")
    assert again.status_code == 200 and again.json()["id"] == first["id"]
    assert first["created"] is True and again.json()["created"] is False
    batches, postings = _rows(test_db, adnans)
    assert len(batches) == 1 and len(postings) == 1


def test_an_extension_capture_reads_the_pages_html_as_text(anonymous_client, world, adnans):
    r = _capture(anonymous_client, world, adnans, source="extension",
                 description="<p>Build <b>services</b>.</p><ul><li>Java</li></ul>")
    assert r.status_code == 201 and r.json()["description"] == "Build services.\nJava"


@pytest.mark.parametrize("over", [{"url": "javascript:alert(1)"}, {"url": "/relative"}, {"title": ""},
                                  {"source": "jsearch"}, {"description": "x" * 100_001}, {"company": "c" * 301}])
def test_a_capture_is_checked(anonymous_client, world, adnans, over):
    assert _capture(anonymous_client, world, adnans, **over).status_code == 422


@pytest.mark.parametrize("who,status", [("owner", 403), ("fatima", 403), ("rohan", 403), ("vikram", 404)])
def test_only_the_candidates_bde_captures(anonymous_client, world, adnans, who, status):
    assert _capture(anonymous_client, world, adnans, who=who).status_code == status


def test_a_bde_captures_20_jobs_a_day_and_they_are_not_search_attempts(anonymous_client, world, adnans, fake,
                                                                     launched):
    for n in range(limits.CAPTURES_PER_BDE_PER_DAY):
        assert _capture(anonymous_client, world, adnans, description=f"Captured job {n}.").status_code == 201
    r = _capture(anonymous_client, world, adnans, description="One more.")
    assert r.status_code == 429 and "captured 20 jobs" in r.json()["detail"]
    assert _post(anonymous_client, world, adnans).status_code == 202        # searches are counted apart
    usage = anonymous_client.get(_url(world, adnans, "job-searches"), headers=world["as"]["adnan"]).json()["usage"]
    assert (usage["captures_today"], usage["attempts_today"], usage["jobs_saved_today"]) == (20, 1, 0)


def test_a_search_that_finds_a_captured_job_merges_into_it(anonymous_client, world, adnans, fake, test_db):
    captured = _capture(anonymous_client, world, adnans, title="Java Developer 1", company="Example 1",
                        description="Made-up description 1.").json()
    fake.jobs = [_job(1), _job(2)]
    assert _run(world, adnans) == "1 new, 1 seen again"
    _, postings = _rows(test_db, adnans)
    merged = next(p for p in postings if str(p.id) == captured["id"])
    assert (merged.source, merged.content["u"]) == ("fake", "https://jobs.example.test/1")


# ── a repeated search continues ──────────────────────────────────────────────

def test_the_same_role_again_continues_where_the_last_search_stopped(world, adnans, fake):
    fake.jobs, fake.next_cursor = [_job(1)], "100"
    _run(world, adnans)
    fake.jobs, fake.next_cursor = [_job(2)], "200"
    _run(world, adnans, query="  java   DEVELOPER ")
    _run(world, adnans, query="Spring Developer")                       # another role starts at the top
    assert fake.cursors == [None, "100", None]


def test_a_failed_search_asks_for_the_same_page_again(world, adnans, fake):
    fake.jobs, fake.next_cursor = [_job(1)], "100"
    _run(world, adnans)
    fake.error = "timeout"
    _run(world, adnans)
    fake.error = None
    _run(world, adnans)
    assert fake.cursors == [None, "100", "100"]


def test_when_the_source_runs_out_the_role_ends_empty_without_asking_again(world, adnans, fake, test_db):
    fake.jobs, fake.next_cursor = [_job(1)], None
    _run(world, adnans)
    assert _run(world, adnans) == "0 new, 0 seen again"
    assert len(fake.calls) == 1
    batches, _ = _rows(test_db, adnans)
    assert (batches[1].state, batches[1].meta["request"]["exhausted"]) == ("empty", True)


def test_the_next_day_starts_from_the_top(world, adnans, fake, test_db):
    from backend.models.job_search import ScrapeJob
    fake.jobs, fake.next_cursor = [_job(1)], "100"
    _run(world, adnans)
    test_db.query(ScrapeJob).update({ScrapeJob.created_at: limits.day_start() - timedelta(minutes=1)})
    test_db.commit()
    _run(world, adnans)
    assert fake.cursors == [None, None]


# ── the old pool ─────────────────────────────────────────────────────────────

@pytest.mark.parametrize("method,path", [
    ("POST", "/api/jobs/manual"), ("POST", "/api/jobs/save-from-extension"), ("POST", "/api/jobs/linkedin-import"),
    ("PATCH", "/api/jobs/{id}"), ("POST", "/api/analyze/{id}"), ("POST", "/api/scrape/run-all"),
    ("POST", "/api/scrape/company/{id}"), ("POST", "/api/jobs/backfill-descriptions"),
    ("POST", "/api/searches/{id}/run"), ("POST", "/api/searches/{id}/test"),
    ("POST", "/api/companies/{id}/test-scrape"), ("POST", "/api/cover-letters"),
    ("POST", "/api/cover-letters/generate")])
def test_the_old_pools_write_routes_are_retired(api_client, method, path):
    r = api_client.request(method, path.replace("{id}", str(uuid.uuid4())), json={})
    assert r.status_code == 410, (path, r.status_code, r.text)
    assert "candidate's search" in r.json()["detail"]


def test_the_old_pools_scheduled_scrape_is_not_scheduled(test_db, monkeypatch):
    from backend import scheduler as sched
    from backend.models.db import Setting
    test_db.merge(Setting(key="scrape_interval_minutes", value="30"))
    test_db.commit()
    added = []
    monkeypatch.setattr(sched.scheduler, "add_job", lambda func, *a, id=None, **k: added.append(id))
    monkeypatch.setattr(sched.scheduler, "remove_all_jobs", lambda: None)
    monkeypatch.setattr(sched.scheduler, "get_jobs", lambda: [])
    sched.configure_scheduler()
    assert "scrape_all" not in added


# ── a tailored résumé names its own candidate's job ──────────────────────────

def test_a_tailored_resume_names_only_its_own_candidates_job_and_goes_with_it(anonymous_client, world, adnans,
                                                                              test_db):
    from sqlalchemy.exc import IntegrityError
    from backend.models.candidates import Candidate
    from backend.models.db import Resume
    from backend.models.job_search import JobPosting
    from backend.tests.resume_support import make_version
    mine = _capture(anonymous_client, world, adnans).json()
    other = _create(anonymous_client, world, bde="sneha").json()
    theirs = _capture(anonymous_client, world, other, who="adnan")       # Sneha's candidate: not Adnan's to add to
    assert theirs.status_code == 404
    candidate = test_db.get(Candidate, uuid.UUID(adnans["id"]))
    other_posting = JobPosting(firm_id=world["firm"].id, candidate_id=uuid.UUID(other["id"]),
                               batch_id=_open(world, other), source="manual", job_id="b" * 64, content={})
    test_db.add(other_posting)
    test_db.commit()
    with pytest.raises(IntegrityError):
        make_version(test_db, world["firm"].id, candidate=candidate, category="TAILORED", job_id=other_posting.id)
        test_db.commit()
    test_db.rollback()
    tailored = make_version(test_db, world["firm"].id, candidate=candidate, category="TAILORED",
                            job_id=uuid.UUID(mine["id"]))
    test_db.commit()
    tailored_id = tailored.id
    test_db.query(JobPosting).filter(JobPosting.id == uuid.UUID(mine["id"])).delete()
    test_db.commit()
    assert test_db.get(Resume, tailored_id) is None                     # deleting the job deletes its tailored résumé


# ── Abdul's comments on PR 2 (#124) ──────────────────────────────────────────

def test_a_captured_job_a_search_refreshes_stays_out_of_the_100(anonymous_client, world, adnans, fake, launched,
                                                                test_db):
    """99 jobs saved by search; a capture; a search whose page has the captured job and one new job: 100, not 101.
    The cap counts how a job was first saved (`first_source`), not its latest `source`."""
    fake.jobs = [_job(n) for n in range(100, 199)]
    assert _run(world, adnans) == "99 new, 0 seen again"
    captured = _capture(anonymous_client, world, adnans, title="Java Developer 1", company="Example 1",
                        description="Made-up description 1.").json()
    fake.jobs = [_job(1), _job(2)]
    assert _run(world, adnans, query="Spring Developer") == "1 new, 1 seen again"
    _, postings = _rows(test_db, adnans)
    merged = next(p for p in postings if str(p.id) == captured["id"])
    assert (merged.source, merged.first_source) == ("fake", "manual")          # refreshed, still a capture
    assert limits.jobs_saved_today(test_db, world["firm"].id, uuid.UUID(adnans["id"])) == 100
    assert _post(anonymous_client, world, adnans).status_code == 429


def test_a_capture_retried_at_the_cap_returns_its_posting(anonymous_client, world, adnans):
    """The 20th capture's response is lost and the client retries: 200 with the same posting, not 429. Only a capture
    that would create a posting counts against the 20."""
    for n in range(limits.CAPTURES_PER_BDE_PER_DAY):
        last = _capture(anonymous_client, world, adnans, description=f"Captured job {n}.")
        assert last.status_code == 201
    again = _capture(anonymous_client, world, adnans, description=f"Captured job {limits.CAPTURES_PER_BDE_PER_DAY - 1}.")
    assert again.status_code == 200 and again.json()["id"] == last.json()["id"]
    assert _capture(anonymous_client, world, adnans, description="A new one.").status_code == 429


def test_a_capture_refused_at_the_cap_and_a_search_at_once_do_not_stall(anonymous_client, world, adnans, fake,
                                                                        launched):
    """A capture for one candidate holds the BDE's lock and answers 429 while a search for another of their candidates
    waits for that lock: the search waits in a worker thread, so the capture's clean-up (which lets the lock go) runs
    and neither stalls until the statement timeout."""
    import time

    from backend.tests.test_job_search_contract import _at_once, _poster
    other = _create(anonymous_client, world, bde="adnan").json()
    for n in range(limits.CAPTURES_PER_BDE_PER_DAY):
        assert _capture(anonymous_client, world, adnans, description=f"Captured job {n}.").status_code == 201
    for round_ in range(5):
        capture = _poster(anonymous_client, world, adnans, "job-postings",
                          {"source": "manual", "title": "Java Developer", "company": "Example Corp",
                           "description": f"Over the cap {round_}.", "url": "https://jobs.example.test/over"})
        search = _poster(anonymous_client, world, other, "job-searches", {"query": f"Role {round_}"})
        started = time.monotonic()
        captured, searched = _at_once([capture, search])
        took = time.monotonic() - started
        assert captured.status_code == 429 and searched.status_code in (202, 409)
        assert took < 5, f"round {round_} took {took:.1f}s"
