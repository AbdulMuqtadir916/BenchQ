"""One job search (job search PR 1, decided 2026-11-10). The route writes the batch `running` (`open_batch`, in the
request), then runs `run_search` in the background through `job_monitor.launch_background` (job type `job_search`):

    the batch still `running`? no (never saved, or already finished) → nothing, the source isn't asked
    provider.search(query, country, 100)
      fails  → the batch finished as error (code) + ledger entry
      answers → read each job; drop closed and unreadable ones; job_id = sha256(company | title | description)
              → one transaction, the candidate row locked (two searches for one candidate count the cap in turn):
                  the batch finished as success | empty (counts in metadata)
                  a job the candidate has: batch_id, last_seen_at and content replaced; discovered_at kept
                  a new job: inserted while the candidate has room under 100 today, in the provider's order
                  ledger entry
Logs carry ids, codes, counts and timings: never the query, a job's text or the source's reply.
"""
import asyncio
import hashlib
import logging
import re
import time
import uuid

from backend.auth import ledger
from backend.auth.scoping import scoped
from backend.job_monitor import mark_run_failed
from backend.job_search import limits
from backend.job_search.providers import READERS, REGISTRY, JobFields, ProviderError, SearchResult
from backend.job_search.providers.base import ERROR_MESSAGES
from backend.job_search.text import clean_json
from backend.models.candidates import Candidate
from backend.models.db import SessionLocal, utcnow
from backend.models.job_search import JobPosting, ScrapeJob
from backend.models.tenancy import User

logger = logging.getLogger("benchq.job_search")

COUNTRY_LABELS = {"us": "US", "ca": "Canada", "in": "India"}


def job_id(fields: JobFields) -> str:
    """The job's identity for its candidate: SHA256 hex of company, title and description, each lowercased with its
    whitespace collapsed. A content change is a new job by design (docs/02 §6.y)."""
    def norm(s: str) -> str:
        return re.sub(r"\s+", " ", s or "").strip().lower()
    return hashlib.sha256("\x1f".join(norm(p) for p in (fields.company, fields.title, fields.description))
                          .encode("utf-8")).hexdigest()


def _request(query: str, country: str, provider: str, cursor: str | None = None, exhausted: bool = False) -> dict:
    return {"query": query, "country": country, "provider": provider, "limit": limits.JOBS_PER_SEARCH,
            "cursor": cursor, "exhausted": exhausted}


def _same_role(query: str) -> str:
    return re.sub(r"\s+", " ", query or "").strip().lower()


def _continue_from(db, firm_id, candidate_id, query: str, country: str, provider: str) -> tuple[str | None, bool]:
    """Where a search of this role continues today (decided 2026-11-10, Q11 (A)): after the last finished search of
    the same role, country and provider since 6:30 PM IST. (None, False) to start from the top; (None, True) when the
    source had nothing more. A failed search doesn't move it, so a retry asks for the same page."""
    rows = scoped(db, ScrapeJob, firm_id).filter(
        ScrapeJob.candidate_id == candidate_id, ScrapeJob.kind == "search",
        ScrapeJob.state.in_(("success", "empty")), ScrapeJob.created_at >= limits.day_start(),
    ).order_by(ScrapeJob.created_at.desc()).all()
    for row in rows:
        request = (row.meta or {}).get("request") or {}
        if (_same_role(request.get("query")) == _same_role(query) and request.get("country") == country
                and request.get("provider") == provider):
            next_cursor = (row.meta or {}).get("next_cursor")
            return (next_cursor, False) if next_cursor else (None, True)
    return None, False


def _ledger(db, *, firm_id, candidate_id, user_id, batch_id, query, country, summary):
    actor = db.get(User, user_id)
    ledger.record(db, actor=actor, action="CREATE", entity_type="job_search", entity_id=batch_id,
                  entity_label=f"Job search: {query}"[:200], firm_id=firm_id, candidate_id=candidate_id,
                  summary=f"{summary} ({COUNTRY_LABELS.get(country, country)})")


