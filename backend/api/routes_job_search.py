"""A candidate's job searches and the jobs they found (job search PR 1; docs/02 §6.y; docs/integration/02-jobs.md).
Under the candidate's URL: another firm, a candidate outside the principal's scope, or a posting that isn't the
candidate's is the same 404 as a missing one.
- POST …/job-searches              start a search `{place?}`: the candidate's target role in one of their places
                                   (none: the first); the place's mode (on-site, hybrid, remote) says which sources it
                                   asks, all of them in one click (job_search/fanout.py, decided 2026-11-17); its
                                   batch is written `running`, the search runs in the background: 202
                                   `{batch_id, run_id}`
- GET  …/job-searches              the running search, the finished ones (newest first), today's usage and caps, the
                                   role a search asks for and the candidate's places (decided 2026-11-14)
- POST …/job-postings              capture one job `{source: manual | extension, title, company, description, url,
                                   location?}`: 201, or 200 with the job the candidate already has (job search PR 2)
- GET  …/job-postings?page=&size=  the candidate's jobs, newest first, in the common fields
- GET  …/job-postings/{posting_id} one job, with its description
- PUT  …/job-postings/{posting_id}/posting  the posting's text, pasted by the candidate's BDE for a job that came
                                   without it (a LinkedIn job, decided 2026-11-17, Q107), so it can be tailored
Firm level (job search PR 3, docs/02 §6.z), for the job screens:
- GET  /firms/{firm_id}/job-postings?candidate_id=&sort=&min_score=&source=&remote=&q=&offset=&limit=
                                   the jobs of every candidate the principal sees (or of one), one item per job (the
                                   content hash), each with the visible `candidate_ids` and their `matches`; sorted and
                                   filtered here, 100 at a time with the `total` (decided 2026-11-14, Q28, Q29, Q47);
                                   only jobs posted in the last 14 days (decided 2026-11-16, Q56)
- GET  /firms/{firm_id}/job-postings/{posting_id}          one of those, with its description
Who (decided 2026-11-10): a search, only the candidate's assigned BDE (`job.search` + `can_search_jobs`); reads,
anyone who can see the candidate. A support view reads only (backend/auth/access.py). The country is the candidate's
résumé country (`Candidate.country`) and the role their target role, never request fields; the place is one of the
candidate's own (`backend/job_search/places.py`), never free text.
"""
import asyncio
import hashlib
import re
import uuid
from datetime import date, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.concurrency import run_in_threadpool
from pydantic import AfterValidator, BaseModel, StringConstraints
from sqlalchemy import func, literal, text
from sqlalchemy.orm import Session as DbSession

from backend.api.routes_auth import current_principal
from backend.api.routes_candidates import _candidate, _member_of, _visible
from backend.auth import ledger
from backend.auth.policy import can_manage_resume, can_search_jobs
from backend.auth.scoping import scoped
from backend.auth.sessions import Principal
from backend.job_monitor import JobAlreadyRunningError, launch_background
from backend.job_search import limits, pipeline, places, providers, workday
from backend.job_search.country import search_country
from backend.job_search.providers.base import ProviderError
from backend.job_search.text import clean_json, safe_url, typed_text
from backend.models.candidates import Candidate
from backend.models.db import Application, get_db, utcnow
from backend.models.job_search import JobPosting, ScrapeJob
from backend.models.tenancy import User

# The firm in the prefix; a candidate's routes add CANDIDATE, the firm-level reads don't (job search PR 3).
router = APIRouter(prefix="/firms/{firm_id}", tags=["job search"])
CANDIDATE = "/candidates/{candidate_id}"

HISTORY = 50
PAGE_SIZE_MAX = 100
FIRM_LIST_MAX = 400          # the most one read returns (the dashboards'); a job list asks for 100 (LIST_PAGE)
LIST_PAGE = 100              # a job list's page (decided 2026-11-14, Q29)
KNOWN_SOURCES = ("indeed", "freehire", "linkedin", "manual", "extension")
_REMOTE = re.compile(r"\bremote\b", re.I)
_HYBRID = re.compile(r"\bhybrid\b", re.I)


