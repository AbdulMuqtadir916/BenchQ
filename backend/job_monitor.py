"""Job execution monitor — tracks running state and run history (Hangfire-style)."""
import asyncio
import contextvars
import logging
import re
import threading
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import text

from backend.logging_setup import request_id as log_request_id, run_id as log_run_id
from backend.models.db import SessionLocal, JobRun, Setting
from backend.statement_timeout import leave_web_request

logger = logging.getLogger("jobnavigator.monitor")


# ── Background concurrency limiters ────────────────────────────────────────
# One place decides how many background tasks of a kind may run at once. The
# gate is taken in launch_background's wrapper — BEFORE the worker opens its
# first DB session — so N queued tasks cost N cheap coroutines, not N pooled
# connections. Scoring 80 jobs used to fan out 80 tasks that each opened a
# session and then waited minutes on the LLM, which drained the QueuePool and
# left even /health unable to get a connection.


class TaskLimiter:
    """A named concurrency gate, re-entrant within one task.

    Re-entrancy matters because the same limit is enforced at two levels: the
    launcher takes it for a whole background run, and helpers such as
    `cv_scorer.score_job_sync` take it for their own LLM call (they are also
    reachable outside launch_background). A plain Semaphore would deadlock on
    the inner acquire; here the inner `async with` just bumps a per-task depth.
    """

    def __init__(self, name: str, value: int):
        self.name = name
        self.value = max(1, int(value))
        self._sem = asyncio.Semaphore(self.value)
        self._loop = None
        self._depth: contextvars.ContextVar[int] = contextvars.ContextVar(
            f"jn_limiter_{name}", default=0
        )

    def _semaphore(self) -> asyncio.Semaphore:
        # An asyncio.Semaphore binds to the loop that first blocks on it. The
        # app has one loop, but the test suite runs each case in a fresh one,
        # so rebind rather than raising "bound to a different event loop".
        loop = asyncio.get_running_loop()
        if self._loop is not loop:
            self._sem = asyncio.Semaphore(self.value)
            self._loop = loop
        return self._sem

    async def __aenter__(self):
        depth = self._depth.get()
        if depth == 0:
            await self._semaphore().acquire()
        self._depth.set(depth + 1)
        return self

    async def __aexit__(self, *exc_info):
        depth = self._depth.get() - 1
        self._depth.set(depth)
        if depth == 0:
            self._sem.release()
        return False


# name -> (settings key that carries the limit, fallback when unset/unreadable)
_LIMIT_SOURCES: dict[str, tuple[Optional[str], int]] = {
    "scoring": ("scoring_max_concurrent", 5),
    "tailoring": ("tailoring_max_concurrent", 2),
    # Page caching is httpx + BeautifulSoup and, on thin pages, a whole
    # Chromium. Four at a time is the difference between ~300 MB and the 2.5 GB
    # the box hit; it is deliberately not user-tunable.
    "page_cache": (None, 4),
    # A BDE's job search (backend/job_search/): one HTTP call to the source and a short write. Four at once per
    # worker; the rest queue here (decided 2026-11-10).
    "job_search": (None, 4),
    # A résumé tailoring (backend/resume_tailor/): five model calls, about a minute, waiting on the model. It holds no
    # database connection while it waits, so the limit is the model account's (decided 2026-11-12: 40 per worker).
    "resume_tailor": ("resume_tailor_max_concurrent", 40),
    # One résumé parse: one model call. Ten at once per backend process; the rest wait (decided 2026-11-22).
    "resume_parse": ("resume_parse_max_concurrent", 10),
}

# Which gate a launch_background job_type belongs to. Anything absent runs
# unlimited — scrapes and backups are already deduped by scope key.
_JOB_TYPE_LIMITER: dict[str, str] = {
    "analyze_job": "scoring",
    "score_resume": "scoring",
    "generate_cover_letter": "tailoring",
    "cache_job_page": "page_cache",
    "job_search": "job_search",
    "resume_tailor": "resume_tailor",
}

_limiters: dict[str, TaskLimiter] = {}


