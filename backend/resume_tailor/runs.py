"""A résumé tailoring as a background run (docs/team/tailoring.md §7, part 2; decided 2026-11-12).

The run's `job_runs` row is its record (no table of its own): `firm_id`, `target_job_id` (the posting) and `meta`
`{candidate_id, base_resume_id, job_posting_id, user_id}`, then `resume_id` and the report's counts, or `error_code`,
and the heartbeat `seen_at`. Every check reads those rows, so it holds with any number of workers.

    the route (`admit`, the candidate row locked):  the base, its v1, the posting and its text; expire lost runs;
        409 the same base and job running, 429 the BDE has MOST_RUNNING_PER_BDE running; then the launch
    the run (`run_tailoring`, in the tailor's gate):  read the inputs → tailor (five model calls, about a minute,
        no connection held) → finish with the candidate locked: the firm suspended, the candidate, base or posting
        gone, or the run already marked lost → no version; else the TAILORED version (v1, or the next of base + job),
        its autofill entries, the ledger entry, and the counts
    lost:  a running row not stamped for SILENT_FOR (each worker stamps its own every STAMP_EVERY_SECONDS), or running
        for RUNNING_FOR, is failed as `lost`. A failed row without a code (the startup clean-up's) reads as lost too.

Logs carry ids, codes and counts, never a résumé's or a posting's text.
"""
import asyncio
import copy
import json
import logging
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import func, text as sql

from backend.auth import ledger
from backend.auth.scoping import scoped
from backend.candidates import autofill, versions
from backend.candidates.values import text
from backend.job_monitor import get_all_running, mark_run_failed
from backend.job_search import providers
from backend.logging_setup import run_id as current_run_id
from backend.models.candidates import BaseResume, Candidate
from backend.models.db import JobRun, Resume, SessionLocal
from backend.models.job_search import JobPosting
from backend.models.tenancy import Firm, User
from backend.resume_tailor.pipeline import TailorFailed
from backend.resume_tailor.run import tailor_version
from backend.resume_tailor.settings import TailorSetupError, read_setup

logger = logging.getLogger(__name__)

JOB_TYPE = "resume_tailor"
MOST_RUNNING_PER_BDE = 5                       # decided 2026-11-12 (Q4c): a safety net; Focus mode keeps ~4 running
STAMP_EVERY_SECONDS = 30
SILENT_FOR = timedelta(minutes=2)              # decided 2026-11-12 (Q10b): not stamped this long → lost
RUNNING_FOR = timedelta(minutes=30)            # decided 2026-11-12 (Q9): the backstop
TAILORED_NAME = "Tailored"
# Why a run failed, besides the pipeline's provider_failed and unreadable_reply (decided 2026-11-12, Q8, Q5, Q11).
GONE, LOST, SETUP, INTERNAL = "gone", "lost", "setup", "internal"


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ── The run's row ────────────────────────────────────────────────────────────────────────────────────────────────────

def merge_meta(db, run_id, patch: dict) -> None:
    """Add `patch` to a run's meta in one statement: the heartbeat, the finish and a lost mark may write it at once."""
    db.execute(sql("UPDATE job_runs SET meta = (COALESCE(meta::jsonb, '{}'::jsonb) || CAST(:patch AS jsonb))::json "
                   "WHERE id = :id"), {"patch": json.dumps(patch), "id": str(run_id)})


def _running(db, firm_id) -> list:
    return scoped(db, JobRun, firm_id).filter(JobRun.job_type == JOB_TYPE, JobRun.status == "running").all()


def _last_seen(row: JobRun) -> datetime:
    seen = (row.meta or {}).get("seen_at")
    stamped = datetime.fromisoformat(seen) if seen else None
    started = row.started_at if row.started_at.tzinfo else row.started_at.replace(tzinfo=timezone.utc)
    return max(started, stamped) if stamped else started


