"""The job search's daily caps (decided 2026-11-10), counted from rows, never stored:

- 100 **new** jobs per candidate per day: `job_postings` rows discovered since the day started. A job seen again only
  refreshes its row and doesn't count.
- 20 search attempts per BDE per day, any outcome: their `scrape_jobs` rows started since the day started, running
  ones included.

A search's row is `running` while it runs (migration 0022). One left `running` by a restart or a dead worker is marked
`error` (`internal`) once it is older than `RUNNING_FOR_AT_MOST`: written, with its error code and ledger entry, when
the BDE next starts a search (`pipeline.expire_lost`); a read only shows it as that error (`is_lost`), since reads write
nothing (a support view reads too).
It never blocks the candidate.

The day starts at 6:30 PM IST, the start of the BDE's shift, so one night's work is one day."""
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import func, text

from backend.auth.scoping import scoped
from backend.models.db import utcnow
from backend.models.job_search import JobPosting, ScrapeJob

JOBS_PER_CANDIDATE_PER_DAY = 100
ATTEMPTS_PER_BDE_PER_DAY = 20
JOBS_PER_SEARCH = 100            # always asked for, even with less room left (Q28)
JOB_TYPE = "job_search"          # job_runs.job_type (the background launcher's own record of the task)
IST = ZoneInfo("Asia/Kolkata")
DAY_STARTS = time(18, 30)
# A search still `running` after this long was lost (a restart, a dead worker); it is marked `error` and stops blocking.
RUNNING_FOR_AT_MOST = timedelta(minutes=15)


def day_start(now: datetime | None = None) -> datetime:
    """The last 6:30 PM IST at or before `now`."""
    local = (now or utcnow()).astimezone(IST)
    start = datetime.combine(local.date(), DAY_STARTS, tzinfo=IST)
    return start if local >= start else start - timedelta(days=1)


def next_reset(now: datetime | None = None) -> datetime:
    return day_start(now) + timedelta(days=1)


def jobs_saved_today(db, firm_id, candidate_id, now: datetime | None = None) -> int:
    return scoped(db, JobPosting, firm_id, func.count(JobPosting.id)).filter(
        JobPosting.candidate_id == candidate_id, JobPosting.discovered_at >= day_start(now)).scalar()


def is_lost(batch: ScrapeJob, now: datetime | None = None) -> bool:
    return batch.state == "running" and batch.created_at < (now or utcnow()) - RUNNING_FOR_AT_MOST


def running_search(db, firm_id, candidate_id, now: datetime | None = None) -> ScrapeJob | None:
    """The candidate's search still running, whichever worker runs it (a lost one doesn't count)."""
    return scoped(db, ScrapeJob, firm_id).filter(
        ScrapeJob.candidate_id == candidate_id, ScrapeJob.state == "running",
        ScrapeJob.created_at >= (now or utcnow()) - RUNNING_FOR_AT_MOST,
    ).order_by(ScrapeJob.created_at.desc()).first()


def lock_bde(db, user_id) -> None:
    """Hold the BDE's admission lock until the transaction ends (a Postgres advisory lock on their id; the users row
    isn't touched). Taken after the candidate's row, in every route, so two of one BDE's searches for different
    candidates, on any worker, count the 20 attempts in turn (Abdul's review, P2)."""
    db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": _lock_key(user_id)})


def _lock_key(user_id) -> int:
    """A signed 64-bit key from the user's id, in its own namespace (the top bits say "job search BDE")."""
    import uuid as _uuid
    return ((0x4A53 << 48) | (_uuid.UUID(str(user_id)).int & 0xFFFFFFFFFFFF)) - (1 << 63)


def attempts_today(db, firm_id, user_id, now: datetime | None = None) -> int:
    """Searches the BDE started since the day started, whatever became of them: counted by start, once each."""
    return scoped(db, ScrapeJob, firm_id, func.count(ScrapeJob.id)).filter(
        ScrapeJob.user_id == user_id, ScrapeJob.created_at >= day_start(now)).scalar()


def usage(db, firm_id, candidate_id, bde_id, now: datetime | None = None) -> dict:
    """Today's numbers for the candidate's search panel. `attempts_today` is the candidate's BDE's (None without one)."""
    return {
        "jobs_saved_today": jobs_saved_today(db, firm_id, candidate_id, now),
        "jobs_cap": JOBS_PER_CANDIDATE_PER_DAY,
        "attempts_today": attempts_today(db, firm_id, bde_id, now) if bde_id else None,
        "attempts_cap": ATTEMPTS_PER_BDE_PER_DAY,
        "resets_at": next_reset(now).isoformat(),
    }