def _resolve_limit(name: str) -> int:
    setting_key, fallback = _LIMIT_SOURCES.get(name, (None, 4))
    if not setting_key:
        return fallback
    try:
        db = SessionLocal()
        try:
            row = db.query(Setting).filter(Setting.key == setting_key).first()
            return max(1, int(row.value)) if row and row.value else fallback
        finally:
            db.close()
    except Exception:
        return fallback


def get_limiter(name: str) -> TaskLimiter:
    """The process-wide gate called `name`, created on first use."""
    limiter = _limiters.get(name)
    if limiter is None:
        limiter = TaskLimiter(name, _resolve_limit(name))
        _limiters[name] = limiter
        logger.info("Background limiter '%s' initialized: max %d concurrent",
                    name, limiter.value)
    return limiter


def reset_limiter(name: Optional[str] = None) -> None:
    """Drop cached limiters so the next use re-reads its limit from settings."""
    if name is None:
        _limiters.clear()
    else:
        _limiters.pop(name, None)


def limiter_for_job_type(job_type: str) -> Optional[TaskLimiter]:
    name = _JOB_TYPE_LIMITER.get(job_type)
    return get_limiter(name) if name else None

# ── In-memory running state ────────────────────────────────────────────────


@dataclass
class RunningJob:
    run_id: uuid.UUID
    job_type: str
    trigger: str
    started_at: datetime
    task: Optional[asyncio.Task] = None
    scope_key: Optional[str] = None
    target_job_id: Optional[uuid.UUID] = None
    # The Company this run targets, when it has one (company_scrape); carried separately from
    # scope_key so the dashboard can match a running scrape to a row by id, not by name+time.
    company_id: Optional[str] = None
    # "What this run did", shown in Stats > Run history; set via `run.summary = ...` in
    # tracked_run, or by a launch_background coroutine returning a string.
    summary: Optional[str] = None
    # Same dict stored on the JobRun row: what this run is about (which résumés a
    # scoring run covers, which base a tailor copies from). Read by /monitor/in-flight?detail=1.
    meta: Optional[dict] = None


# Keyed by dedup key (e.g. "scrape_all" or "company_scrape:<uuid>")
_running: dict[str, RunningJob] = {}


def _make_key(job_type: str, scope_key: Optional[str] = None) -> str:
    if scope_key:
        return f"{job_type}:{scope_key}"
    return job_type


# ── "Finished, but it did not work" ────────────────────────────────────────
# Some tracked coroutines swallow their own exception and return a human summary
# instead ("Scoring failed" when the LLM provider is down). The run then reads as
# `completed` in Stats and as an OK toast in the dashboard, and the outage is
# only visible in llm_call_log (R4-T1-28). A coroutine calls mark_run_failed()
# to say "keep my summary, but this run failed, and here is why".
#
# A ContextVar keeps it per-task: launch_background's wrapper runs in its own
# task context, and each scheduled job owns its own too, so two concurrent runs
# never see each other's reason.
_run_failure: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "jn_run_failure", default=None
)


# A DBAPI error string carries the failed statement, its bound parameters and
# the driver module path. JobRun.error stored all three, and
# /api/monitor/history returned them to the browser. Reduce the text to the
# message before it is stored, and again before it is returned, because rows
# written before this fix still hold the raw string.
MAX_RUN_ERROR_CHARS = 1000
_SQL_BLOCK = "[SQL:"
_DRIVER_PREFIX_RE = re.compile(r"^\((?:\w+\.)+(\w+)\)\s*")


def sanitize_run_error(error: Optional[str]) -> Optional[str]:
    """Return the message of a run error without the SQL, the parameters or the driver module path."""
    if error is None:
        return None
    text = str(error).split(_SQL_BLOCK, 1)[0].strip()
    text = _DRIVER_PREFIX_RE.sub(r"\1: ", text)
    if len(text) > MAX_RUN_ERROR_CHARS:
        text = text[:MAX_RUN_ERROR_CHARS].rstrip() + "..."
    return text or None