def expire_lost(db, firm_id) -> int:
    """Fail the firm's tailorings that stopped being stamped, or ran too long, as `lost`. Returns how many."""
    now, lost = _now(), 0
    for row in _running(db, firm_id):
        started = row.started_at if row.started_at.tzinfo else row.started_at.replace(tzinfo=timezone.utc)
        if now - _last_seen(row) <= SILENT_FOR and now - started <= RUNNING_FOR:
            continue
        done = db.execute(sql("UPDATE job_runs SET status = 'failed', finished_at = :now, error = 'lost', "
                              "duration_seconds = :seconds WHERE id = :id AND status = 'running'"),
                          {"now": now, "seconds": round((now - started).total_seconds(), 1), "id": str(row.id)})
        if done.rowcount:
            merge_meta(db, row.id, {"error_code": LOST})
            lost += 1
    if lost:
        logger.warning("Résumé tailor: %d run(s) of firm %s marked lost", lost, firm_id)
    return lost


def stamp(db, run_ids: list) -> None:
    """This worker's running and queued tailorings are alive."""
    if run_ids:
        db.execute(sql("UPDATE job_runs SET meta = (COALESCE(meta::jsonb, '{}'::jsonb) || "
                       "jsonb_build_object('seen_at', CAST(:seen AS text)))::json "
                       "WHERE id = ANY(CAST(:ids AS uuid[])) AND status = 'running'"),
                   {"seen": _now().isoformat(), "ids": [str(i) for i in run_ids]})


def _stamp_now() -> None:
    ids = [r["run_id"] for r in get_all_running() if r["job_type"] == JOB_TYPE]
    if not ids:
        return
    db = SessionLocal()
    try:
        stamp(db, ids)
        db.commit()
    finally:
        db.close()


async def keep_stamping() -> None:
    """The worker's heartbeat (started with the app): every STAMP_EVERY_SECONDS, stamp the tailorings it holds."""
    while True:
        try:
            await asyncio.to_thread(_stamp_now)
        except Exception as e:                  # a missed stamp is retried; two in a row make the run look lost
            logger.warning("Résumé tailor: the heartbeat failed (%s)", type(e).__name__)
        await asyncio.sleep(STAMP_EVERY_SECONDS)


def run_json(row: JobRun) -> dict:
    """A tailoring's status as the screens read it: running, completed (with the résumé) or failed (with the reason).
    A failed row with no code was failed by the startup clean-up (the process restarted): lost."""
    meta = row.meta or {}
    code, resume_id = meta.get("error_code"), meta.get("resume_id")
    if code:
        status = "failed"
    elif resume_id:
        status = "completed"
    elif row.status == "running":
        status = "running"
    else:
        status, code = "failed", LOST if row.status == "failed" else INTERNAL
    return {"run_id": str(row.id), "status": status, "resume_id": resume_id, "error_code": code,
            "base_resume_id": meta.get("base_resume_id"), "job_posting_id": meta.get("job_posting_id"),
            "user_id": meta.get("user_id"),
            "started_at": row.started_at.isoformat() if row.started_at else None,
            "finished_at": row.finished_at.isoformat() if row.finished_at else None}


def candidate_runs(db, candidate, *, running_only: bool = False, limit: int = 50) -> list:
    """The candidate's tailorings, newest first (lost ones expired first)."""
    expire_lost(db, candidate.firm_id)
    query = scoped(db, JobRun, candidate.firm_id).filter(JobRun.job_type == JOB_TYPE)
    if running_only:
        query = query.filter(JobRun.status == "running")
    rows = query.order_by(JobRun.started_at.desc()).all()
    return [r for r in rows if (r.meta or {}).get("candidate_id") == str(candidate.id)][:limit]


def candidate_run(db, candidate, run_id) -> JobRun:
    expire_lost(db, candidate.firm_id)
    row = scoped(db, JobRun, candidate.firm_id).filter(JobRun.id == run_id, JobRun.job_type == JOB_TYPE).first()
    if row is None or (row.meta or {}).get("candidate_id") != str(candidate.id):
        raise HTTPException(status_code=404, detail="Not found.")
    return row


# ── Admission (the route, the candidate locked) ──────────────────────────────────────────────────────────────────────

def _no_base(detail: str) -> HTTPException:
    return HTTPException(status_code=409, detail=detail)


def _version_1(db, candidate, base: BaseResume) -> Resume | None:
    return scoped(db, Resume, candidate.firm_id).filter(Resume.base_resume_id == base.id, Resume.category == "BASE",
                                                        Resume.version == 1, Resume.deleted_at.is_(None)).first()


