"""A candidate's job searches and the jobs they found (job search PR 1; docs/02 §6.y; docs/integration/02-jobs.md).
Under the candidate's URL: another firm, a candidate outside the principal's scope, or a posting that isn't the
candidate's is the same 404 as a missing one.
- POST …/job-searches              start a search `{query}`: its batch is written `running`, the search runs in the
                                   background: 202 `{batch_id, run_id}`
- GET  …/job-searches              the running search, the finished ones (newest first), today's usage and caps
- POST …/job-postings              capture one job `{source: manual | extension, title, company, description, url,
                                   location?}`: 201, or 200 with the job the candidate already has (job search PR 2)
- GET  …/job-postings?page=&size=  the candidate's jobs, newest first, in the common fields
- GET  …/job-postings/{posting_id} one job, with its description
Who (decided 2026-11-10): a search, only the candidate's assigned BDE (`job.search` + `can_search_jobs`); reads,
anyone who can see the candidate. A support view reads only (backend/auth/access.py). The country is the candidate's
résumé country (`Candidate.country`), never a request field.
"""
import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.concurrency import run_in_threadpool
from pydantic import AfterValidator, BaseModel, StringConstraints
from sqlalchemy import func
from sqlalchemy.orm import Session as DbSession

from backend.api.routes_auth import current_principal
from backend.api.routes_candidates import _candidate, _member_of
from backend.auth.policy import can_search_jobs
from backend.auth.scoping import scoped
from backend.auth.sessions import Principal
from backend.job_monitor import JobAlreadyRunningError, launch_background
from backend.job_search import limits, pipeline, providers
from backend.job_search.country import search_country
from backend.job_search.text import safe_url, typed_text
from backend.models.db import get_db, utcnow
from backend.models.job_search import JobPosting, ScrapeJob

router = APIRouter(prefix="/firms/{firm_id}/candidates/{candidate_id}", tags=["job search"])

HISTORY = 50
PAGE_SIZE_MAX = 100


class SearchBody(BaseModel):
    # One line of text: a control character (NUL, tab, a line break inside it) is a 422 before anything is written.
    query: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100),
                     AfterValidator(typed_text)]


def _http_url(value: str) -> str:
    if safe_url(value) is None:
        raise ValueError("an http(s) link")
    return value.strip()


def _lines(value: str) -> str:
    return typed_text(value, multiline=True)


# Typed fields refuse control characters (422 before anything is written; Abdul's second review of PR 1, P2): one
# line for the title, company, location and link; the description keeps its tabs and line breaks.
Line = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300), AfterValidator(typed_text)]


class CaptureBody(BaseModel):
    source: Literal["manual", "extension"]
    title: Line
    company: Line
    description: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100_000),
                           AfterValidator(_lines)]
    url: Annotated[str, StringConstraints(max_length=2048), AfterValidator(typed_text), AfterValidator(_http_url)]
    location: Annotated[str, StringConstraints(strip_whitespace=True, max_length=300),
                        AfterValidator(typed_text)] | None = None


def _too_many(detail: str) -> HTTPException:
    return HTTPException(status_code=429, detail=detail)


def _resets(now) -> str:
    return f"resets {limits.next_reset(now).astimezone(limits.IST):%I:%M %p} IST".replace("resets 0", "resets ")


def _admit(db: DbSession, firm_id: uuid.UUID, candidate_id: uuid.UUID, query: str, principal: Principal) -> dict:
    """The search's admission, in one transaction, committed: the checks, then its `running` batch row. Blocking (it
    waits for the candidate's row and the BDE's lock), so it runs in a worker thread, never on the event loop (Abdul's
    comment on PR 2: a wait there stalled every request on the worker until the lock's holder, whose release needs
    the loop, timed out). Returns the background task's arguments."""
    _member_of(firm_id, principal)
    candidate = _candidate(db, firm_id, principal, candidate_id, lock=True)
    if not can_search_jobs(principal, candidate):
        raise HTTPException(status_code=403, detail="Only this candidate's BDE searches jobs for them.")
    country = search_country(candidate.country)
    if country is None:
        raise HTTPException(status_code=422, detail="Add the candidate's country (US, Canada or India) to their "
                                                    "résumé first.")
    limits.lock_bde(db, principal.user_id)
    now = utcnow()
    pipeline.expire_lost(db, firm_id, candidate.id, now)
    if limits.running_search(db, firm_id, candidate.id, now) is not None:
        raise HTTPException(status_code=409, detail="A search for this candidate is already running.")
    if limits.jobs_saved_today(db, firm_id, candidate.id, now) >= limits.JOBS_PER_CANDIDATE_PER_DAY:
        raise _too_many(f"{limits.JOBS_PER_CANDIDATE_PER_DAY} jobs saved for this candidate today; {_resets(now)}.")
    if limits.attempts_today(db, firm_id, principal.user_id, now) >= limits.ATTEMPTS_PER_BDE_PER_DAY:
        raise _too_many(f"You've run {limits.ATTEMPTS_PER_BDE_PER_DAY} searches today; {_resets(now)}.")
    provider = providers.active(db)
    batch = pipeline.open_batch(db, firm_id=firm_id, candidate_id=candidate.id, user_id=principal.user_id,
                                query=query, country=country, provider=provider.name)
    task = {"firm_id": firm_id, "candidate_id": candidate.id, "user_id": principal.user_id,
            "batch_id": batch.batch_id, "query": query, "country": country, "provider_name": provider.name}
    # Committed before the search is launched, so a launched search always has its row (Abdul's review, P2); the task
    # also checks it is still `running` before asking the source. A crash between the two leaves the row `running`,
    # and it becomes an `internal` error after 15 minutes, like a restart.
    db.commit()
    return task


