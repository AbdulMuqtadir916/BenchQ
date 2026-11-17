"""Production layer step 3: the scheduler runs in its own process (backend/worker.py), not in the API.

What this covers: the API starts no scheduler; the worker does; both start a heartbeat; a schedule setting saved
through the API reaches the worker by the every-minute reload; a run is failed only once its process stopped stamping
it, so a restart or a second copy never fails a live copy's runs; and a job type both processes run
(job_monitor.SHARED_JOB_TYPES) runs once at a time across them, claimed in `job_runs`.
"""
import asyncio
import time
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

import pytest
from apscheduler.schedulers.asyncio import AsyncIOScheduler

import backend.job_monitor as jm
from backend.models.db import JobRun, Setting


async def _noop(*_args, **_kwargs):
    return None


@pytest.fixture(autouse=True)
def _clear_running_state():
    jm._running.clear()
    yield
    jm._running.clear()


@pytest.fixture
def fresh_scheduler(monkeypatch):
    import backend.scheduler as sched
    fresh = AsyncIOScheduler()
    monkeypatch.setattr(sched, "scheduler", fresh)
    monkeypatch.setattr(sched, "_applied_schedule", None)
    return fresh


def _set(test_db, key, value):
    row = test_db.query(Setting).filter(Setting.key == key).first()
    if row is None:
        test_db.add(Setting(key=key, value=value))
    else:
        row.value = value
    test_db.commit()


def _run(test_db, job_type, trigger, *, minutes_ago=1, status="running", seen_minutes_ago=None):
    meta = None if seen_minutes_ago is None else {
        "seen_at": (datetime.now(timezone.utc) - timedelta(minutes=seen_minutes_ago)).isoformat()}
    row = JobRun(id=uuid.uuid4(), job_type=job_type, trigger=trigger, status=status, meta=meta,
                 started_at=datetime.now(timezone.utc) - timedelta(minutes=minutes_ago))
    test_db.add(row)
    test_db.commit()
    return row.id


def _status(test_db, run_id):
    test_db.expire_all()
    return test_db.get(JobRun, run_id).status


# ── The API starts no scheduler; the worker does ────────────────────────────

def _fake_heartbeat(events):
    def start():
        events.append("started")
        return lambda: events.append("stopped")
    return start


@pytest.mark.asyncio
async def test_the_api_starts_no_scheduler_but_its_heartbeat(monkeypatch):
    import backend.main as main_mod
    import backend.scheduler as sched
    from backend.analyzer import llm_cost

    beats = []
    monkeypatch.setattr(main_mod, "check_schema_at_head", lambda: None)
    monkeypatch.setattr(main_mod, "run_seeds", lambda: None)
    monkeypatch.setattr(main_mod, "start_heartbeat", _fake_heartbeat(beats))
    monkeypatch.setattr(llm_cost, "refresh_openrouter_prices", _noop)
    fake = MagicMock()
    monkeypatch.setattr(sched, "scheduler", fake)
    configure = MagicMock()
    monkeypatch.setattr(sched, "configure_scheduler", configure)

    async with main_mod.lifespan(main_mod.app):
        assert beats == ["started"]

    assert beats == ["started", "stopped"]
    fake.start.assert_not_called()
    configure.assert_not_called()


@pytest.mark.asyncio
async def test_the_worker_starts_the_scheduler_and_its_heartbeat(monkeypatch):
    import backend.db_schema as db_schema
    import backend.scheduler as sched
    import backend.statement_timeout as statement_timeout
    from backend import worker
    from backend.analyzer import llm_cost

    beats = []
    monkeypatch.setattr(db_schema, "check_schema_at_head", lambda: None)
    monkeypatch.setattr(statement_timeout, "install", lambda _engine: None)
    monkeypatch.setattr(jm, "start_heartbeat", _fake_heartbeat(beats))
    monkeypatch.setattr(llm_cost, "refresh_openrouter_prices", _noop)
    fake = MagicMock()
    monkeypatch.setattr(sched, "scheduler", fake)
    configure = MagicMock()
    monkeypatch.setattr(sched, "configure_scheduler", configure)

    stop = asyncio.Event()
    stop.set()
    await worker.run(stop)

    assert beats == ["started", "stopped"]
    configure.assert_called_once_with()
    fake.start.assert_called_once_with()
    fake.shutdown.assert_called_once_with()


def test_the_schedule_includes_the_settings_reload_and_the_inbox_jobs(test_db, fresh_scheduler):
    import backend.scheduler as sched
    sched.configure_scheduler()
    ids = {job.id for job in fresh_scheduler.get_jobs()}
    assert {sched.SCHEDULE_RELOAD_JOB_ID, "candidate_email_classification", "candidate_email_other_retention",
            "candidate_google_grant_cleanup"} <= ids