def open_batch(db, *, firm_id, candidate_id, user_id, query, country, provider) -> ScrapeJob:
    """The search's row, `running`, written when the BDE starts it (the caller holds the candidate row), with where
    it continues from. Flushed."""
    cursor, exhausted = _continue_from(db, firm_id, candidate_id, query, country, provider)
    batch = ScrapeJob(firm_id=firm_id, candidate_id=candidate_id, user_id=user_id, batch_id=uuid.uuid4(),
                      kind="search", state="running",
                      meta={"request": _request(query, country, provider, cursor, exhausted)})
    db.add(batch)
    db.flush()
    return batch


def discard_batch(db, firm_id, batch_id) -> None:
    """A search whose launch failed: it never started, so its `running` row is deleted (not one of the BDE's attempts,
    nothing to show). Committed."""
    db.rollback()
    scoped(db, ScrapeJob, firm_id).filter(ScrapeJob.batch_id == batch_id, ScrapeJob.state == "running").delete(
        synchronize_session=False)
    db.commit()


def _fail(db, batch: ScrapeJob, *, code: str, user_id, query: str, country: str, at) -> None:
    """Finish a running batch as an error: the code in its metadata (what the history shows, before and after) and
    its ledger entry. Not committed."""
    batch.state, batch.error, batch.finished_at = "error", f"{code}: {ERROR_MESSAGES[code]}", at
    batch.meta = {**(batch.meta or {}), "error_code": code}
    _ledger(db, firm_id=batch.firm_id, candidate_id=batch.candidate_id, user_id=user_id, batch_id=batch.batch_id,
            query=query, country=country, summary=f"Searched jobs for '{query}': failed ({code})")


def expire_lost(db, firm_id, candidate_id, now=None) -> int:
    """Finish the candidate's lost searches (`running` for longer than `limits.RUNNING_FOR_AT_MOST`: a restart, a dead
    worker) as `internal` errors, each like any failed search: `error_code` in its metadata and a ledger entry
    credited to the BDE who started it (Abdul's review, P3). Called by the next search's admission, which holds the
    candidate row. Flushed, not committed. Returns how many."""
    now = now or utcnow()
    lost = scoped(db, ScrapeJob, firm_id).filter(
        ScrapeJob.candidate_id == candidate_id, ScrapeJob.state == "running", ScrapeJob.kind == "search",
        ScrapeJob.created_at < now - limits.RUNNING_FOR_AT_MOST,
    ).with_for_update().all()
    for batch in lost:
        request = (batch.meta or {}).get("request") or {}
        _fail(db, batch, code="internal", user_id=batch.user_id, query=request.get("query") or "",
              country=request.get("country") or "", at=now)
    db.flush()
    return len(lost)


def _running_request(firm_id, candidate_id, batch_id) -> dict | None:
    """The task's batch request (where it continues from), or None unless the batch exists and is `running` (a
    scoped read): the route never committed it, or it already finished (marked lost). The task then never asks the
    source (Abdul's second review, P2)."""
    with SessionLocal() as db:
        row = scoped(db, ScrapeJob, firm_id, ScrapeJob.meta).filter(
            ScrapeJob.candidate_id == candidate_id, ScrapeJob.batch_id == batch_id,
            ScrapeJob.state == "running").first()
    return None if row is None else ((row[0] or {}).get("request") or {})


def _running_batch(db, firm_id, candidate_id, batch_id) -> ScrapeJob | None:
    """The batch to finish, with its candidate locked; None when it was already finished (marked lost after 15
    minutes), so a late task writes nothing."""
    scoped(db, Candidate, firm_id, Candidate.id).filter(Candidate.id == candidate_id).with_for_update().one()
    batch = scoped(db, ScrapeJob, firm_id).filter(ScrapeJob.candidate_id == candidate_id,
                                                 ScrapeJob.batch_id == batch_id).with_for_update().one_or_none()
    if batch is None or batch.state != "running":
        logger.warning("job search batch=%s candidate=%s no longer running; result dropped", batch_id, candidate_id)
        return None
    return batch


def _save_error(*, firm_id, candidate_id, user_id, batch_id, query, country, provider, code) -> None:
    with SessionLocal() as db:
        batch = _running_batch(db, firm_id, candidate_id, batch_id)
        if batch is None:
            return
        _fail(db, batch, code=code, user_id=user_id, query=query, country=country, at=utcnow())
        db.commit()


