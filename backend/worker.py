"""The scheduler's own process (production layer step 3, docs/team/uzair.md): `python -m backend.worker`.

The scheduler keeps its job list in memory, so every process that starts one runs every job: two API workers, or the
old and the new API side by side during a deploy, would classify each email twice and run two backups at once. So the
API (backend/main.py) never starts it, and this process runs it, as exactly one copy. The API can then run as many
workers as it needs.

What crosses the process line: a schedule setting saved through the API reaches this process by
`scheduler.reload_schedule_if_changed` (every minute); a run of a job type both processes start
(`job_monitor.SHARED_JOB_TYPES`) is claimed in `job_runs`, so a manual trigger and a scheduled run never overlap; and
each process stamps the runs it holds (`job_monitor.start_heartbeat`), so a restart fails only a stopped process's runs.
"""
import asyncio
import logging
import signal

from backend.logging_setup import configure_logging

logger = logging.getLogger("jobnavigator.worker")

# Stops this process's heartbeat (job_monitor.start_heartbeat); set by start().
_stop_heartbeat = None


def start() -> None:
    """Startup checks, then the scheduler. Mirrors the API's start (main.py `lifespan`) for what the jobs need."""
    from backend import startup_checks, statement_timeout

    # The settings first (backend/startup_checks.py). The inbox jobs decrypt mailbox tokens, so a missing or bad Gmail
    # key stops this process here, not mid-sync; in production the AI key's secret too.
    startup_checks.require_config("worker")
    from backend.db_schema import check_schema_at_head
    from backend.job_monitor import start_heartbeat
    from backend.models.db import engine
    from backend.scheduler import configure_scheduler, scheduler

    statement_timeout.install(engine)
    check_schema_at_head()
    global _stop_heartbeat
    _stop_heartbeat = start_heartbeat()
    configure_scheduler()
    scheduler.start()
    logger.info("Worker started: scheduler running.")


def stop() -> None:
    from backend.scheduler import scheduler
    scheduler.shutdown()
    if _stop_heartbeat is not None:
        _stop_heartbeat()
    logger.info("Worker stopped.")


async def run(stop_event: asyncio.Event | None = None) -> None:
    """Run until SIGTERM/SIGINT (or until `stop_event` is set, for tests)."""
    stop_event = stop_event or asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, stop_event.set)
        except (NotImplementedError, RuntimeError):  # Windows, or not the main thread
            pass
    start()
    # Prices for the AI cost the classifier logs (non-fatal), as the API does at its start.
    try:
        from backend.analyzer.llm_cost import refresh_openrouter_prices
        await refresh_openrouter_prices(force=True)
    except Exception as e:
        logger.warning(f"OpenRouter price warmup failed: {e}")
    try:
        await stop_event.wait()
    finally:
        stop()


def main() -> None:
    configure_logging()
    asyncio.run(run())


if __name__ == "__main__":
    main()