# ── A setting saved through the API reaches the worker ──────────────────────

def test_an_unchanged_schedule_is_not_reconfigured(test_db, fresh_scheduler, monkeypatch):
    import backend.scheduler as sched
    _set(test_db, "backup_cron", "0 3 * * *")
    sched.configure_scheduler()
    calls = []
    monkeypatch.setattr(sched, "configure_scheduler", lambda: calls.append(1))
    assert sched.reload_schedule_if_changed() is False
    assert calls == []


def test_a_changed_cron_is_applied_by_the_next_reload(test_db, fresh_scheduler):
    import backend.scheduler as sched
    _set(test_db, "backup_cron", "0 3 * * *")
    sched.configure_scheduler()
    assert "hour='3'" in str(fresh_scheduler.get_job("db_backup").trigger)

    _set(test_db, "backup_cron", "0 5 * * *")
    assert sched.reload_schedule_if_changed() is True
    assert "hour='5'" in str(fresh_scheduler.get_job("db_backup").trigger)
    assert fresh_scheduler.get_job(sched.SCHEDULE_RELOAD_JOB_ID) is not None   # the reload keeps itself scheduled
    assert sched.reload_schedule_if_changed() is False


def test_the_candidate_inbox_interval_is_reloaded_too(test_db, fresh_scheduler):
    """It was never in the API's reconfigure list, so a change used to wait for a restart."""
    import backend.scheduler as sched
    _set(test_db, "candidate_gmail_sync_interval_minutes", "5")
    sched.configure_scheduler()
    assert fresh_scheduler.get_job("candidate_inbox_sync") is not None

    _set(test_db, "candidate_gmail_sync_interval_minutes", "0")
    assert sched.reload_schedule_if_changed() is True
    assert fresh_scheduler.get_job("candidate_inbox_sync") is None


# ── A run is failed only once its process stopped (the heartbeat) ──────────

def _hold(run_id, job_type):
    """This process holds the run, as launch_background or tracked_run would."""
    jm._running[job_type] = jm.RunningJob(run_id=run_id, job_type=job_type, trigger="manual",
                                          started_at=datetime.now(timezone.utc))


def test_a_beat_stamps_the_runs_this_process_holds(test_db):
    held = _run(test_db, "db_backup", "manual", minutes_ago=30)
    other = _run(test_db, "email_check", "scheduler", minutes_ago=30)
    _hold(held, "db_backup")
    assert jm.stamp_held_runs() == 1
    test_db.expire_all()
    assert "seen_at" in test_db.get(JobRun, held).meta
    assert test_db.get(JobRun, other).meta is None


def test_a_live_copy_keeps_its_runs_through_another_copy_starting(test_db):
    """The deploy case: the old copy is still finishing (it stamped 30 s ago) while the new one starts."""
    live = _run(test_db, "resume_tailor", "manual", minutes_ago=5, seen_minutes_ago=0.5)
    assert jm.cleanup_stale_runs() == 0
    assert _status(test_db, live) == "running"


def test_a_stopped_process_runs_are_failed_after_two_minutes_of_silence(test_db):
    stopped = _run(test_db, "resume_tailor", "manual", minutes_ago=10, seen_minutes_ago=3)
    never_stamped = _run(test_db, "email_check", "scheduler", minutes_ago=3)
    just_started = _run(test_db, "db_backup", "manual", minutes_ago=0.5)
    assert jm.cleanup_stale_runs() == 2
    assert _status(test_db, stopped) == "failed" and _status(test_db, never_stamped) == "failed"
    assert _status(test_db, just_started) == "running"
    test_db.expire_all()
    assert test_db.get(JobRun, stopped).error == "Process restarted"


def test_a_beat_keeps_this_process_long_runs_alive(test_db):
    """A beat stamps before it sweeps, so a long run its own process holds is never failed."""
    mine = _run(test_db, "db_backup", "manual", minutes_ago=45)
    _hold(mine, "db_backup")
    jm.beat_once()
    assert _status(test_db, mine) == "running"


def test_the_heartbeat_thread_beats_at_once_and_stops(test_db):
    stopped = _run(test_db, "email_check", "scheduler", minutes_ago=5)
    stop = jm.start_heartbeat()
    try:
        for _ in range(50):
            if _status(test_db, stopped) == "failed":
                break
            time.sleep(0.1)
    finally:
        stop()
    assert _status(test_db, stopped) == "failed"