def tailored_from(db, candidate, base_resume_id) -> tuple[BaseResume, Resume]:
    """The base a tailoring reads (the active one, or the one the BDE picked) and its v1. 404 for a base that isn't
    the candidate's; 409 when it is hidden, when there's no active base, or when its v1 is gone."""
    if base_resume_id is not None:
        base = versions.candidate_base(db, candidate, base_resume_id)
        if base.archived_at is not None:
            raise _no_base("This base is hidden. Show it again to tailor from it.")
    else:
        base = scoped(db, BaseResume, candidate.firm_id).filter(BaseResume.candidate_id == candidate.id,
                                                                BaseResume.is_active,
                                                                BaseResume.deleted_at.is_(None)).first()
        if base is None:
            raise _no_base("This candidate has no active base résumé to tailor from.")
    v1 = _version_1(db, candidate, base)
    if v1 is None:
        raise _no_base("This base has no version 1 to tailor from.")
    return base, v1


def candidate_posting(db, candidate, job_posting_id) -> JobPosting:
    """One of the candidate's job postings; another candidate's or firm's is the same 404 as a missing one."""
    posting = scoped(db, JobPosting, candidate.firm_id).filter(JobPosting.id == job_posting_id,
                                                               JobPosting.candidate_id == candidate.id).first()
    if posting is None:
        raise HTTPException(status_code=404, detail="Not found.")
    return posting


def posting_text(posting: JobPosting) -> tuple[str, str]:
    """(description, title) as the job pages show them: read by the posting's own source, so a freehire.me or an
    extension description's HTML reaches the model as plain text (Zuhair 2026-11-12). Empty when no reader knows the
    source."""
    reader = providers.reader_for(posting.source)
    if reader is None:
        return "", ""
    fields = reader.read(posting.content or {})
    return text(fields.description), text(fields.title)


def admit(db, candidate, actor: User, job_posting_id, base_resume_id=None) -> dict:
    """The checks before a tailoring starts, the candidate row locked by the caller; the run's meta. Raises the
    route's answer: 404, 409 (no usable base; the same base and job running), 422 (no description), 429 (the BDE has
    MOST_RUNNING_PER_BDE running)."""
    base, _ = tailored_from(db, candidate, base_resume_id)
    posting = candidate_posting(db, candidate, job_posting_id)
    if not posting_text(posting)[0]:
        raise HTTPException(status_code=422, detail="This job has no description to tailor the résumé to.")
    expire_lost(db, candidate.firm_id)
    running = [row.meta or {} for row in _running(db, candidate.firm_id)]
    if any(m.get("base_resume_id") == str(base.id) and m.get("job_posting_id") == str(posting.id) for m in running):
        raise HTTPException(status_code=409, detail="This résumé is already being tailored for this job.")
    if sum(m.get("user_id") == str(actor.id) for m in running) >= MOST_RUNNING_PER_BDE:
        raise HTTPException(status_code=429, detail=f"You have {MOST_RUNNING_PER_BDE} tailorings running. "
                                                    "Wait for one to finish, then try again.")
    return {"candidate_id": str(candidate.id), "base_resume_id": str(base.id), "job_posting_id": str(posting.id),
            "user_id": str(actor.id)}


# ── The run ──────────────────────────────────────────────────────────────────────────────────────────────────────────