def mark_run_failed(reason: str) -> None:
    """Flag the currently tracked run as failed while still returning a summary."""
    if reason:
        _run_failure.set(str(reason)[:MAX_RUN_ERROR_CHARS])


def _take_run_failure() -> Optional[str]:
    reason = _run_failure.get()
    _run_failure.set(None)
    return reason


class JobAlreadyRunningError(Exception):
    def __init__(self, job_type: str, elapsed_seconds: float):
        self.job_type = job_type
        self.elapsed_seconds = elapsed_seconds
        super().__init__(
            f"{job_type} is already running ({elapsed_seconds:.0f}s elapsed)"
        )


def is_running(job_type: str, scope_key: Optional[str] = None) -> Optional[RunningJob]:
    return _running.get(_make_key(job_type, scope_key))


def get_all_running() -> list[dict]:
    now = datetime.now(timezone.utc)
    return [
        {
            "run_id": str(r.run_id),
            "job_type": r.job_type,
            "trigger": r.trigger,
            "started_at": r.started_at.isoformat(),
            "elapsed_seconds": round((now - r.started_at).total_seconds(), 1),
            "scope_key": r.scope_key,
            "target_job_id": str(r.target_job_id) if r.target_job_id else None,
            "company_id": str(r.company_id) if r.company_id else None,
        }
        for r in _running.values()
    ]


def get_all_active() -> list[dict]:
    """Every process's running jobs, for /api/monitor/active: this process's own (`get_all_running`, with its
    in-memory detail), then the `running` rows in `job_runs` it doesn't hold: the worker's scheduled runs, another
    API copy's (production layer step 3). Such a row has no scope_key or company_id (they aren't stored). The
    classifier's pause row is left out: it stays `running` while paused, a state, not a job. `get_all_running` stays
    this process's only: the tailor's stamp reads it to know which runs it holds."""
    own = get_all_running()
    held = {r["run_id"] for r in own}
    now = datetime.now(timezone.utc)
    db = SessionLocal()
    try:
        rows = (db.query(JobRun)
                .filter(JobRun.status == "running", JobRun.job_type != "candidate_email_classifier_pause")
                .order_by(JobRun.started_at).all())
        others = []
        for row in rows:
            if str(row.id) in held:
                continue
            started = row.started_at if row.started_at.tzinfo else row.started_at.replace(tzinfo=timezone.utc)
            others.append({
                "run_id": str(row.id),
                "job_type": row.job_type,
                "trigger": row.trigger,
                "started_at": started.isoformat(),
                "elapsed_seconds": round((now - started).total_seconds(), 1),
                "scope_key": None,
                "target_job_id": str(row.target_job_id) if row.target_job_id else None,
                "company_id": None,
            })
        db.commit()
    finally:
        db.close()
    return own + others


def _get_running_by_job_type(job_type: str) -> Optional[dict]:
    """Check if any job with the given job_type is running (ignoring scope_key)."""
    for key, r in _running.items():
        if r.job_type == job_type:
            now = datetime.now(timezone.utc)
            return {
                "run_id": str(r.run_id),
                "elapsed_seconds": round((now - r.started_at).total_seconds(), 1),
            }
    return None


# ── DB helpers ──────────────────────────────────────────────────────────────


# ── Several processes, one table (production layer step 3) ─────────────────
# The API (backend/main.py, possibly several copies, and two side by side during a deploy) and the scheduler's worker
# (backend/worker.py) are separate processes, so `_running` above only knows its own process's runs. What crosses the
# process line is decided from the `job_runs` table.

# Job types the API starts by hand (main.py's trigger routes) and the worker on a timer (scheduler.py). One run at a
# time across all processes: claimed in the database, since no process sees another's `_running`.
SHARED_JOB_TYPES = frozenset({
    "scrape_all", "email_check", "daily_digest", "h1b_refresh", "auto_reject", "job_cleanup", "db_backup",
})

