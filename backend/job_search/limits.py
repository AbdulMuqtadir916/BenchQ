"""The job search's daily caps (decided 2026-11-10), counted from rows, never stored:

- 100 **new** jobs per candidate per day: `job_postings` rows discovered since the day started. A job seen again only
  refreshes its row and doesn't count.
- 20 search attempts per BDE per day, any outcome: their `scrape_jobs` rows since the day started, plus a search of
  theirs still running (`job_runs`).

The day starts at 6:30 PM IST, the start of the BDE's shift, so one night's work is one day."""
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import func

from backend.models.db import JobRun, utcnow
from backend.models.job_search import JobPosting, ScrapeJob

JOBS_PER_CANDIDATE_PER_DAY = 100
ATTEMPTS_PER_BDE_PER_DAY = 20
JOBS_PER_SEARCH = 100            # always asked for, even with less room left (Q28)
JOB_TYPE = "job_search"          # job_runs.job_type
IST = ZoneInfo("Asia/Kolkata")
DAY_STARTS = time(18, 30)
# A job_runs row still `running` after this long is a worker that died without finishing it; it no longer blocks.
RUNNING_FOR_AT_MOST = timedelta(minutes=15)


def day_start(now: datetime | None = None) -> datetime:
    """The last 6:30 PM IST at or before `now`."""
    local = (now or utcnow()).astimezone(IST)
    start = datetime.combine(local.date(), DAY_STARTS, tzinfo=IST)
    return start if local >= start else start - timedelta(days=1)


def next_reset(now: datetime | None = None) -> datetime:
    return day_start(now) + timedelta(days=1)


def jobs_saved_today(db, firm_id, candidate_id, now: datetime | None = None) -> int:
    return db.query(func.count(JobPosting.id)).filter(
        JobPosting.firm_id == firm_id, JobPosting.candidate_id == candidate_id,
        JobPosting.discovered_at >= day_start(now)).scalar()


def _running(db, now: datetime | None = None):
    return db.query(JobRun).filter(JobRun.job_type == JOB_TYPE, JobRun.status == "running",
                                   JobRun.started_at >= (now or utcnow()) - RUNNING_FOR_AT_MOST)


def running_search(db, candidate_id, now: datetime | None = None) -> JobRun | None:
    """The candidate's search still running, on any worker."""
    return _running(db, now).filter(JobRun.meta["candidate_id"].as_string() == str(candidate_id)) \
        .order_by(JobRun.started_at.desc()).first()


def attempts_today(db, firm_id, user_id, now: datetime | None = None) -> int:
    finished = db.query(func.count(ScrapeJob.id)).filter(
        ScrapeJob.firm_id == firm_id, ScrapeJob.user_id == user_id,
        ScrapeJob.created_at >= day_start(now)).scalar()
    running = _running(db, now).filter(JobRun.meta["user_id"].as_string() == str(user_id)).count()
    return finished + running


def usage(db, firm_id, candidate_id, bde_id, now: datetime | None = None) -> dict:
    """Today's numbers for the candidate's search panel. `attempts_today` is the candidate's BDE's (None without one)."""
    return {
        "jobs_saved_today": jobs_saved_today(db, firm_id, candidate_id, now),
        "jobs_cap": JOBS_PER_CANDIDATE_PER_DAY,
        "attempts_today": attempts_today(db, firm_id, bde_id, now) if bde_id else None,
        "attempts_cap": ATTEMPTS_PER_BDE_PER_DAY,
        "resets_at": next_reset(now).isoformat(),
    }