class _Stop(Exception):
    """The run ends without a version, for `code`."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _inputs(firm_id, candidate_id, base_resume_id, job_posting_id) -> tuple:
    """(setup, the base's v1 content, the posting's text and title), read in one short transaction."""
    db = SessionLocal()
    try:
        candidate = scoped(db, Candidate, firm_id).filter(Candidate.id == candidate_id).first()
        base = scoped(db, BaseResume, firm_id).filter(BaseResume.id == base_resume_id,
                                                      BaseResume.deleted_at.is_(None)).first()
        posting = scoped(db, JobPosting, firm_id).filter(JobPosting.id == job_posting_id).first()
        v1 = _version_1(db, candidate, base) if candidate is not None and base is not None else None
        if v1 is None or posting is None:
            raise _Stop(GONE)
        try:
            setup = read_setup(db)
        except TailorSetupError as e:
            logger.error("Résumé tailor isn't set up: %s", e)
            raise _Stop(SETUP)
        content = versions.content_of(v1)
        found = (setup, content, *posting_text(posting))
        db.commit()                           # nothing held while the model works
        return found
    finally:
        db.close()


def _finish(run_id, firm_id, candidate_id, base_resume_id, job_posting_id, user_id, setup, tailored,
            job_title: str) -> int:
    """The TAILORED version, written with the candidate locked, once everything it names is still there; its
    number (not the row: its session is closed when this returns)."""
    db = SessionLocal()
    try:
        candidate = scoped(db, Candidate, firm_id).filter(Candidate.id == candidate_id).with_for_update().first()
        firm = db.get(Firm, firm_id)
        if candidate is None or firm is None or firm.status == "SUSPENDED":
            raise _Stop(GONE)
        if ((db.get(JobRun, run_id).meta or {}).get("error_code")):
            raise _Stop(LOST)                 # told the BDE it failed: keep it that way
        base = scoped(db, BaseResume, firm_id).filter(BaseResume.id == base_resume_id,
                                                      BaseResume.deleted_at.is_(None),
                                                      BaseResume.archived_at.is_(None)).first()
        posting = scoped(db, JobPosting, firm_id).filter(JobPosting.id == job_posting_id).first()
        v1 = _version_1(db, candidate, base) if base is not None else None
        if v1 is None or posting is None:
            raise _Stop(GONE)
        content = versions._with_ids(versions.content_of(v1), tailored.content)
        group = scoped(db, Resume, firm_id).filter(Resume.base_resume_id == base.id, Resume.category == "TAILORED",
                                                   Resume.job_id == posting.id)
        latest = group.with_entities(func.max(Resume.version)).scalar() or 0
        # Re-tailoring carries what the BDE typed for this application (decided 2026-11-12, part 2 Q6).
        newest = group.filter(Resume.deleted_at.is_(None)).order_by(Resume.version.desc()).first()
        row = Resume(firm_id=firm_id, candidate_id=candidate.id, base_resume_id=base.id, category="TAILORED",
                     job_id=posting.id, version=latest + 1, name=TAILORED_NAME, template=v1.template,
                     page_format=v1.page_format, created_by_user_id=user_id,
                     autofill=copy.deepcopy(autofill.entries_of(newest or v1)), **content)
        db.add(row)
        db.flush()
        number = versions.base_numbers(db, candidate)[base.id]
        entry = ledger.record(db, actor=db.get(User, user_id), action="CREATE", entity_type="resume",
                              entity_id=row.id,
                              entity_label=f"{versions._label(candidate, number)} (tailored) v{row.version}"[:200],
                              summary=f"Tailored Base {number} for {job_title or 'a job'}"[:500], firm_id=firm_id,
                              candidate_id=candidate.id)
        entry.model_id = setup.model
        merge_meta(db, run_id, {"resume_id": str(row.id), "counts": tailored.counts})
        db.commit()
        return row.version
    finally:
        db.close()


def _record_failure(run_id, code: str) -> None:
    db = SessionLocal()
    try:
        merge_meta(db, run_id, {"error_code": code})
        db.commit()
    finally:
        db.close()


async def _failed(run_id, code: str) -> str:
    await asyncio.to_thread(_record_failure, run_id, code)
    # In the run's own task, not the thread: launch_background's wrapper reads it from this task's context.
    mark_run_failed(code)
    return f"Tailoring failed ({code})"


async def run_tailoring(firm_id, candidate_id, base_resume_id, job_posting_id, user_id) -> str:
    """One tailoring, launched by the route through launch_background (job type JOB_TYPE, the tailor's gate)."""
    run_id = uuid.UUID(current_run_id.get())       # launch_background's wrapper sets it for its task
    try:
        setup, content, job_text, job_title = await asyncio.to_thread(
            _inputs, firm_id, candidate_id, base_resume_id, job_posting_id)
        tailored = await tailor_version(content, job_text, job_title, setup=setup, firm_id=firm_id)
        version = await asyncio.to_thread(_finish, run_id, firm_id, candidate_id, base_resume_id, job_posting_id,
                                      user_id, setup, tailored, job_title)
    except (_Stop, TailorFailed) as e:
        logger.warning("Résumé tailor: run %s failed (%s)", run_id, e.code)
        return await _failed(run_id, e.code)
    except Exception as e:
        # The type only: a database error's text carries the row it tried to write (the résumé).
        logger.error("Résumé tailor: run %s failed unexpectedly (%s)", run_id, type(e).__name__)
        return await _failed(run_id, INTERNAL)
    return f"Tailored version {version}"