# Who is still alive: every process stamps `meta.seen_at` on the runs it holds every STAMP_EVERY_SECONDS, from its own
# thread (`start_heartbeat`), and a `running` row nobody stamped for SILENT_FOR belongs to a process that stopped.
# Decided 2026-11-14 with Uzair; the same rule as the résumé tailor's (tailoring.md Q10b), whose stamp this
# generalises. A restarting process can't tell a dead process's rows from a live copy's by "I just started", so the
# old startup clean-up failed both.
STAMP_EVERY_SECONDS = 30
SILENT_FOR = timedelta(minutes=2)

# The candidate inbox's rows recover on their own, by lease (Samad, PR 4), and aren't held in `_running`: an import is
# finalized by `inbox.import_progress.recover_imports` (the worker, every 5 minutes); the classifier's pause is a
# state, not a run, and failing it would clear the pause; a command row is written completed.
_SELF_RECOVERING_JOB_TYPES = frozenset({
    "candidate_gmail_import", "candidate_email_classifier_pause", "candidate_email_command",
})
# A classification is claimed in either process (the worker's sweep, or `wake_worker` from a route) under a 2-minute
# lease on its email, outside `_running`, so it is never stamped. A row still running well past that lease is a dead
# process's.
_CLASSIFICATION_JOB_TYPE = "candidate_email_classification"
CLASSIFICATION_STALE_AFTER = timedelta(minutes=10)


def _claim_shared_job_type(db, job_type: str) -> None:
    """Refuse a second run of a shared job type while one is running in either process.

    The transaction-scoped advisory lock makes check-and-insert one step: a second caller waits for the first one's
    commit, then sees its row. The row is the claim, so no connection is held for the length of the run. A row left
    `running` by a dead process blocks until it goes silent and is failed (`cleanup_stale_runs`, about 2 minutes)."""
    db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"), {"key": f"benchq.job_runs:{job_type}"})
    live = (db.query(JobRun).filter(JobRun.job_type == job_type, JobRun.status == "running")
            .order_by(JobRun.started_at).first())
    if live is not None:
        started = live.started_at if live.started_at.tzinfo else live.started_at.replace(tzinfo=timezone.utc)
        raise JobAlreadyRunningError(job_type, (datetime.now(timezone.utc) - started).total_seconds())


def _insert_job_run(
    run_id: uuid.UUID,
    job_type: str,
    trigger: str,
    meta: Optional[dict],
    target_job_id: Optional[uuid.UUID] = None,
    firm_id: Optional[uuid.UUID] = None,
) -> None:
    """Write the run's `running` row; raises JobAlreadyRunningError for a shared job type already running anywhere."""
    db = SessionLocal()
    try:
        if job_type in SHARED_JOB_TYPES:
            _claim_shared_job_type(db, job_type)
        run = JobRun(
            id=run_id,
            job_type=job_type,
            trigger=trigger,
            status="running",
            meta=meta,
            target_job_id=target_job_id,
            firm_id=firm_id,
        )
        db.add(run)
        db.commit()
    finally:
        db.close()


def _finish_job_run(run_id: uuid.UUID, status: str, result_summary: Optional[str], error: Optional[str]) -> None:
    db = SessionLocal()
    try:
        run = db.query(JobRun).filter(JobRun.id == run_id).first()
        if run:
            now = datetime.now(timezone.utc)
            run.status = status
            run.finished_at = now
            # SQLite (tests) hands back naive datetimes; treat them as UTC
            started = run.started_at if run.started_at.tzinfo else run.started_at.replace(tzinfo=timezone.utc)
            run.duration_seconds = round((now - started).total_seconds(), 1)
            run.result_summary = result_summary
            run.error = sanitize_run_error(error)
            db.commit()
    finally:
        db.close()


def _held_run_ids() -> list[str]:
    """The ids of the runs this process holds; read from the heartbeat's thread while the loop may change `_running`."""
    for _ in range(3):
        try:
            return [str(r.run_id) for r in list(_running.values())]
        except RuntimeError:  # the dict changed size while it was copied
            continue
    return []


