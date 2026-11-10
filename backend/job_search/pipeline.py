"""One job search (job search PR 1, decided 2026-11-10). The route writes the batch `running` (`open_batch`, in the
request), then runs `run_search` in the background through `job_monitor.launch_background` (job type `job_search`):

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
from backend.job_monitor import mark_run_failed
from backend.job_search import limits
from backend.job_search.providers import REGISTRY, JobFields, ProviderError, SearchResult
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


def _request(query: str, country: str, provider: str) -> dict:
    return {"query": query, "country": country, "provider": provider, "limit": limits.JOBS_PER_SEARCH}


def _ledger(db, *, firm_id, candidate_id, user_id, batch_id, query, country, summary):
    actor = db.get(User, user_id)
    ledger.record(db, actor=actor, action="CREATE", entity_type="job_search", entity_id=batch_id,
                  entity_label=f"Job search: {query}"[:200], firm_id=firm_id, candidate_id=candidate_id,
                  summary=f"{summary} ({COUNTRY_LABELS.get(country, country)})")


def open_batch(db, *, firm_id, candidate_id, user_id, query, country, provider) -> ScrapeJob:
    """The search's row, `running`, written when the BDE starts it (the caller holds the candidate row). Flushed."""
    batch = ScrapeJob(firm_id=firm_id, candidate_id=candidate_id, user_id=user_id, batch_id=uuid.uuid4(),
                      state="running", meta={"request": _request(query, country, provider)})
    db.add(batch)
    db.flush()
    return batch


def _running_batch(db, firm_id, candidate_id, batch_id) -> ScrapeJob | None:
    """The batch to finish, with its candidate locked; None when it was already finished (marked lost after 15
    minutes), so a late task writes nothing."""
    db.query(Candidate.id).filter(Candidate.firm_id == firm_id, Candidate.id == candidate_id).with_for_update().one()
    batch = db.query(ScrapeJob).filter(ScrapeJob.firm_id == firm_id, ScrapeJob.candidate_id == candidate_id,
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
        batch.state, batch.error, batch.finished_at = "error", f"{code}: {ERROR_MESSAGES[code]}", utcnow()
        batch.meta = {**(batch.meta or {}), "request": _request(query, country, provider), "error_code": code}
        _ledger(db, firm_id=firm_id, candidate_id=candidate_id, user_id=user_id, batch_id=batch_id, query=query,
                country=country, summary=f"Searched jobs for '{query}': failed ({code})")
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
        existing = {row.job_id: row for row in db.query(JobPosting).filter(
            JobPosting.candidate_id == candidate_id, JobPosting.job_id.in_([k for k, _ in picked]))} if picked else {}

        batch.state, batch.finished_at = ("success" if result.jobs else "empty"), now
        kept = {k: v for k, v in (batch.meta or {}).items() if k == "run_id"}     # the run → batch link
        batch.meta = {**clean_json(result.metadata), **kept, "request": _request(query, country, provider.name)}
        db.flush()
        for key, content in picked:
            row = existing.get(key)
            if row is not None:
                row.batch_id, row.last_seen_at, row.content, row.source = batch_id, now, content, provider.name
                counts["refreshed"] += 1
            elif counts["saved"] < room:
                db.add(JobPosting(firm_id=firm_id, candidate_id=candidate_id, batch_id=batch_id, source=provider.name,
                                  job_id=key, content=content, discovered_at=now, last_seen_at=now))
                counts["saved"] += 1
            else:
                counts["skipped_over_cap"] += 1
        batch.meta = {**batch.meta, "counts": counts}
        _ledger(db, firm_id=firm_id, candidate_id=candidate_id, user_id=user_id, batch_id=batch_id, query=query,
                country=country, summary=f"Searched jobs for '{query}': {counts['saved']} new, "
                                         f"{counts['refreshed']} seen again")
        db.commit()
    return counts


async def run_search(*, firm_id: uuid.UUID, candidate_id: uuid.UUID, user_id: uuid.UUID, batch_id: uuid.UUID,
                     query: str, country: str, provider_name: str) -> str:
    """The background task: finishes the `running` batch `batch_id`. Returns the run's summary; a failed search also
    marks its `job_runs` row failed."""
    provider = REGISTRY[provider_name]
    started = time.monotonic()
    ids = dict(firm_id=firm_id, candidate_id=candidate_id, user_id=user_id, batch_id=batch_id, query=query,
               country=country)
    try:
        result = await provider.search(query, country, limits.JOBS_PER_SEARCH)
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
