"""A candidate's job searches and the jobs they found (job search PR 1; docs/02 §6.y; docs/integration/02-jobs.md).
Under the candidate's URL: another firm, a candidate outside the principal's scope, or a posting that isn't the
candidate's is the same 404 as a missing one.
- POST …/job-searches              start a search `{query}`: its batch is written `running`, the search runs in the
                                   background: 202 `{batch_id, run_id}`
- GET  …/job-searches              the running search, the finished ones (newest first), today's usage and caps
- GET  …/job-postings?page=&size=  the candidate's jobs, newest first, in the common fields
- GET  …/job-postings/{posting_id} one job, with its description
Who (decided 2026-11-10): a search, only the candidate's assigned BDE (`job.search` + `can_search_jobs`); reads,
anyone who can see the candidate. A support view reads only (backend/auth/access.py). The country is the candidate's
résumé country (`Candidate.country`), never a request field.
"""
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, StringConstraints
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
from backend.models.db import get_db, utcnow
from backend.models.job_search import JobPosting, ScrapeJob

router = APIRouter(prefix="/firms/{firm_id}/candidates/{candidate_id}", tags=["job search"])

HISTORY = 50
PAGE_SIZE_MAX = 100


class SearchBody(BaseModel):
    query: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


def _too_many(detail: str) -> HTTPException:
    return HTTPException(status_code=429, detail=detail)


def _resets(now) -> str:
    return f"resets {limits.next_reset(now).astimezone(limits.IST):%I:%M %p} IST".replace("resets 0", "resets ")


@router.post("/job-searches", status_code=202, summary="Search jobs for a candidate (in the background)")
async def start_search(firm_id: uuid.UUID, candidate_id: uuid.UUID, body: SearchBody,
                       principal: Principal = Depends(current_principal), db: DbSession = Depends(get_db)):
    """Async so the background task starts on the app's loop. Another firm or a candidate out of scope is 404 before
    anything else (never confirm it exists); then `can_search_jobs` (job.search, the candidate's BDE) is 403. The checks
    and the `running` batch row are one transaction with the candidate row locked, so two POSTs for one candidate take
    turns: the second sees the first one's `running` row and gets 409, on any worker. The BDE is locked too (a Postgres
    lock on their id, after the candidate's), so two searches of theirs for different candidates count their 20
    attempts in turn (Abdul's review, P2)."""
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
    limits.expire_stale(db, firm_id, candidate.id, now)
    if limits.running_search(db, firm_id, candidate.id, now) is not None:
        raise HTTPException(status_code=409, detail="A search for this candidate is already running.")
    if limits.jobs_saved_today(db, firm_id, candidate.id, now) >= limits.JOBS_PER_CANDIDATE_PER_DAY:
        raise _too_many(f"{limits.JOBS_PER_CANDIDATE_PER_DAY} jobs saved for this candidate today; {_resets(now)}.")
    if limits.attempts_today(db, firm_id, principal.user_id, now) >= limits.ATTEMPTS_PER_BDE_PER_DAY:
        raise _too_many(f"You've run {limits.ATTEMPTS_PER_BDE_PER_DAY} searches today; {_resets(now)}.")
    provider = providers.active(db)
    batch = pipeline.open_batch(db, firm_id=firm_id, candidate_id=candidate.id, user_id=principal.user_id,
                                query=body.query, country=country, provider=provider.name)
    try:
        # The task starts only after this handler returns, so it always finds the batch committed. The run names
        # nothing of the firm's (no meta; its scope is the opaque batch id): Super Admin's monitor lists runs across
        # firms without a support view, so the search's details stay in the firm's own `scrape_jobs` row, which
        # names the run (Abdul's review, P1).
        run_id = launch_background(
            limits.JOB_TYPE, pipeline.run_search, scope_key=str(batch.batch_id),
            func_kwargs={"firm_id": firm_id, "candidate_id": candidate.id, "user_id": principal.user_id,
                         "batch_id": batch.batch_id, "query": body.query, "country": country,
                         "provider_name": provider.name})
    except JobAlreadyRunningError:
        db.rollback()
        raise HTTPException(status_code=409, detail="A search for this candidate is already running.") from None
    batch.meta = {**batch.meta, "run_id": str(run_id)}      # the run → batch link, both ways
    db.commit()
    return {"batch_id": str(batch.batch_id), "run_id": str(run_id)}


def _search_json(row: ScrapeJob, now=None) -> dict:
    meta = row.meta or {}
    request = meta.get("request") or {}
    lost = limits.is_lost(row, now)            # shown as the error it becomes; a read writes nothing
    return {"batch_id": str(row.batch_id), "run_id": meta.get("run_id"), "state": "error" if lost else row.state,
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
    rows = query.order_by(ScrapeJob.created_at.desc()).limit(HISTORY).all()
    return {"running": _search_json(run, now) if run is not None else None,
            "searches": [_search_json(r, now) for r in rows],
            "usage": limits.usage(db, firm_id, candidate.id, candidate.bde_id, now)}


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