class SearchBody(BaseModel):
    # One of the candidate's places, by its value (`places.places`); none: the first one, the picker's default. One line
    # of text: a control character (NUL, tab, a line break inside it) is a 422 before anything is written. The role
    # isn't a request field (decided 2026-11-14: the candidate's target role).
    place: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200),
                     AfterValidator(typed_text)] | None = None


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


def _resets(db, firm_id, now) -> str:
    return f"resets {limits.resets_at_text(db, firm_id, now)}"


def _admit(db: DbSession, firm_id: uuid.UUID, candidate_id: uuid.UUID, place: str | None, principal: Principal) -> dict:
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
    query = places.search_role(candidate)
    if query is None:
        raise HTTPException(status_code=422, detail="Add the candidate's target role first.")
    options = places.places(candidate, country)
    if not options:
        raise HTTPException(status_code=422, detail="Add the candidate's city and state on their résumé, or a "
                                                    "preferred location: the job search needs a place.")
    chosen = places.pick(candidate, country, place) if place else options[0]
    if chosen is None:
        raise HTTPException(status_code=422, detail="Pick one of the candidate's places.")
    limits.lock_bde(db, principal.user_id)
    now = utcnow()
    pipeline.expire_lost(db, firm_id, candidate.id, now)
    if limits.running_search(db, firm_id, candidate.id, now) is not None:
        raise HTTPException(status_code=409, detail="A search for this candidate is already running.")
    if limits.jobs_saved_today(db, firm_id, candidate.id, now) >= limits.JOBS_PER_CANDIDATE_PER_DAY:
        raise _too_many(f"{limits.JOBS_PER_CANDIDATE_PER_DAY} jobs saved for this candidate today; {_resets(db, firm_id, now)}.")
    if limits.attempts_today(db, firm_id, principal.user_id, now) >= limits.ATTEMPTS_PER_BDE_PER_DAY:
        raise _too_many(f"You've run {limits.ATTEMPTS_PER_BDE_PER_DAY} searches today; {_resets(db, firm_id, now)}.")
    # One click asks every source the place's mode names (decided 2026-11-17, Q90, Q122): no source picker.
    provider_name = pipeline.ALL_SOURCES
    # The role's titles, searched together (decided 2026-11-16, Q69): "A | B" is two, "GenAI / LLM Engineer" two more.
    # Plus the extra titles on the candidate's résumé (2026-11-17, Q131–Q144): 5 at most, the target role's first.
    from backend.job_search import search_titles
    titles = search_titles.for_search(places.search_titles(candidate), candidate.search_titles)
    # The city's mode from the candidate's work settings (Zuhair 2026-11-17: the picker lists places only).
    searched = places.searched_place(candidate, chosen["value"])
    batch = pipeline.open_batch(db, firm_id=firm_id, candidate_id=candidate.id, user_id=principal.user_id,
                                query=query, country=country, provider=provider_name, place=searched,
                                titles=titles)
    task = {"firm_id": firm_id, "candidate_id": candidate.id, "user_id": principal.user_id,
            "batch_id": batch.batch_id, "query": query, "country": country, "provider_name": provider_name,
            "place": searched, "titles": titles}
    # Committed before the search is launched, so a launched search always has its row (Abdul's review, P2); the task
    # also checks it is still `running` before asking the source. A crash between the two leaves the row `running`,
    # and it becomes an `internal` error after 15 minutes, like a restart.
    db.commit()
    return task


def _link_run(db: DbSession, firm_id: uuid.UUID, batch_id: uuid.UUID, run_id: str) -> None:
    """The run → batch link, both ways: the batch names its run. Committed. The row is locked first: the search is
    already launched, and if it saves while this runs, this waits for that save and keeps what it wrote (the cursor,
    the counts) instead of writing back what it read before (CodeRabbit on #123)."""
    batch = scoped(db, ScrapeJob, firm_id).filter(ScrapeJob.batch_id == batch_id).with_for_update().one()
    batch.meta = {**(batch.meta or {}), "run_id": str(run_id)}
    db.commit()