def _link_run(db: DbSession, firm_id: uuid.UUID, batch_id: uuid.UUID, run_id: str) -> None:
    """The run → batch link, both ways: the batch names its run. Committed."""
    batch = scoped(db, ScrapeJob, firm_id).filter(ScrapeJob.batch_id == batch_id).one()
    batch.meta = {**(batch.meta or {}), "run_id": str(run_id)}
    db.commit()


@router.post("/job-searches", status_code=202, summary="Search jobs for a candidate (in the background)")
async def start_search(firm_id: uuid.UUID, candidate_id: uuid.UUID, body: SearchBody,
                       principal: Principal = Depends(current_principal), db: DbSession = Depends(get_db)):
    """Async so the background task starts on the app's loop; everything that touches the database runs in a worker
    thread (`_admit`, `_link_run`), so a lock wait never blocks the loop. Another firm or a candidate out of scope is
    404 before anything else (never confirm it exists); then `can_search_jobs` (job.search, the candidate's BDE) is
    403. The checks and the `running` batch row are one transaction with the candidate row locked, so two POSTs for one
    candidate take turns: the second sees the first one's `running` row and gets 409, on any worker. The BDE is locked
    too (a Postgres lock on their id, after the candidate's), so two searches of theirs for different candidates count
    their 20 attempts in turn (Abdul's review, P2)."""
    task = await run_in_threadpool(_admit, db, firm_id, candidate_id, body.query, principal)
    batch_id = task["batch_id"]
    try:
        # The run names nothing of the firm's (no meta; its scope is the opaque batch id): Super Admin's monitor lists
        # runs across firms without a support view, so the search's details stay in the firm's own `scrape_jobs` row,
        # which names the run (Abdul's review, P1).
        run_id = launch_background(limits.JOB_TYPE, pipeline.run_search, scope_key=str(batch_id), func_kwargs=task)
    except Exception as error:
        # Never started: the row goes, so it isn't one of the BDE's 20 attempts and doesn't block the candidate.
        await run_in_threadpool(pipeline.discard_batch, db, firm_id, batch_id)
        if isinstance(error, JobAlreadyRunningError):
            raise HTTPException(status_code=409, detail="A search for this candidate is already running.") from None
        raise HTTPException(status_code=503, detail="The search couldn't start; try again.") from None
    await run_in_threadpool(_link_run, db, firm_id, batch_id, run_id)
    return {"batch_id": str(batch_id), "run_id": str(run_id)}


def _search_json(row: ScrapeJob, now=None) -> dict:
    meta = row.meta or {}
    request = meta.get("request") or {}
    lost = limits.is_lost(row, now)            # shown as the error it becomes; a read writes nothing
    return {"batch_id": str(row.batch_id), "kind": row.kind, "run_id": meta.get("run_id"),
            "state": "error" if lost else row.state,
            "error_code": "internal" if lost else meta.get("error_code"), "query": request.get("query"), "country": request.get("country"),
            "provider": request.get("provider"), "counts": meta.get("counts"), "user_id": str(row.user_id),
            "started_at": row.created_at.isoformat(),
            "finished_at": row.finished_at.isoformat() if row.finished_at else None}