def stamp_held_runs() -> int:
    """Stamp `meta.seen_at` on the `running` rows this process holds; returns how many ids it stamped."""
    ids = _held_run_ids()
    if not ids:
        return 0
    db = SessionLocal()
    try:
        # A run started without meta stores JSON null, not SQL NULL: `null || {...}` would make an array, losing
        # `seen_at`, so anything but an object starts from {}.
        db.execute(text("UPDATE job_runs SET meta = ((CASE WHEN jsonb_typeof(meta::jsonb) = 'object' "
                        "THEN meta::jsonb ELSE '{}'::jsonb END) || "
                        "jsonb_build_object('seen_at', CAST(:seen AS text)))::json "
                        "WHERE id = ANY(CAST(:ids AS uuid[])) AND status = 'running'"),
                   {"seen": datetime.now(timezone.utc).isoformat(), "ids": ids})
        db.commit()
        return len(ids)
    finally:
        db.close()


def cleanup_stale_runs() -> int:
    """Fail the `running` rows whose process stopped: not stamped for SILENT_FOR (a row never stamped counts from its
    start). Safe from any process, at any time, as often as wanted: a live process's rows are always fresh. The inbox's
    self-recovering rows are left to their own recovery; a classification is failed once well past its claim lease.
    A tailoring failed here (no error code) reads as `lost` (resume_tailor/runs.py)."""
    now = datetime.now(timezone.utc)
    db = SessionLocal()
    try:
        failed = db.execute(text(
            "UPDATE job_runs SET status = 'failed', finished_at = :now, error = 'Process restarted', "
            "duration_seconds = ROUND(CAST(EXTRACT(EPOCH FROM (CAST(:now AS timestamptz) - started_at)) AS numeric), 1) "
            "WHERE status = 'running' AND ("
            "  (job_type <> ALL(CAST(:quiet AS text[])) "
            "   AND COALESCE(CAST(meta::jsonb ->> 'seen_at' AS timestamptz), started_at) < :silent_since) "
            "  OR (job_type = :classification AND started_at < :classification_since)) "
            "RETURNING id"),
            {"now": now, "silent_since": now - SILENT_FOR,
             "quiet": sorted(_SELF_RECOVERING_JOB_TYPES | {_CLASSIFICATION_JOB_TYPE}),
             "classification": _CLASSIFICATION_JOB_TYPE,
             "classification_since": now - CLASSIFICATION_STALE_AFTER}).fetchall()
        db.commit()
        if failed:
            logger.info("Failed %d job run(s) whose process stopped", len(failed))
        return len(failed)
    finally:
        db.close()


def beat_once() -> None:
    """One heartbeat: stamp this process's runs, then fail any process's silent ones."""
    stamp_held_runs()
    cleanup_stale_runs()


def start_heartbeat():
    """Start this process's heartbeat on its own thread (a run that blocks the event loop can't silence it); returns
    the function that stops it. The first beat is at once, so a restart fails the dead process's silent rows."""
    stopping = threading.Event()

    def _loop():
        while True:
            try:
                beat_once()
            except Exception as e:  # a missed beat is retried; four in a row make this process's runs look stopped
                logger.warning("Job heartbeat failed (%s)", type(e).__name__)
            if stopping.wait(STAMP_EVERY_SECONDS):
                return

    thread = threading.Thread(target=_loop, name="job-heartbeat", daemon=True)
    thread.start()

    def stop() -> None:
        stopping.set()
        thread.join(timeout=5)
    return stop


# ── Context manager for scheduler use ──────────────────────────────────────