@router.post(CANDIDATE + "/job-searches", status_code=202, summary="Search jobs for a candidate (in the background)")
async def start_search(firm_id: uuid.UUID, candidate_id: uuid.UUID, body: SearchBody,
                       principal: Principal = Depends(current_principal), db: DbSession = Depends(get_db)):
    """Async so the background task starts on the app's loop; everything that touches the database runs in a worker
    thread (`_admit`, `_link_run`), so a lock wait never blocks the loop. Another firm or a candidate out of scope is
    404 before anything else (never confirm it exists); then `can_search_jobs` (job.search, the candidate's BDE) is
    403. The checks and the `running` batch row are one transaction with the candidate row locked, so two POSTs for one
    candidate take turns: the second sees the first one's `running` row and gets 409, on any worker. The BDE is locked
    too (a Postgres lock on their id, after the candidate's), so two searches of theirs for different candidates count
    their 20 attempts in turn (Abdul's review, P2)."""
    task = await run_in_threadpool(_admit, db, firm_id, candidate_id, body.place, principal)
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


def _numbered(db, firm_id, candidate, hours) -> dict:
    """The current assignment's finished searches, oldest first: batch_id → {"day", "batch"} (decided 2026-11-17,
    Q154, Q158, Q166, Q170): batches numbered on across Days, each search's Day from its work date and the
    candidate's Day 1. Empty without a BDE (Q174). Every one of them, not just the history's page."""
    if candidate.bde_id is None or candidate.bde_assigned_at is None or candidate.bde_day_one is None:
        return {}
    rows = scoped(db, ScrapeJob, firm_id).filter(
        ScrapeJob.candidate_id == candidate.id, ScrapeJob.kind == "search", ScrapeJob.state.in_(("success", "empty")),
        ScrapeJob.created_at >= candidate.bde_assigned_at,
    ).order_by(ScrapeJob.created_at, ScrapeJob.id).with_entities(
        ScrapeJob.batch_id, ScrapeJob.work_date, ScrapeJob.created_at, ScrapeJob.finished_at).all()
    out = {}
    for index, row in enumerate(rows, start=1):
        on = row.work_date or workday.work_date(row.created_at, hours)
        out[row.batch_id] = {"day": workday.day_number(on, candidate.bde_day_one), "batch": index,
                             "window": (row.created_at, row.finished_at)}
    return out


def _workday_json(candidate, hours, numbered: dict, now) -> dict:
    """The candidate's Days for the history (Q156, Q165, Q172): the firm's hours, the assignment, today's Day and
    the Days with work; the empty ones between are worked out by the reader, never stored."""
    today = workday.work_date(now, hours)
    first = candidate.bde_day_one if candidate.bde_id is not None else None
    return {"start": workday.clock_text(hours.start), "end": workday.clock_text(hours.end),
            "timezone": hours.zone.key, "label": hours.label(),
            "assigned_at": candidate.bde_assigned_at.isoformat() if first and candidate.bde_assigned_at else None,
            "day_one": first.isoformat() if first else None, "today": today.isoformat(),
            "today_day": workday.day_number(today, first) if first else None,
            "days_worked": sorted({n["day"] for n in numbered.values()})}


def _search_json(row: ScrapeJob, now=None, numbered: dict | None = None) -> dict:
    meta = row.meta or {}
    request = meta.get("request") or {}
    lost = limits.is_lost(row, now)            # shown as the error it becomes; a read writes nothing
    number = (numbered or {}).get(row.batch_id) or {}
    return {"batch_id": str(row.batch_id), "kind": row.kind, "run_id": meta.get("run_id"),
            # The work day it ran in, and its Day and batch number in the current assignment (None: before it, Q174).
            "work_date": row.work_date.isoformat() if row.work_date else None,
            "day": number.get("day"), "batch": number.get("batch"),
            "state": "error" if lost else row.state,
            "error_code": "internal" if lost else meta.get("error_code"), "query": request.get("query"),
            "place": request.get("place"), "country": request.get("country"),
            "provider": request.get("provider"), "counts": meta.get("counts"), "user_id": str(row.user_id),
            "started_at": row.created_at.isoformat(),
            "finished_at": row.finished_at.isoformat() if row.finished_at else None}


