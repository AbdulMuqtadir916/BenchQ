"""A résumé tailoring as a background run (docs/team/tailoring.md §7, part 2; decided 2026-11-12).

The run's `job_runs` row is its record (no table of its own): `firm_id`, `target_job_id` (the posting) and `meta`
`{candidate_id, source_resume_id, base_resume_id, job_posting_id, job_title, user_id}`, then `step` as it goes,
`resume_id` and the report's counts, or `error_code`, and the heartbeat `seen_at`. Every check reads those rows, so it
holds with any number of workers.

    the source (decided 2026-11-12, part 3 R3-Q1/Q3): a version of one of the candidate's visible bases, by default
        the active base's v1. A v1 is its base; any other version gets a base of its own when the tailoring succeeds
        (`versions.base_for_tailoring`: not made active), so `base_resume_id` is known at the start only for a v1
    the route (`admit`, the candidate row locked):  the source, the posting and its text; expire lost runs;
        409 the same source and job running, 429 the BDE has MOST_RUNNING_PER_BDE running; then the launch
    the run (`run_tailoring`, in the tailor's gate):  read the inputs → tailor (five model calls, about a minute,
        no connection held; each step recorded) → finish with the candidate locked: the firm suspended, the
        candidate, source or posting gone, or the run already marked lost → no version; else the source's base (made
        now for a later version), the TAILORED version (v1, or the next of base + job), its autofill entries, the
        ledger entries, and the counts
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
GONE, LOST, SETUP, INTERNAL, HIDDEN = "gone", "lost", "setup", "internal", "hidden"
# What the screens show while it runs: the pipeline's five steps, then the save (decided 2026-11-12, part 3 R2-Q1).
SAVE_STEP = "save"
RECENT_FOR = timedelta(minutes=30)             # decided 2026-11-12 (R3-Q2): finished ones stay in the BDE's panel


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
            "step": meta.get("step") if status == "running" else None,
            "candidate_id": meta.get("candidate_id"), "source_resume_id": meta.get("source_resume_id"),
            "base_resume_id": meta.get("base_resume_id"), "job_posting_id": meta.get("job_posting_id"),
            "job_title": meta.get("job_title") or "", "user_id": meta.get("user_id"),
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


def my_runs(db, firm_id, user_id) -> list:
    """The user's tailorings in the firm that are running or finished in the last RECENT_FOR, newest first (the BDE's
    panel, decided 2026-11-12, part 3 R2-Q2 and R3-Q2). Lost ones are expired first."""
    expire_lost(db, firm_id)
    since = _now() - RECENT_FOR
    rows = scoped(db, JobRun, firm_id).filter(JobRun.job_type == JOB_TYPE,
                                              (JobRun.status == "running") | (JobRun.finished_at >= since)) \
        .order_by(JobRun.started_at.desc()).all()
    return [r for r in rows if (r.meta or {}).get("user_id") == str(user_id)]


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


def _active_v1(db, candidate) -> Resume:
    base = scoped(db, BaseResume, candidate.firm_id).filter(BaseResume.candidate_id == candidate.id,
                                                            BaseResume.is_active,
                                                            BaseResume.deleted_at.is_(None)).first()
    if base is None:
        raise _no_base("This candidate has no active base résumé to tailor from.")
    v1 = _version_1(db, candidate, base)
    if v1 is None:
        raise _no_base("This base has no version 1 to tailor from.")
    return v1


def tailoring_source(db, candidate, resume_id=None) -> Resume:
    """The version a tailoring reads: `resume_id`, or the active base's v1 (decided 2026-11-12, part 3 R3-Q1). 404 for
    a version that isn't the candidate's; 409 for a tailored one (R3-Q3: base versions only), a hidden base, a hidden
    base made from this version before (R3-Q4), or no active base."""
    if resume_id is None:
        return _active_v1(db, candidate)
    row = versions.candidate_version(db, candidate, resume_id)
    if row.category != "BASE":
        raise _no_base("A tailored résumé can't be tailored again. Pick one of the base's versions.")
    base = versions.candidate_base(db, candidate, row.base_resume_id)
    if base.archived_at is not None:
        raise _no_base("This base is hidden. Show it again to tailor from it.")
    if row.version != 1:
        made = scoped(db, BaseResume, candidate.firm_id).filter(BaseResume.promoted_from_resume_id == row.id,
                                                                BaseResume.deleted_at.is_(None)).first()
        if made is not None and made.archived_at is not None:
            number = versions.base_numbers(db, candidate)[made.id]
            raise _no_base(f"Base {number}, made from this version, is hidden. Show it again first.")
    return row


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


def admit(db, candidate, actor: User, job_posting_id, resume_id=None) -> dict:
    """The checks before a tailoring starts, the candidate row locked by the caller; the run's meta. Raises the
    route's answer: 404, 409 (no usable source; the same source and job running), 422 (no description), 429 (the BDE
    has MOST_RUNNING_PER_BDE running)."""
    source = tailoring_source(db, candidate, resume_id)
    posting = candidate_posting(db, candidate, job_posting_id)
    description, title = posting_text(posting)
    if not description:
        raise HTTPException(status_code=422, detail="This job has no description to tailor the résumé to.")
    expire_lost(db, candidate.firm_id)
    running = [row.meta or {} for row in _running(db, candidate.firm_id)]
    if any(m.get("source_resume_id") == str(source.id) and m.get("job_posting_id") == str(posting.id) for m in running):
        raise HTTPException(status_code=409, detail="This résumé is already being tailored for this job.")
    if sum(m.get("user_id") == str(actor.id) for m in running) >= MOST_RUNNING_PER_BDE:
        raise HTTPException(status_code=429, detail=f"You have {MOST_RUNNING_PER_BDE} tailorings running. "
                                                    "Wait for one to finish, then try again.")
    return {"candidate_id": str(candidate.id), "source_resume_id": str(source.id),
            "base_resume_id": str(source.base_resume_id) if source.version == 1 else None,
            "job_posting_id": str(posting.id), "job_title": title[:300], "user_id": str(actor.id)}


# ── The run ──────────────────────────────────────────────────────────────────────────────────────────────────────────

class _Stop(Exception):
    """The run ends without a version, for `code`."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _source(db, firm_id, candidate, source_resume_id) -> Resume | None:
    """The source version, while it and its base are still there and visible."""
    row = scoped(db, Resume, firm_id).filter(Resume.id == source_resume_id, Resume.candidate_id == candidate.id,
                                             Resume.category == "BASE", Resume.deleted_at.is_(None)).first()
    if row is None:
        return None
    base = scoped(db, BaseResume, firm_id).filter(BaseResume.id == row.base_resume_id,
                                                  BaseResume.deleted_at.is_(None),
                                                  BaseResume.archived_at.is_(None)).first()
    return row if base is not None else None