@asynccontextmanager
async def tracked_run(
    job_type: str,
    trigger: str = "scheduler",
    scope_key: Optional[str] = None,
    meta: Optional[dict] = None,
    target_job_id: Optional[uuid.UUID] = None,
    company_id: Optional[str] = None,
):
    """Async context manager: tracks a job run in-memory + DB. Raises JobAlreadyRunningError on duplicate."""
    # Background work gets the background statement timeout, even when the scheduler was reconfigured from a request.
    leave_web_request()
    key = _make_key(job_type, scope_key)

    existing = _running.get(key)
    if existing:
        elapsed = (datetime.now(timezone.utc) - existing.started_at).total_seconds()
        raise JobAlreadyRunningError(job_type, elapsed)

    run_id = uuid.uuid4()
    _insert_job_run(run_id, job_type, trigger, meta, target_job_id=target_job_id)
    # Its log lines carry the run's id (job_runs.id). A scheduled run isn't part of any request, even when the
    # scheduler was woken from one.
    log_tokens = [log_run_id.set(str(run_id))]
    if trigger == "scheduler":
        log_tokens.append(log_request_id.set(None))

    running_job = RunningJob(
        run_id=run_id,
        job_type=job_type,
        trigger=trigger,
        started_at=datetime.now(timezone.utc),
        scope_key=scope_key,
        target_job_id=target_job_id,
        company_id=company_id,
        meta=meta,
    )
    _running[key] = running_job

    try:
        _run_failure.set(None)
        yield running_job
        reason = _take_run_failure()
        _finish_job_run(run_id, "failed" if reason else "completed",
                        running_job.summary, reason)
    except Exception as e:
        _finish_job_run(run_id, "failed", None, str(e))
        raise
    finally:
        _running.pop(key, None)
        log_run_id.reset(log_tokens[0])
        if len(log_tokens) > 1:
            log_request_id.reset(log_tokens[1])


# ── Background launcher for manual triggers ────────────────────────────────


def launch_background(
    job_type: str,
    coro_func,
    trigger: str = "manual",
    scope_key: Optional[str] = None,
    meta: Optional[dict] = None,
    func_args: tuple = (),
    func_kwargs: Optional[dict] = None,
    target_job_id: Optional[uuid.UUID] = None,
    company_id: Optional[str] = None,
    firm_id: Optional[uuid.UUID] = None,
) -> str:
    """Launch a coroutine as a background asyncio.Task with tracking; returns run_id immediately, raising JobAlreadyRunningError if already running.
    `firm_id` is stored on the run's row for a run a firm started (a résumé tailoring), so the firm can read it."""
    key = _make_key(job_type, scope_key)

    existing = _running.get(key)
    if existing:
        elapsed = (datetime.now(timezone.utc) - existing.started_at).total_seconds()
        raise JobAlreadyRunningError(job_type, elapsed)

    run_id = uuid.uuid4()
    _insert_job_run(run_id, job_type, trigger, meta, target_job_id=target_job_id, firm_id=firm_id)

    started_at = datetime.now(timezone.utc)

    async def _wrapper():
        # The task copied the launching request's context; its queries get the background statement timeout.
        leave_web_request()
        # Its log lines carry the run's id, and keep the id of the request that started it.
        log_run_id.set(str(run_id))
        try:
            _run_failure.set(None)
            # The gate is taken here, before the worker runs, so a queued task
            # holds nothing but itself — no DB connection, no LLM slot.
            limiter = limiter_for_job_type(job_type)
            if limiter is None:
                result = await coro_func(*(func_args or ()), **(func_kwargs or {}))
            else:
                async with limiter:
                    result = await coro_func(*(func_args or ()), **(func_kwargs or {}))
            # A coroutine that returns a string is describing what it did.
            summary = result.strip() if isinstance(result, str) and result.strip() else None
            # …but it may also have reported a failure it handled itself.
            reason = _take_run_failure()
            _finish_job_run(run_id, "failed" if reason else "completed", summary, reason)
        except Exception as e:
            logger.error(f"Background job {job_type} failed: {e}")
            _finish_job_run(run_id, "failed", None, str(e))
        finally:
            _running.pop(key, None)

    task = asyncio.create_task(_wrapper())

    _running[key] = RunningJob(
        run_id=run_id,
        job_type=job_type,
        trigger=trigger,
        started_at=started_at,
        task=task,
        scope_key=scope_key,
        target_job_id=target_job_id,
        company_id=company_id,
        meta=meta,
    )

    return str(run_id)
