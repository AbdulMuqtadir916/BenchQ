"""Abdul's review of job search PR 1 (2026-11-10): a search's run names nothing of the firm's (P1); one BDE's searches
are admitted one at a time (P2); the provider is a registered platform setting (P2); the demo reset survives a
search (P3). The `scoped()` reads (P3) are checked by test_firm_scoping_lint.py. A fake provider: no network."""
import threading
import uuid

from backend.job_search import pipeline
from backend.tests.test_candidates_api import _create, world  # noqa: F401  (the fixture)
from backend.tests.test_job_search_api import _post, _run, _url, adnans, fake, launched  # noqa: F401


def _at_once(calls):
    results, gate = [None] * len(calls), threading.Barrier(len(calls))

    def go(i, call):
        gate.wait()
        results[i] = call()
    threads = [threading.Thread(target=go, args=(i, c)) for i, c in enumerate(calls)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(30)
    return results


def _poster(client, world, candidate, tail, body):
    """The request, built before the threads start: they mustn't share the test's ORM session."""
    url, headers = _url(world, candidate, tail), dict(world["as"]["adnan"])
    return lambda: client.post(url, json=body, headers=headers)


# ── Abdul's review of PR 1 ───────────────────────────────────────────────────

def test_a_platform_admin_sees_no_search_details_in_the_monitor(api_client, anonymous_client, world, adnans, fake):
    """P1: a search's run names nothing of the firm's; its details stay in the firm's `scrape_jobs` row."""
    from backend.models.db import JobRun, SessionLocal
    r = _post(anonymous_client, world, adnans, query="Very Private Role")
    run_id = r.json()["run_id"]
    import time
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        with SessionLocal() as db:
            if db.get(JobRun, uuid.UUID(run_id)).status != "running":
                break
        time.sleep(0.05)
    with SessionLocal() as db:
        run = db.get(JobRun, uuid.UUID(run_id))
        assert run.meta is None and run.firm_id is None
    shown = api_client.get("/api/monitor/history?job_type=job_search").text + \
        api_client.get(f"/api/monitor/run/{run_id}").text
    for secret in ("Very Private Role", adnans["id"], str(world["people"]["adnan"].id), str(world["firm"].id)):
        assert secret not in shown


def test_one_bdes_searches_for_two_candidates_at_once_count_their_attempts_in_turn(anonymous_client, world, adnans,
                                                                                   fake, launched):
    """P2: at 19 of 20, two clicks for two different candidates of the same BDE start exactly one search."""
    from backend.job_search import limits
    other = _create(anonymous_client, world, bde="adnan").json()
    fake.error = "timeout"
    for _ in range(limits.ATTEMPTS_PER_BDE_PER_DAY - 1):
        _run(world, adnans)
    results = _at_once([_poster(anonymous_client, world, adnans, "job-searches", {"query": "Java Developer"}),
                        _poster(anonymous_client, world, other, "job-searches", {"query": "Java Developer"})])
    assert sorted(r.status_code for r in results) == [202, 429]


def test_the_provider_is_a_platform_setting_and_must_be_registered(api_client, test_db):
    """P2: PATCH /api/settings takes `job_search_provider`, only as a registered provider."""
    from backend.job_search import providers
    from backend.settings_scope import SETTING_SCOPES, Scope
    assert SETTING_SCOPES["job_search_provider"][0] == Scope.PLATFORM
    assert api_client.patch("/api/settings", json={"job_search_provider": "freehire"}).status_code == 200
    assert providers.active(test_db).name == "freehire"
    r = api_client.patch("/api/settings", json={"job_search_provider": "nope"})
    assert r.status_code == 400 and "job_search_provider" in r.json()["detail"]


def test_the_demo_reset_works_after_a_search(test_db):
    """P3: a demo candidate's search and its jobs go before the candidate."""
    from backend.models.candidates import Candidate
    from backend.models.job_search import JobPosting, ScrapeJob
    from backend.scripts import seed_demo
    seed_demo.seed(test_db)
    candidate = test_db.query(Candidate).filter(Candidate.bde_id.isnot(None)).first()
    batch = pipeline.open_batch(test_db, firm_id=candidate.firm_id, candidate_id=candidate.id,
                                user_id=candidate.bde_id, query="Java Developer", country="us", provider="fake")
    test_db.add(JobPosting(firm_id=candidate.firm_id, candidate_id=candidate.id, batch_id=batch.batch_id,
                           source="fake", job_id="c" * 64, content={}))
    test_db.flush()
    candidate_id = candidate.id
    seed_demo.reset(test_db)
    test_db.commit()
    assert test_db.query(ScrapeJob).count() == 0 and test_db.query(JobPosting).count() == 0
    assert test_db.query(Candidate).filter(Candidate.id == candidate_id).first() is None