def _read(provider, raw: dict) -> JobFields | None:
    try:
        fields = provider.read(raw)
    except Exception:
        return None
    return fields if fields.title and fields.company and fields.description else None


def _save(*, firm_id, candidate_id, user_id, batch_id, query, country, provider, result: SearchResult) -> dict | None:
    counts = {"found": len(result.jobs), "saved": 0, "refreshed": 0, "skipped_closed": 0, "skipped_unreadable": 0,
              "skipped_duplicate": 0, "skipped_over_cap": 0}
    # Read and identify every job before the transaction: no lock is held while parsing HTML.
    picked: list[tuple[str, dict]] = []
    seen: set[str] = set()
    for raw in result.jobs:
        fields = _read(provider, raw)
        if fields is None:
            counts["skipped_unreadable"] += 1
            continue
        if fields.is_closed:
            counts["skipped_closed"] += 1
            continue
        key = job_id(fields)
        if key in seen:
            counts["skipped_duplicate"] += 1
            continue
        seen.add(key)
        picked.append((key, clean_json(raw)))

    with SessionLocal() as db:
        batch = _running_batch(db, firm_id, candidate_id, batch_id)
        if batch is None:
            return None
        now = utcnow()
        room = max(0, limits.JOBS_PER_CANDIDATE_PER_DAY - limits.jobs_saved_today(db, firm_id, candidate_id, now))
        existing = {row.job_id: row for row in scoped(db, JobPosting, firm_id).filter(
            JobPosting.candidate_id == candidate_id, JobPosting.job_id.in_([k for k, _ in picked]))} if picked else {}

        batch.state, batch.finished_at = ("success" if result.jobs else "empty"), now
        kept = {k: v for k, v in (batch.meta or {}).items() if k in ("run_id", "request")}   # the run link, the ask
        batch.meta = {**clean_json(result.metadata), **kept, "next_cursor": result.next_cursor}
        db.flush()
        for key, content in picked:
            row = existing.get(key)
            if row is not None:
                if (row.content or {}).get("_full_posting") and row.source == provider.name:
                    # The whole posting fetched on its first open stays (CodeRabbit on #135): the search's is cut.
                    content = {**content, "description": row.content.get("description"), "_full_posting": True}
                row.batch_id, row.last_seen_at, row.content, row.source = batch_id, now, content, provider.name
                counts["refreshed"] += 1
            elif counts["saved"] < room:
                db.add(JobPosting(firm_id=firm_id, candidate_id=candidate_id, batch_id=batch_id, source=provider.name,
                                  first_source=provider.name, job_id=key, content=content, discovered_at=now,
                                  last_seen_at=now))
                counts["saved"] += 1
            else:
                counts["skipped_over_cap"] += 1
        batch.meta = {**batch.meta, "counts": counts}
        _ledger(db, firm_id=firm_id, candidate_id=candidate_id, user_id=user_id, batch_id=batch_id, query=query,
                country=country, summary=f"Searched jobs for '{query}': {counts['saved']} new, "
                                         f"{counts['refreshed']} seen again")
        db.commit()
    return counts


def capture(db, *, firm_id, candidate_id, user_id, source: str, job: dict, admit=None) -> tuple[JobPosting, bool]:
    """One job the BDE captured (job search PR 2): its own batch (`kind = 'capture'`, finished at once) with its one
    posting, and a ledger entry. The caller holds the candidate row. A job the candidate already has (same `job_id`) is
    returned as it is, with nothing written: (posting, False), whatever the cap says, so a retry after a lost response
    gets its posting back (Abdul's comment on PR 2). Only a capture that would create a posting calls `admit()` first,
    which raises to refuse it (the daily cap). Not committed."""
    content = clean_json({k: v for k, v in job.items() if v is not None})
    fields = READERS[source].read(content)
    key = job_id(fields)
    existing = scoped(db, JobPosting, firm_id).filter(JobPosting.candidate_id == candidate_id,
                                                      JobPosting.job_id == key).first()
    if existing is not None:
        return existing, False
    if admit is not None:
        admit()
    now = utcnow()
    batch = ScrapeJob(firm_id=firm_id, candidate_id=candidate_id, user_id=user_id, batch_id=uuid.uuid4(),
                      kind="capture", state="success", finished_at=now, meta={"request": {"source": source}})
    db.add(batch)
    db.flush()
    posting = JobPosting(firm_id=firm_id, candidate_id=candidate_id, batch_id=batch.batch_id, source=source,
                         first_source=source, job_id=key, content=content, discovered_at=now, last_seen_at=now)
    db.add(posting)
    db.flush()
    actor = db.get(User, user_id)
    ledger.record(db, actor=actor, action="CREATE", entity_type="job_posting", entity_id=posting.id,
                  entity_label=f"{fields.title} at {fields.company}"[:200], firm_id=firm_id, candidate_id=candidate_id,
                  summary=f"Captured a job ({source})")
    return posting, True