@router.get("/job-searches", summary="A candidate's job searches and today's usage")
def list_searches(firm_id: uuid.UUID, candidate_id: uuid.UUID, principal: Principal = Depends(current_principal),
                  db: DbSession = Depends(get_db)):
    _member_of(firm_id, principal)
    candidate = _candidate(db, firm_id, principal, candidate_id)
    now = utcnow()
    run = limits.running_search(db, firm_id, candidate.id, now)
    query = scoped(db, ScrapeJob, firm_id).filter(ScrapeJob.candidate_id == candidate.id)
    if run is not None:
        query = query.filter(ScrapeJob.id != run.id)
    rows = query.order_by(ScrapeJob.created_at.desc()).limit(HISTORY).all()     # searches and captures
    return {"running": _search_json(run, now) if run is not None else None,
            "searches": [_search_json(r, now) for r in rows],
            "usage": limits.usage(db, firm_id, candidate.id, candidate.bde_id, now)}


@router.post("/job-postings", status_code=201, summary="Capture one job for a candidate (by hand or the extension)")
def capture_job(firm_id: uuid.UUID, candidate_id: uuid.UUID, body: CaptureBody, response: Response,
                principal: Principal = Depends(current_principal), db: DbSession = Depends(get_db)):
    """The candidate's BDE only, like a search (decided 2026-11-10); 20 captures per BDE per day. The same job again
    is the posting the candidate already has (200), not a second one."""
    _member_of(firm_id, principal)
    candidate = _candidate(db, firm_id, principal, candidate_id, lock=True)
    if not can_search_jobs(principal, candidate):
        raise HTTPException(status_code=403, detail="Only this candidate's BDE adds jobs for them.")
    limits.lock_bde(db, principal.user_id)          # one BDE's captures count the 20 in turn (Abdul's review, P2)
    now = utcnow()
    if limits.captures_today(db, firm_id, principal.user_id, now) >= limits.CAPTURES_PER_BDE_PER_DAY:
        raise _too_many(f"You've captured {limits.CAPTURES_PER_BDE_PER_DAY} jobs today; {_resets(now)}.")
    posting, created = pipeline.capture(db, firm_id=firm_id, candidate_id=candidate.id, user_id=principal.user_id,
                                        source=body.source, job=body.model_dump(exclude={"source"}))
    db.commit()
    if not created:
        response.status_code = 200
    return _posting_json(posting, with_description=True)


def _posting_json(row: JobPosting, with_description: bool) -> dict:
    reader = providers.reader_for(row.source)
    fields = reader.read(row.content or {}) if reader else None
    out = {"id": str(row.id), "candidate_id": str(row.candidate_id), "batch_id": str(row.batch_id),
           "source": row.source, "job_id": row.job_id, "discovered_at": row.discovered_at.isoformat(),
           "last_seen_at": row.last_seen_at.isoformat(),
           "title": fields.title if fields else "", "company": fields.company if fields else "",
           "apply_url": fields.apply_url if fields else None, "location": fields.location if fields else None,
           "countries": list(fields.countries) if fields else [], "posted_at": fields.posted_at if fields else None,
           "employment_type": fields.employment_type if fields else None,
           "skills": list(fields.skills) if fields else [], "is_closed": fields.is_closed if fields else False}
    if with_description:
        out["description"] = fields.description if fields else ""
    return out


@router.get("/job-postings", summary="A candidate's jobs, newest first")
def list_postings(firm_id: uuid.UUID, candidate_id: uuid.UUID, page: int = Query(1, ge=1, le=1000),
                  size: int = Query(50, ge=1, le=PAGE_SIZE_MAX), principal: Principal = Depends(current_principal),
                  db: DbSession = Depends(get_db)):
    _member_of(firm_id, principal)
    candidate = _candidate(db, firm_id, principal, candidate_id)
    query = scoped(db, JobPosting, firm_id).filter(JobPosting.candidate_id == candidate.id)
    total = query.with_entities(func.count(JobPosting.id)).scalar()
    rows = query.order_by(JobPosting.discovered_at.desc(), JobPosting.id).offset((page - 1) * size).limit(size).all()
    return {"items": [_posting_json(r, with_description=False) for r in rows], "total": total, "page": page,
            "size": size}


@router.get("/job-postings/{posting_id}", summary="One of a candidate's jobs, with its description")
def get_posting(firm_id: uuid.UUID, candidate_id: uuid.UUID, posting_id: uuid.UUID,
                principal: Principal = Depends(current_principal), db: DbSession = Depends(get_db)):
    _member_of(firm_id, principal)
    candidate = _candidate(db, firm_id, principal, candidate_id)
    row = scoped(db, JobPosting, firm_id).filter(JobPosting.candidate_id == candidate.id,
                                      JobPosting.id == posting_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Not found.")
    return _posting_json(row, with_description=True)
