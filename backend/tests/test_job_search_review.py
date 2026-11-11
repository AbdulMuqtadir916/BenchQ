"""Abdul's review of job search PR 1 (2026-11-10): a search's run names nothing of the firm's (P1); one BDE's searches
are admitted one at a time (P2); the provider is a registered platform setting (P2); the demo reset survives a
search (P3). The `scoped()` reads (P3) are checked by test_firm_scoping_lint.py. His second review (2026-11-11): the
platform audit shows no search text (P2), a query with a control character is a 422 (P2), a search is committed before
it is launched and the source is asked only for a running one (P2), a lost search keeps its error code and gets its
ledger entry (P3); 0022 running again after a downgrade is in test_migration_0022.py. A fake provider: no network."""
import asyncio
import threading
import uuid

import pytest

from backend.job_search import pipeline
from backend.tests.test_candidates_api import _create, world  # noqa: F401  (the fixture)
from backend.tests.test_job_search_api import (_job, _lose, _open, _post, _rows, _run, _url, adnans, fake,  # noqa: F401
                                               launched)


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


# ── Abdul's second review of PR 1 ────────────────────────────────────────────

def test_the_platform_audit_shows_no_search_text_and_the_firms_ledger_does(api_client, anonymous_client, world, adnans,
                                                                          fake):
    """P2: a platform admin reads that a search happened, never its role or country; the firm reads both."""
    fake.jobs = [_job(1)]
    batch_id = _open(world, adnans, query="Very Private Role")
    _run(world, adnans, query="Very Private Role", batch_id=batch_id)
    audit = api_client.get("/api/admin/audit")
    assert audit.status_code == 200 and "Very Private Role" not in audit.text and "(US)" not in audit.text
    entry = next(e for e in audit.json() if e["entity_id"] == str(batch_id))
    assert (entry["entity_type"], entry["entity_label"]) == ("job_search", "Job search")
    assert entry["summary"] == "Searched jobs (content restricted)." and entry["actor_user_id"]
    own = anonymous_client.get(f"/api/firms/{world['firm'].id}/ledger?entity_type=job_search",
                               headers=world["as"]["owner"]).json()
    assert any("Very Private Role" in e["summary"] for e in own)


@pytest.mark.parametrize("query", ["Java\x00Developer", "Java\nDeveloper", "Java\tDeveloper", "\x07Java", "Java\x7f",
                                   "Java\u0085Developer"])
def test_a_query_with_a_control_character_is_a_422_with_nothing_written(anonymous_client, world, adnans, fake,
                                                                         launched, test_db, query):
    """P2: NUL (which Postgres refuses in JSONB) and every other control character: 422, no batch, no launch."""
    r = _post(anonymous_client, world, adnans, query=query)
    assert r.status_code == 422, r.text
    batches, _ = _rows(test_db, adnans)
    assert batches == [] and launched == []


@pytest.mark.parametrize("query", ["Développeur Java", "Java/C++ (Senior) – Remote", "डेटा इंजीनियर"])
def test_ordinary_text_in_any_script_still_searches(anonymous_client, world, adnans, fake, launched, query):
    assert _post(anonymous_client, world, adnans, query=query).status_code == 202


def test_the_search_is_committed_before_it_is_launched(anonymous_client, world, adnans, fake, monkeypatch):
    """P2: when the launcher is called, another session already reads the batch `running`."""
    from backend.api import routes_job_search
    from backend.models.db import SessionLocal
    from backend.models.job_search import ScrapeJob
    seen = []

    def launch(job_type, func, scope_key=None, func_kwargs=None, **kw):
        with SessionLocal() as db:
            seen.append(db.query(ScrapeJob.state).filter(ScrapeJob.batch_id == func_kwargs["batch_id"]).scalar())
        return str(uuid.uuid4())
    monkeypatch.setattr(routes_job_search, "launch_background", launch)
    assert _post(anonymous_client, world, adnans).status_code == 202
    assert seen == ["running"]


def test_a_launch_that_fails_leaves_no_search_behind(anonymous_client, world, adnans, fake, monkeypatch, test_db):
    """P2: the launcher failing is a 503; the row is gone, so it isn't an attempt and doesn't block the next one."""
    from backend.api import routes_job_search

    def broken(*args, **kwargs):
        raise RuntimeError("the job_runs insert failed")
    monkeypatch.setattr(routes_job_search, "launch_background", broken)
    assert _post(anonymous_client, world, adnans).status_code == 503
    batches, _ = _rows(test_db, adnans)
    assert batches == []
    monkeypatch.setattr(routes_job_search, "launch_background", lambda *a, **k: str(uuid.uuid4()))
    assert _post(anonymous_client, world, adnans).status_code == 202


def test_a_task_whose_search_was_never_saved_does_not_ask_the_source(world, adnans, fake):
    """P2: the task checks its batch (a scoped read) before calling the provider."""
    result = asyncio.run(pipeline.run_search(
        firm_id=world["firm"].id, candidate_id=uuid.UUID(adnans["id"]), user_id=world["people"]["adnan"].id,
        batch_id=uuid.uuid4(), query="Java Developer", country="us", provider_name="fake"))
    assert result == "dropped: the search was no longer running" and fake.calls == []