def test_the_inbox_rows_are_left_to_their_own_recovery(test_db):
    """An import is finalized by recover_imports; the classifier's pause is a state, and failing it would clear it."""
    rows = [_run(test_db, "candidate_gmail_import", "scheduler", minutes_ago=60),
            _run(test_db, "candidate_email_classifier_pause", "scheduler", minutes_ago=60)]
    assert jm.cleanup_stale_runs() == 0
    assert [_status(test_db, r) for r in rows] == ["running", "running"]


def test_a_classification_is_failed_only_well_past_its_lease(test_db):
    """Either process claims classifications, outside `_running`, so they are never stamped; a fresh one may be live."""
    fresh = _run(test_db, "candidate_email_classification", "scheduler", minutes_ago=5)
    old = _run(test_db, "candidate_email_classification", "scheduler", minutes_ago=20)
    assert jm.cleanup_stale_runs() == 1
    assert _status(test_db, old) == "failed" and _status(test_db, fresh) == "running"


# ── A shared job type runs once at a time across both processes ─────────────

@pytest.mark.asyncio
async def test_a_manual_trigger_is_refused_while_the_worker_runs_that_job(test_db):
    """The worker's run is invisible to the API's memory; its row is not."""
    worker_run = _run(test_db, "email_check", "scheduler")
    with pytest.raises(jm.JobAlreadyRunningError) as refused:
        jm.launch_background("email_check", _noop)
    assert refused.value.elapsed_seconds >= 59
    assert test_db.query(JobRun).filter(JobRun.job_type == "email_check").count() == 1

    test_db.get(JobRun, worker_run).status = "completed"
    test_db.commit()
    run_id = jm.launch_background("email_check", _noop)
    await jm._running["email_check"].task
    assert _status(test_db, uuid.UUID(run_id)) == "completed"


@pytest.mark.asyncio
async def test_a_scheduled_run_is_skipped_while_a_manual_one_runs_in_the_api(test_db):
    _run(test_db, "db_backup", "manual")
    with pytest.raises(jm.JobAlreadyRunningError):
        async with jm.tracked_run("db_backup", "scheduler"):
            pytest.fail("the scheduled backup must not start")
    assert test_db.query(JobRun).filter(JobRun.job_type == "db_backup").count() == 1


@pytest.mark.asyncio
async def test_a_job_type_only_one_process_runs_is_not_claimed(test_db):
    """Per-firm and per-scope runs (a tailoring, a search) stay with the in-memory check."""
    _run(test_db, "search_run", "manual")
    run_id = jm.launch_background("search_run", _noop, scope_key="other")
    await jm._running["search_run:other"].task
    assert _status(test_db, uuid.UUID(run_id)) == "completed"


# ── /api/monitor/active shows every process's runs ──────────────────────────

def test_monitor_active_lists_a_run_another_process_holds(test_db, api_client):
    """The worker's scheduled run is only in `job_runs`, not in the API's memory."""
    theirs = _run(test_db, "email_check", "scheduler", minutes_ago=2)
    body = api_client.get("/api/monitor/active").json()
    assert [r["run_id"] for r in body] == [str(theirs)]
    row = body[0]
    assert (row["job_type"], row["trigger"], row["scope_key"], row["company_id"], row["target_job_id"]) == (
        "email_check", "scheduler", None, None, None)
    assert row["elapsed_seconds"] >= 119
    assert set(row) == {"run_id", "job_type", "trigger", "started_at", "elapsed_seconds", "scope_key",
                        "target_job_id", "company_id"}


def test_monitor_active_lists_a_run_this_process_holds_once_with_its_detail(test_db, api_client):
    mine = _run(test_db, "search_run", "manual")
    jm._running["search_run:scope-1"] = jm.RunningJob(run_id=mine, job_type="search_run", trigger="manual",
                                                      started_at=datetime.now(timezone.utc), scope_key="scope-1")
    body = api_client.get("/api/monitor/active").json()
    assert [(r["run_id"], r["scope_key"]) for r in body] == [(str(mine), "scope-1")]


def test_monitor_active_leaves_out_the_classifier_pause_and_finished_runs(test_db, api_client):
    _run(test_db, "candidate_email_classifier_pause", "scheduler", minutes_ago=60)
    _run(test_db, "db_backup", "scheduler", status="completed")
    _run(test_db, "email_check", "scheduler", status="failed")
    importing = _run(test_db, "candidate_gmail_import", "scheduler")
    body = api_client.get("/api/monitor/active").json()
    assert [r["run_id"] for r in body] == [str(importing)]