def _inputs(firm_id, candidate_id, source_resume_id, job_posting_id) -> tuple:
    """(setup, the source version's content, the posting's text and title), read in one short transaction."""
    db = SessionLocal()
    try:
        candidate = scoped(db, Candidate, firm_id).filter(Candidate.id == candidate_id).first()
        posting = scoped(db, JobPosting, firm_id).filter(JobPosting.id == job_posting_id).first()
        source = _source(db, firm_id, candidate, source_resume_id) if candidate is not None else None
        if source is None or posting is None:
            raise _Stop(GONE)
        try:
            setup = read_setup(db)
        except TailorSetupError as e:
            logger.error("Résumé tailor isn't set up: %s", e)
            raise _Stop(SETUP)
        content = versions.content_of(source)
        found = (setup, content, *posting_text(posting))
        db.commit()                           # nothing held while the model works
        return found
    finally:
        db.close()


def _record_step(run_id, step: str) -> None:
    db = SessionLocal()
    try:
        merge_meta(db, run_id, {"step": step})
        db.commit()
    finally:
        db.close()


def _step_recorder(run_id):
    async def on_step(step: str) -> None:
        try:
            await asyncio.to_thread(_record_step, run_id, step)
        except Exception as e:                 # the screens show an older step; the tailoring goes on
            logger.warning("Résumé tailor: run %s step not recorded (%s)", run_id, type(e).__name__)
    return on_step