@router.get(CANDIDATE + "/job-searches", summary="A candidate's job searches and today's usage")
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
    hours = workday.for_firm(db, firm_id)
    numbered = _numbered(db, firm_id, candidate, hours)
    return {"running": _search_json(run, now) if run is not None else None,
            "searches": [_search_json(r, now, numbered) for r in rows],
            "workday": _workday_json(candidate, hours, numbered, now),
            "usage": limits.usage(db, firm_id, candidate.id, candidate.bde_id, now),
            # What a search asks for (decided 2026-11-14): the target role, and the places the BDE picks from.
            "role": places.search_role(candidate),
            "places": places.places(candidate, search_country(candidate.country))}


@router.post(CANDIDATE + "/job-postings", status_code=201, summary="Capture one job for a candidate (by hand or the extension)")
def capture_job(firm_id: uuid.UUID, candidate_id: uuid.UUID, body: CaptureBody, response: Response,
                principal: Principal = Depends(current_principal), db: DbSession = Depends(get_db)):
    """The candidate's BDE only, like a search (decided 2026-11-10); 20 captures per BDE per day. The same job again
    is the posting the candidate already has (200), not a second one, even at the cap: only a new posting counts
    against the 20 (Abdul's comment on PR 2). Sync, so its lock waits run in a worker thread."""
    _member_of(firm_id, principal)
    candidate = _candidate(db, firm_id, principal, candidate_id, lock=True)
    if not can_search_jobs(principal, candidate):
        raise HTTPException(status_code=403, detail="Only this candidate's BDE adds jobs for them.")
    limits.lock_bde(db, principal.user_id)          # one BDE's captures count the 20 in turn (Abdul's review, P2)
    now = utcnow()

    def under_the_cap():
        if limits.captures_today(db, firm_id, principal.user_id, now) >= limits.CAPTURES_PER_BDE_PER_DAY:
            raise _too_many(f"You've captured {limits.CAPTURES_PER_BDE_PER_DAY} jobs today; {_resets(db, firm_id, now)}.")
    posting, created = pipeline.capture(db, firm_id=firm_id, candidate_id=candidate.id, user_id=principal.user_id,
                                        source=body.source, job=body.model_dump(exclude={"source"}),
                                        admit=under_the_cap)
    db.commit()
    if not created:
        response.status_code = 200
    # `created` says the same as the status, for a client that only reads the body (the job screens, PR 3).
    return {**_posting_json(posting, with_description=True), "created": created}


def remote_mode(fields) -> str:
    """REMOTE, HYBRID or ONSITE: what the source says (`JobFields.work_mode`, Q121), else its remote mark or the
    location's words."""
    if fields is not None and fields.work_mode:
        return fields.work_mode
    location = (fields.location or "") if fields else ""
    if fields is not None and (fields.is_remote or _REMOTE.search(location)):
        return "REMOTE"
    return "HYBRID" if _HYBRID.search(location) else "ONSITE"


def _match_json(row: JobPosting) -> dict:
    """The posting's Match (decided 2026-11-14): its score, null until worked out, and why it is held at 40."""
    return {"score": row.match_score, "note": row.match_note}


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
           "skills": list(fields.skills) if fields else [], "is_closed": fields.is_closed if fields else False,
           "h1b_sponsor": fields.h1b_sponsor if fields else False, "remote_mode": remote_mode(fields),
           "match": _match_json(row)}
    if with_description:
        out["description"] = fields.description if fields else ""
    return out


@router.get(CANDIDATE + "/job-postings", summary="A candidate's jobs, newest first")
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


@router.get(CANDIDATE + "/job-postings/{posting_id}", summary="One of a candidate's jobs, with its description")
def get_posting(firm_id: uuid.UUID, candidate_id: uuid.UUID, posting_id: uuid.UUID,
                principal: Principal = Depends(current_principal), db: DbSession = Depends(get_db)):
    _member_of(firm_id, principal)
    candidate = _candidate(db, firm_id, principal, candidate_id)
    row = scoped(db, JobPosting, firm_id).filter(JobPosting.candidate_id == candidate.id,
                                      JobPosting.id == posting_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Not found.")
    return _posting_json(row, with_description=True)


class PostingText(BaseModel):
    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=50, max_length=100_000),
                    AfterValidator(_lines)]