def test_a_task_whose_search_was_marked_lost_does_not_ask_the_source(anonymous_client, world, adnans, fake, launched,
                                                                     test_db):
    lost = _open(world, adnans)
    _lose(test_db, lost)
    assert _post(anonymous_client, world, adnans).status_code == 202          # marks it lost
    assert _run(world, adnans, batch_id=lost) == "dropped: the search was no longer running"
    assert fake.calls == []


def test_a_lost_search_keeps_its_error_code_and_gets_its_ledger_entry(anonymous_client, world, adnans, fake, launched,
                                                                      test_db):
    """P3: before and after it is written, the history says `error` / `internal`; one ledger entry, credited to the
    BDE who started it."""
    from backend.models.tenancy import LedgerEntry
    lost = _open(world, adnans)
    _lose(test_db, lost)

    def shown():
        body = anonymous_client.get(_url(world, adnans, "job-searches"), headers=world["as"]["owner"]).json()
        row = next(s for s in body["searches"] if s["batch_id"] == str(lost))
        return row["state"], row["error_code"]
    assert shown() == ("error", "internal")
    assert _post(anonymous_client, world, adnans).status_code == 202          # writes it
    assert shown() == ("error", "internal")
    test_db.expire_all()
    (entry,) = test_db.query(LedgerEntry).filter(LedgerEntry.entity_type == "job_search",
                                                 LedgerEntry.entity_id == str(lost)).all()
    assert entry.actor_user_id == world["people"]["adnan"].id and "failed (internal)" in entry.summary
    assert entry.candidate_id == uuid.UUID(adnans["id"])


# ── Abdul's comment on PR 2 (#124), fixed in PR 1: the lock wait is off the event loop ──

def test_a_search_waiting_for_the_bdes_lock_does_not_stall_other_requests(anonymous_client, world, adnans, fake,
                                                                          launched):
    """P2: a search admitted while another transaction holds the BDE's lock waits in a worker thread, not on the API
    event loop, so other requests on the worker still answer (before: they waited until the lock was let go)."""
    import time

    from sqlalchemy import text

    from backend.job_search import limits
    from backend.models.db import engine
    search = _poster(anonymous_client, world, adnans, "job-searches", {"query": "Java Developer"})
    key = limits._lock_key(world["people"]["adnan"].id)
    held, results = threading.Event(), {}

    def hold_the_lock():
        with engine.connect() as conn, conn.begin():
            conn.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": key})
            held.set()
            time.sleep(3)

    holder = threading.Thread(target=hold_the_lock)
    holder.start()
    held.wait(10)
    searcher = threading.Thread(target=lambda: results.setdefault("search", search()))
    searcher.start()
    time.sleep(0.5)                                     # the search is now waiting for the lock
    started = time.monotonic()
    assert anonymous_client.get("/health").status_code == 200
    answered_in = time.monotonic() - started
    assert "search" not in results                      # still waiting: the lock is held
    holder.join(10)
    searcher.join(20)
    assert results["search"].status_code == 202
    assert answered_in < 1.5, f"another request waited {answered_in:.1f}s behind the search's lock wait"


# ── CodeRabbit on #123: linking the run never writes back stale metadata ──

def test_linking_the_run_keeps_what_a_search_saving_at_that_moment_wrote(world, adnans):
    """The search is launched before its run id is written on the batch. If the search saves (its cursor, its counts)
    while the run id is being written, both stay (before: the run id was written over the metadata read before the
    save, and the cursor was lost)."""
    import time

    from backend.api.routes_job_search import _link_run
    from backend.models.db import SessionLocal
    from backend.models.job_search import ScrapeJob
    batch_id, saving = _open(world, adnans), threading.Event()

    def save_meanwhile():
        with SessionLocal() as db:
            batch = db.query(ScrapeJob).filter(ScrapeJob.batch_id == batch_id).with_for_update().one()
            saving.set()
            time.sleep(1)
            batch.meta = {**batch.meta, "next_cursor": "page-2"}
            db.commit()

    saver = threading.Thread(target=save_meanwhile)
    saver.start()
    saving.wait(10)
    with SessionLocal() as db:
        _link_run(db, world["firm"].id, batch_id, "run-1")
    saver.join(10)
    with SessionLocal() as db:
        meta = db.query(ScrapeJob.meta).filter(ScrapeJob.batch_id == batch_id).scalar()
    assert meta["run_id"] == "run-1" and meta["next_cursor"] == "page-2"


# ── The bot reviews on #135 (CodeRabbit, CodeAnt), PR 1's part ──

def test_a_failed_start_check_ends_the_search_as_an_error_not_running(world, adnans, fake, test_db, monkeypatch):
    """A database blip on the task's first read: the batch is an `internal` error at once, not `running` for 15
    minutes blocking the candidate's next search, and the source is not asked."""
    from backend.models.job_search import ScrapeJob
    batch_id = _open(world, adnans)

    def blip(*args):
        raise RuntimeError("the database went away")
    monkeypatch.setattr(pipeline, "_running_request", blip)
    result = asyncio.run(pipeline.run_search(
        firm_id=world["firm"].id, candidate_id=uuid.UUID(adnans["id"]), user_id=world["people"]["adnan"].id,
        batch_id=batch_id, query="Java Developer", country="us", provider_name="fake"))
    test_db.expire_all()
    batch = test_db.query(ScrapeJob).filter(ScrapeJob.batch_id == batch_id).one()
    assert result == "failed: internal" and fake.calls == []
    assert batch.state == "error" and batch.meta["error_code"] == "internal"