def _finish(run_id, firm_id, candidate_id, source_resume_id, job_posting_id, user_id, setup, tailored,
            job_title: str) -> int:
    """The TAILORED version, written with the candidate locked, once everything it names is still there; its
    number (not the row: its session is closed when this returns). A source that isn't a v1 gets its base here, so a
    failed tailoring leaves none (decided 2026-11-12, part 3 R3-Q1)."""
    db = SessionLocal()
    try:
        candidate = scoped(db, Candidate, firm_id).filter(Candidate.id == candidate_id).with_for_update().first()
        firm = db.get(Firm, firm_id)
        if candidate is None or firm is None or firm.status == "SUSPENDED":
            raise _Stop(GONE)
        if ((db.get(JobRun, run_id).meta or {}).get("error_code")):
            raise _Stop(LOST)                 # told the BDE it failed: keep it that way
        source = _source(db, firm_id, candidate, source_resume_id)
        posting = scoped(db, JobPosting, firm_id).filter(JobPosting.id == job_posting_id).first()
        if source is None or posting is None:
            raise _Stop(GONE)
        actor = db.get(User, user_id)
        try:
            base = versions.base_for_tailoring(db, actor, candidate, source)
        except HTTPException:
            raise _Stop(HIDDEN)               # the base made from this version was hidden meanwhile
        content = versions._with_ids(versions.content_of(source), tailored.content)
        group = scoped(db, Resume, firm_id).filter(Resume.base_resume_id == base.id, Resume.category == "TAILORED",
                                                   Resume.job_id == posting.id)
        latest = group.with_entities(func.max(Resume.version)).scalar() or 0
        # Re-tailoring carries what the BDE typed for this application (decided 2026-11-12, part 2 Q6).
        newest = group.filter(Resume.deleted_at.is_(None)).order_by(Resume.version.desc()).first()
        row = Resume(firm_id=firm_id, candidate_id=candidate.id, base_resume_id=base.id, category="TAILORED",
                     job_id=posting.id, version=latest + 1, name=TAILORED_NAME, template=source.template,
                     page_format=source.page_format, created_by_user_id=user_id,
                     autofill=copy.deepcopy(autofill.entries_of(newest or source)), **content)
        db.add(row)
        db.flush()
        number = versions.base_numbers(db, candidate)[base.id]
        entry = ledger.record(db, actor=actor, action="CREATE", entity_type="resume",
                              entity_id=row.id,
                              entity_label=f"{versions._label(candidate, number)} (tailored) v{row.version}"[:200],
                              summary=f"Tailored Base {number} for {job_title or 'a job'}"[:500], firm_id=firm_id,
                              candidate_id=candidate.id)
        entry.model_id = setup.model
        merge_meta(db, run_id, {"resume_id": str(row.id), "base_resume_id": str(base.id), "counts": tailored.counts})
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


async def run_tailoring(firm_id, candidate_id, source_resume_id, job_posting_id, user_id) -> str:
    """One tailoring, launched by the route through launch_background (job type JOB_TYPE, the tailor's gate)."""
    run_id = uuid.UUID(current_run_id.get())       # launch_background's wrapper sets it for its task
    try:
        setup, content, job_text, job_title = await asyncio.to_thread(
            _inputs, firm_id, candidate_id, source_resume_id, job_posting_id)
        on_step = _step_recorder(run_id)
        tailored = await tailor_version(content, job_text, job_title, setup=setup, firm_id=firm_id, on_step=on_step)
        await on_step(SAVE_STEP)
        version = await asyncio.to_thread(_finish, run_id, firm_id, candidate_id, source_resume_id, job_posting_id,
                                          user_id, setup, tailored, job_title)
    except (_Stop, TailorFailed) as e:
        logger.warning("Résumé tailor: run %s failed (%s)", run_id, e.code)
        return await _failed(run_id, e.code)
    except Exception as e:
        # The type only: a database error's text carries the row it tried to write (the résumé).
        logger.error("Résumé tailor: run %s failed unexpectedly (%s)", run_id, type(e).__name__)
        return await _failed(run_id, INTERNAL)
    return f"Tailored version {version}"