_WORD = re.compile(r"[a-z0-9+#]+")


def _mentions(text: str, *names: str) -> bool:
    """Whether `text` names one of `names` (a job's title or company): all its words, in any case and order."""
    words = set(_WORD.findall(text.lower()))
    return any(name and set(_WORD.findall(name.lower())) <= words for name in names)


@router.put(CANDIDATE + "/job-postings/{posting_id}/posting", summary="Paste the text of a job that came without it")
def paste_posting(firm_id: uuid.UUID, candidate_id: uuid.UUID, posting_id: uuid.UUID, body: PostingText,
                  principal: Principal = Depends(current_principal), db: DbSession = Depends(get_db)):
    """A job that came without its text (a LinkedIn job: BenchQ never fetches it, Q114) gets the posting the BDE copied
    from LinkedIn's page, so it can be tailored (decided 2026-11-17, Q107). The candidate's BDE only, like tailoring
    (`can_manage_resume`); a support view never writes. Refused: a job that already has its text (409), and text that
    names neither the job's title nor its company (422: probably another job, or a part of the page). The text goes on
    every copy of the job in the firm. LinkedIn jobs stay unscored. One ledger entry."""
    _member_of(firm_id, principal)
    candidate = _candidate(db, firm_id, principal, candidate_id, lock=True)
    if not can_manage_resume(principal, candidate):
        raise HTTPException(status_code=403, detail="Only this candidate's BDE adds a job's posting.")
    row = scoped(db, JobPosting, firm_id).filter(JobPosting.candidate_id == candidate.id,
                                                 JobPosting.id == posting_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Not found.")
    reader = providers.reader_for(row.source)
    fields = reader.read(row.content or {}) if reader else None
    if fields is None or fields.description:
        raise HTTPException(status_code=409, detail="This job already has its posting.")
    if not _mentions(body.text, fields.title, fields.company):
        raise HTTPException(status_code=422, detail="The text doesn't name this job's title or company. Copy the "
                                                    "posting itself.")
    text = clean_json(body.text)
    copies = scoped(db, JobPosting, firm_id).filter(JobPosting.job_id == row.job_id,
                                                    JobPosting.source == row.source).with_for_update().all()
    for copy in copies:
        copy.content = {**(copy.content or {}), "description": text, "_pasted": True}
    ledger.record(db, actor=db.get(User, principal.user_id), action="UPDATE", entity_type="job_posting",
                  entity_id=row.id, entity_label=f"{fields.title} at {fields.company}"[:200], firm_id=firm_id,
                  candidate_id=candidate.id, summary="Added the job's posting by hand")
    db.commit()
    db.refresh(row)
    return _posting_json(row, with_description=True)


# ── Firm level (job search PR 3, docs/02 §6.z): the job screens' list and job page ──

def _id_or_404(value: str) -> uuid.UUID:
    """An id from the URL: a malformed one is the same 404 as a missing one, never a 422 (07 F7, principle 4)."""
    try:
        return uuid.UUID(value)
    except ValueError:
        raise HTTPException(status_code=404, detail="Not found.") from None


# Set in a posting's `content` once its provider's single-job read has replaced the search's cut description.
FULL_POSTING_KEY = "_full_posting"


def _fill_full_posting(db: DbSession, row: JobPosting, principal: Principal) -> None:
    """For a source whose search sends no description or a cut one, and that has a `full_description` read
    (LinkedIn's posting page, decided 2026-11-16, Q83; freehire.me's old search cut them at ~1,000 characters), a
    job's first open asks the source for the whole posting (decided 2026-11-11) and keeps it in `content`, so it is
    asked once. A support view shows it but never writes it (no platform-admin write into a firm). A failed call
    leaves the search's text and is tried again on the next open.

    Once per job per firm (Q85): the fetch holds a lock on (firm, job), so a second open of the same job waits for the
    first one's posting instead of asking again; the posting goes on every copy of the job in the firm (one per
    candidate it was found for), and each copy's Match is worked out from it."""
    import inspect
    content = row.content or {}
    fetch = getattr(providers.REGISTRY.get(row.source), "full_description", None)
    if fetch is None or content.get(FULL_POSTING_KEY):
        return
    takes_firm = "firm_id" in inspect.signature(fetch).parameters
    if principal.kind != "firm":
        full = _fetch_posting(fetch, content, row.firm_id, takes_firm)
        if full is not None:
            row.content = {**content, **full, FULL_POSTING_KEY: True}
        return                                      # shown, never written (a support view)
    db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": _posting_lock(row.firm_id, row.job_id)})
    db.refresh(row)
    if (row.content or {}).get(FULL_POSTING_KEY):   # another open fetched it while this one waited
        db.commit()
        return
    full = _fetch_posting(fetch, row.content or {}, row.firm_id, takes_firm)
    if full is None:
        db.rollback()
        return
    from backend.match import store as match_store
    # Re-read every copy under a lock: a search may have refreshed one while the call waited (CodeRabbit on #135), so
    # only the posting and the marker are laid over its latest content.
    copies = scoped(db, JobPosting, row.firm_id).filter(JobPosting.job_id == row.job_id,
                                                        JobPosting.source == row.source) \
        .populate_existing().with_for_update().all()
    candidates = {c.id: c for c in scoped(db, Candidate, row.firm_id).filter(
        Candidate.id.in_({copy.candidate_id for copy in copies}))}
    for copy in copies:
        copy.content = {**(copy.content or {}), **full, FULL_POSTING_KEY: True}
        if copy.candidate_id in candidates:
            match_store.score_posting(db, candidates[copy.candidate_id], copy)
    db.commit()
    db.refresh(row)


def _posting_lock(firm_id, job_id: str) -> int:
    """A signed 64-bit advisory lock key for one job of one firm (the top bits say "a posting's first open")."""
    digest = hashlib.sha256(f"{firm_id}:{job_id}".encode()).digest()
    return ((0x4650 << 48) | int.from_bytes(digest[:6], "big")) - (1 << 63)


def _fetch_posting(fetch, content: dict, firm_id, takes_firm: bool) -> dict | None:
    """The source's whole posting as content updates ({"description": …, …}), cleaned; None when it failed."""
    try:
        # This sync route runs in a worker thread, outside the event loop.
        full = asyncio.run(fetch(content, firm_id=firm_id) if takes_firm else fetch(content))
    except ProviderError:
        return None
    if isinstance(full, str):
        full = {"description": full}
    if not isinstance(full, dict) or not full.get("description"):
        return None
    # The search's clean-up, before it is stored or shown: Postgres refuses \u0000 in JSONB, so an escaped NUL in the
    # source's text would fail this job's every open (Abdul on #135).
    return {key: clean_json(value) for key, value in full.items() if isinstance(value, str)}


def _job_json(rows: list[JobPosting], with_description: bool) -> dict:
    """One job, from the visible postings that share its content hash: the newest seen row's fields, and the
    candidates it was found or captured for. A posting's own candidate and batch aren't the job's, so they're left
    out."""
    newest = max(rows, key=lambda row: (row.last_seen_at, str(row.id)))
    out = _posting_json(newest, with_description)
    out.pop("candidate_id")
    out.pop("batch_id")
    out.pop("match")                      # a posting's, not the job's: each candidate's is in `matches`
    out["candidate_ids"] = sorted({str(row.candidate_id) for row in rows})
    out["matches"] = {str(row.candidate_id): _match_json(row) for row in rows}
    return out


def _posted_on(posted_at: str | None, discovered_at) -> date:
    """The day the job was posted, by its own date; a job with no date that reads (a capture by hand) the day it was
    first saved (decided 2026-11-16, Q56, Q87)."""
    try:
        return date.fromisoformat((posted_at or "")[:10])
    except ValueError:
        return discovered_at.date()


def _is_recent(posted_at: str | None, discovered_at, today: date) -> bool:
    """Posted in the last `limits.POSTED_WITHIN_DAYS` days (Q56)."""
    return today - _posted_on(posted_at, discovered_at) <= timedelta(days=limits.POSTED_WITHIN_DAYS)


def _source_key(source: str) -> str:
    return source if source in KNOWN_SOURCES else "other"


@router.get("/job-postings", summary="The jobs of every candidate the principal sees (or one's), sorted and filtered, a page at a time")
def list_firm_jobs(firm_id: uuid.UUID, candidate_id: str | None = None,
                   limit: int = Query(LIST_PAGE, ge=1, le=FIRM_LIST_MAX), offset: int = Query(0, ge=0, le=1_000_000),
                   sort: Literal["match", "newest", "company"] = "newest", min_score: int = Query(0, ge=0, le=100),
                   source: Literal["indeed", "freehire", "linkedin", "manual", "extension", "other"] | None = None,
                   remote: Literal["REMOTE", "HYBRID", "ONSITE"] | None = None,
                   q: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] | None = None,
                   exclude_applied: bool = False, batch: str | None = None,
                   day: int | None = Query(None, ge=1, le=100_000),
                   principal: Principal = Depends(current_principal), db: DbSession = Depends(get_db)):
    """The owner and a viewer see the firm's, a manager their BDEs' candidates', a BDE their own (`_visible`, 07
    Q47); `candidate_id` narrows to one of those (another is 404). One item per `job_id`: a job found for two
    candidates is one item with both in `candidate_ids`, and each one's Match in `matches`.

    Sorted and filtered here, so a page is the next part of one list and `total` counts all of it (decided 2026-11-14,
    Q47): `sort` (`match`, one candidate's best first, unscored last; `newest`; `company`), `min_score` (one
    candidate's; above 0 leaves out unscored jobs), `source`, `remote` (the job's work mode), `q` (in the title,
    company or location), `exclude_applied` (one candidate's jobs they have an application for past Saved). A closed
    job is never listed, nor one posted more than 14 days ago (decided 2026-11-16, Q56, any source; `_is_recent`): it
    stays in the database, and its job page, application and tailored résumés still open. `newest` is by the job's
    posted date (Q87), and breaks the other orders' ties; LinkedIn's jobs (never scored) come first in `match` and
    `newest` (decided 2026-11-17, Q113). `batch` (one candidate's search, its `batch_id`) keeps the jobs that search
    first found (Q109): saved while it ran. `source_counts` counts the list's jobs by source before `source` narrows it
    (the source tabs). Every visible job is read once per call without its description (job search PR 3 reads stay
    a candidate's or a team's: a few thousand rows)."""
    _member_of(firm_id, principal)
    one = None
    if candidate_id is not None:
        one = _candidate(db, firm_id, principal, _id_or_404(candidate_id)).id
        candidates = [one]
    else:
        candidates = _visible(db, firm_id, principal).with_entities(Candidate.id)
    postings = scoped(db, JobPosting, firm_id).filter(JobPosting.candidate_id.in_(candidates))
    light = postings.with_entities(JobPosting.id, JobPosting.job_id, JobPosting.source, JobPosting.match_score,
                                   JobPosting.discovered_at, JobPosting.last_seen_at,
                                   JobPosting.content.op("-")(literal("description"))).all()
    windows = None
    if batch is not None or day is not None:
        if one is None:
            raise HTTPException(status_code=422, detail="A batch or a Day is one candidate's: name the candidate.")
    if batch is not None:
        found = scoped(db, ScrapeJob, firm_id).filter(ScrapeJob.candidate_id == one, ScrapeJob.kind == "search",
                                                      ScrapeJob.batch_id == _id_or_404(batch)).first()
        if found is None:
            raise HTTPException(status_code=404, detail="Not found.")
        windows = [(found.created_at, found.finished_at or utcnow())]
    elif day is not None:
        # Every batch of that Day in the current assignment (Q166); a Day without one lists nothing.
        owner = scoped(db, Candidate, firm_id).filter(Candidate.id == one).first()
        numbered = _numbered(db, firm_id, owner, workday.for_firm(db, firm_id)) if owner is not None else {}
        windows = [(n["window"][0], n["window"][1] or utcnow()) for n in numbered.values() if n["day"] == day]
    applied = set()
    if one is not None and exclude_applied:
        applied = {row[0] for row in scoped(db, Application, firm_id).filter(
            Application.candidate_id == one, func.lower(Application.status) != "saved").with_entities(Application.job_id)}
    groups: dict[str, list] = {}
    for row in light:
        groups.setdefault(row.job_id, []).append(row)
    wanted = (q or "").lower()
    today = utcnow().date()
    kept = []
    for key, rows in groups.items():
        newest = max(rows, key=lambda row: (row.last_seen_at, str(row.id)))
        reader = providers.reader_for(newest.source)
        try:
            fields = reader.read(newest[6] or {}) if reader else None
        except Exception:
            fields = None
        if fields is None or fields.is_closed or any(row.id in applied for row in rows):
            continue
        if not _is_recent(fields.posted_at, max(row.discovered_at for row in rows), today):
            continue
        if windows is not None and not any(start <= row.discovered_at <= end for start, end in windows
                                           for row in rows):
            continue
        if remote is not None and remote_mode(fields) != remote:
            continue
        if wanted and wanted not in f"{fields.title} {fields.company} {fields.location or ''}".lower():
            continue
        score = rows[0].match_score if one is not None else None
        if one is not None and min_score > 0 and (score is None or score < min_score):
            continue
        saved = max(row.discovered_at for row in rows)
        # Newest is by the job's posted date (decided 2026-11-16, Q87; a search saves its jobs at one moment), then
        # the latest saved; it also breaks the ties of the other two orders.
        newest_first = (-_posted_on(fields.posted_at, saved).toordinal(), -saved.timestamp())
        kept.append((key, score, newest_first, (fields.company or "").lower(), newest.source))
    source_counts: dict[str, int] = {}
    for item in kept:
        source_counts[_source_key(item[4])] = source_counts.get(_source_key(item[4]), 0) + 1
    if source is not None:
        kept = [item for item in kept if _source_key(item[4]) == source]
    # LinkedIn's jobs first in Top match and Newest (Q113): they have no Match to be ranked by.
    linkedin_last = {"match": True, "newest": True}.get(sort, False)

    def lead(item) -> bool:
        return linkedin_last and item[4] != "linkedin"
    if sort == "match" and one is not None:
        kept.sort(key=lambda item: (lead(item), item[1] is None, -(item[1] or 0), item[2], item[0]))
    elif sort == "company":
        kept.sort(key=lambda item: (item[3], item[2], item[0]))
    else:
        kept.sort(key=lambda item: (lead(item), item[2], item[0]))
    page = [item[0] for item in kept[offset:offset + limit]]
    by_job: dict[str, list[JobPosting]] = {key: [] for key in page}
    for row in postings.filter(JobPosting.job_id.in_(page)).all() if page else []:
        by_job[row.job_id].append(row)
    following = offset + limit
    return {"items": [_job_json(by_job[key], with_description=False) for key in page], "total": len(kept),
            "next_offset": following if following < len(kept) else None, "source_counts": source_counts}


@router.get("/job-postings/{posting_id}", summary="One job a candidate the principal sees has, with its description")
def get_firm_job(firm_id: uuid.UUID, posting_id: str, principal: Principal = Depends(current_principal),
                 db: DbSession = Depends(get_db)):
    """The posting, if its candidate is one the principal sees (else 404, never confirming it exists), with the
    visible candidates that have the same job."""
    _member_of(firm_id, principal)
    visible = _visible(db, firm_id, principal).with_entities(Candidate.id)
    row = scoped(db, JobPosting, firm_id).filter(JobPosting.id == _id_or_404(posting_id),
                                                 JobPosting.candidate_id.in_(visible)).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Not found.")
    rows = scoped(db, JobPosting, firm_id).filter(JobPosting.job_id == row.job_id,
                                                  JobPosting.candidate_id.in_(visible)).all()
    _fill_full_posting(db, row, principal)
    out = _job_json(rows, with_description=True)
    # The page is this posting's: its own fields, even when another candidate's copy was seen more recently.
    out.update({k: v for k, v in _posting_json(row, with_description=True).items() if k not in ("candidate_id", "batch_id")})
    return out