async def run_search(*, firm_id: uuid.UUID, candidate_id: uuid.UUID, user_id: uuid.UUID, batch_id: uuid.UUID,
                     query: str, country: str, provider_name: str) -> str:
    """The background task: finishes the `running` batch `batch_id`. Returns the run's summary; a failed search also
    marks its `job_runs` row failed."""
    provider = REGISTRY[provider_name]
    started = time.monotonic()
    ids = dict(firm_id=firm_id, candidate_id=candidate_id, user_id=user_id, batch_id=batch_id, query=query,
               country=country)
    try:
        request = await asyncio.to_thread(_running_request, firm_id, candidate_id, batch_id)
    except Exception as error:          # a database blip: the batch ends as an error now, not `running` for 15 minutes
        logger.error("job search batch=%s candidate=%s start check failed %s", batch_id, candidate_id,
                     type(error).__name__)
        try:
            await asyncio.to_thread(_save_error, provider=provider.name, code="internal", **ids)
        except Exception as save_error:
            logger.error("job search batch=%s candidate=%s error not saved %s", batch_id, candidate_id,
                         type(save_error).__name__)
        mark_run_failed("internal")
        return "failed: internal"
    if request is None:
        logger.warning("job search batch=%s candidate=%s not running at start; source not asked", batch_id,
                       candidate_id)
        return "dropped: the search was no longer running"
    cursor, exhausted = request.get("cursor"), bool(request.get("exhausted"))
    try:
        # The source had nothing more for this role today: finish empty without asking again.
        result = SearchResult(jobs=[], metadata={"exhausted": True}) if exhausted else \
            await provider.search(query, country, limits.JOBS_PER_SEARCH, cursor)
    except ProviderError as error:
        code = error.code
    except Exception as error:          # the provider's own bug: its message may hold a URL, so only its type is logged
        logger.error("job search batch=%s candidate=%s provider=%s unexpected %s", batch_id, candidate_id,
                     provider.name, type(error).__name__)
        code = "internal"
    else:
        try:
            counts = await asyncio.to_thread(_save, provider=provider, result=result, **ids)
        except Exception as error:
            logger.error("job search batch=%s candidate=%s save failed %s", batch_id, candidate_id,
                         type(error).__name__)
            code = "internal"
        else:
            if counts is None:
                return "dropped: the search was no longer running"
            logger.info("job search batch=%s candidate=%s provider=%s state=%s found=%d saved=%d refreshed=%d "
                        "over_cap=%d ms=%d", batch_id, candidate_id, provider.name,
                        "success" if result.jobs else "empty", counts["found"], counts["saved"], counts["refreshed"],
                        counts["skipped_over_cap"], (time.monotonic() - started) * 1000)
            return f"{counts['saved']} new, {counts['refreshed']} seen again"

    logger.warning("job search batch=%s candidate=%s provider=%s state=error code=%s ms=%d", batch_id, candidate_id,
                   provider.name, code, (time.monotonic() - started) * 1000)
    try:
        await asyncio.to_thread(_save_error, provider=provider.name, code=code, **ids)
    except Exception as error:
        logger.error("job search batch=%s candidate=%s error row failed %s", batch_id, candidate_id,
                     type(error).__name__)
    mark_run_failed(code)
    return f"failed: {code}"
