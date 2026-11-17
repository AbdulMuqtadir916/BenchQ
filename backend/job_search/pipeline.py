"""One job search (job search PR 1, decided 2026-11-10). The route writes the batch `running` (`open_batch`, in the
request), then runs `run_search` in the background through `job_monitor.launch_background` (job type `job_search`):

    the batch still `running`? no (never saved, or already finished) → nothing, the source isn't asked
    provider.search(role, country, 100, cursor, place=the chosen place, posted_within_days=14, titles=the role's
                    titles (Q69), years=the most years the candidate can take (Q74), firm_id)
      fails  → the batch finished as error (code) + ledger entry
      answers → read each job; leave out closed and unreadable ones, ones posted over 14 days ago, ones not remote
                on a Remote search, ones whose text rules out the candidate's work authorization (decided
                2026-11-14; the Match calculator's eligibility rules, backend/match/score.py `ruled_out`, Q32), and
                ones Match holds at 40 for the candidate's level (2026-11-16, Q70); each counted. A job without its
                text (LinkedIn's, Q80) skips the two text rules; job_id = sha256(company | title | description), or
                of the source's own id for a job without its text
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
from datetime import date

from backend.auth import ledger
from backend.auth.scoping import scoped
from backend.job_monitor import mark_run_failed
from backend.job_search import limits, places
from backend.match import score as match, store as match_store
from backend.job_search.providers import READERS, REGISTRY, REMOTE, JobFields, ProviderError, SearchResult
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
    if fields.source_id:                # a job the source sends without its text (LinkedIn): its own id
        return hashlib.sha256(fields.source_id.encode("utf-8")).hexdigest()
    return hashlib.sha256("\x1f".join(norm(p) for p in (fields.company, fields.title, fields.description))
                          .encode("utf-8")).hexdigest()


def _request(query: str, country: str, provider: str, place: str | None, cursor: str | None = None,
             exhausted: bool = False, titles=()) -> dict:
    return {"query": query, "titles": list(titles or ()), "country": country, "place": place, "provider": provider,
            "limit": limits.JOBS_PER_SEARCH, "posted_within_days": limits.POSTED_WITHIN_DAYS, "cursor": cursor,
            "exhausted": exhausted}


def _same_role(query: str) -> str:
    return re.sub(r"\s+", " ", query or "").strip().lower()


def _continue_from(db, firm_id, candidate_id, query: str, country: str, provider: str,
                   place: str | None) -> tuple[str | None, bool]:
    """Where a search of this role continues today (decided 2026-11-10, Q11 (A)): after the last finished search of
    the same role, place (2026-11-14), country and provider since 6:30 PM IST. (None, False) to start from the top; (None, True) when the
    source had nothing more. A failed search doesn't move it, so a retry asks for the same page."""
    rows = scoped(db, ScrapeJob, firm_id).filter(
        ScrapeJob.candidate_id == candidate_id, ScrapeJob.kind == "search",
        ScrapeJob.state.in_(("success", "empty")), ScrapeJob.created_at >= limits.day_start(),
    ).order_by(ScrapeJob.created_at.desc()).all()
    for row in rows:
        request = (row.meta or {}).get("request") or {}
        if (_same_role(request.get("query")) == _same_role(query) and request.get("country") == country
                and request.get("provider") == provider
                and _same_role(request.get("place")) == _same_role(place)):
            next_cursor = (row.meta or {}).get("next_cursor")
            return (next_cursor, False) if next_cursor else (None, True)
    return None, False


def _ledger(db, *, firm_id, candidate_id, user_id, batch_id, query, country, summary):
    """The search's Activity entry; `summary` already names the role and the place."""
    actor = db.get(User, user_id)
    ledger.record(db, actor=actor, action="CREATE", entity_type="job_search", entity_id=batch_id,
                  entity_label=f"Job search: {query}"[:200], firm_id=firm_id, candidate_id=candidate_id,
                  summary=f"{summary} ({COUNTRY_LABELS.get(country, country)})")


ALL_SOURCES = "all"                     # a click that asks every source its place's mode names (fanout.py)


def open_batch(db, *, firm_id, candidate_id, user_id, query, country, provider, place=None, titles=()) -> ScrapeJob:
    """The search's row, `running`, written when the BDE starts it (the caller holds the candidate row), with where
    it continues from: one cursor for one source, or each leg's for `ALL_SOURCES` (decided 2026-11-17). Flushed."""
    if provider == ALL_SOURCES:
        from backend.job_search import fanout
        rows = scoped(db, ScrapeJob, firm_id).filter(
            ScrapeJob.candidate_id == candidate_id, ScrapeJob.kind == "search",
            ScrapeJob.state.in_(("success", "empty")), ScrapeJob.created_at >= limits.day_start(),
        ).order_by(ScrapeJob.created_at.desc()).all()
        request = {**_request(query, country, provider, place, None, False, titles),
                   "legs": fanout.continue_legs(rows, query, country, fanout.plan(place))}
    else:
        cursor, exhausted = _continue_from(db, firm_id, candidate_id, query, country, provider, place)
        request = _request(query, country, provider, place, cursor, exhausted, titles)
    batch = ScrapeJob(firm_id=firm_id, candidate_id=candidate_id, user_id=user_id, batch_id=uuid.uuid4(),
                      kind="search", state="running", meta={"request": request})
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


def _searched(query: str, place: str | None) -> str:
    return f"Searched jobs for '{query}' in {places.label(place)}"


def _fail(db, batch: ScrapeJob, *, code: str, user_id, query: str, country: str, at, place: str | None = None) -> None:
    """Finish a running batch as an error: the code in its metadata (what the history shows, before and after) and
    its ledger entry. Not committed."""
    batch.state, batch.error, batch.finished_at = "error", f"{code}: {ERROR_MESSAGES[code]}", at
    batch.meta = {**(batch.meta or {}), "error_code": code}
    _ledger(db, firm_id=batch.firm_id, candidate_id=batch.candidate_id, user_id=user_id, batch_id=batch.batch_id,
            query=query, country=country, summary=f"{_searched(query, place)}: failed ({code})")


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
              country=request.get("country") or "", at=now, place=request.get("place"))
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


def _save_error(*, firm_id, candidate_id, user_id, batch_id, query, country, provider, code, place=None) -> None:
    with SessionLocal() as db:
        batch = _running_batch(db, firm_id, candidate_id, batch_id)
        if batch is None:
            return
        _fail(db, batch, code=code, user_id=user_id, query=query, country=country, at=utcnow(), place=place)
        db.commit()


def _read(provider, raw: dict) -> JobFields | None:
    """The job's fields, or None when it can't be read: a title, a company and its text, unless the source sends none
    (LinkedIn, Q80: then its own id)."""
    try:
        fields = provider.read(raw)
    except Exception:
        return None
    has_text = bool(fields.description) or (not getattr(provider, "sends_descriptions", True) and bool(fields.source_id))
    return fields if fields.title and fields.company and has_text else None


def _posted_too_long_ago(posted_at: str | None, today: date) -> bool:
    """Posted more than `POSTED_WITHIN_DAYS` days ago, by the job's own date (decided 2026-11-14, Q7: a source's date
    filter isn't trusted; Indeed's is "listed on Indeed"). No date, or one that doesn't read: kept."""
    try:
        posted = date.fromisoformat((posted_at or "")[:10])
    except ValueError:
        return False
    return (today - posted).days > limits.POSTED_WITHIN_DAYS


def _scorer(firm_id, candidate_id) -> match_store.Scorer | None:
    """The candidate's side of the Match score, read once for the whole search: their active résumé's v1 and themselves
    as the calculator reads them (its eligibility rules also filter the search: Q32)."""
    with SessionLocal() as db:
        row = scoped(db, Candidate, firm_id).filter(Candidate.id == candidate_id).first()
        return match_store.scorer_for(db, row) if row is not None else None


def new_counts(result: SearchResult) -> dict:
    return {"found": len(result.jobs), "saved": 0, "refreshed": 0, "skipped_closed": 0, "skipped_unreadable": 0,
            "skipped_duplicate": 0, "skipped_over_cap": 0, "skipped_too_old": 0, "skipped_not_remote": 0,
            "skipped_work_auth": 0, "skipped_level": 0,
            # Left out by the source itself before the save (freehire.me's Adzuna previews, Q64).
            "skipped_adzuna": int((result.metadata or {}).get("skipped_adzuna") or 0)}


def pick(provider, result: SearchResult, remote_only: bool, scorer, counts: dict) -> list[tuple[str, dict, JobFields]]:
    """The jobs a search keeps, read and identified before any transaction (no lock is held while parsing HTML):
    (job_id, content, fields), in the source's order; every one left out is counted."""
    today = utcnow().date()
    picked: list[tuple[str, dict, JobFields]] = []
    seen: set[str] = set()
    for raw in result.jobs:
        fields = _read(provider, raw)
        if fields is None:
            counts["skipped_unreadable"] += 1
            continue
        if fields.is_closed:
            counts["skipped_closed"] += 1
            continue
        if _posted_too_long_ago(fields.posted_at, today):
            counts["skipped_too_old"] += 1
            continue
        if remote_only and not fields.is_remote:
            counts["skipped_not_remote"] += 1
            continue
        if scorer is not None and fields.description and match.ruled_out(fields, scorer.who):    # the posting rules them out (Q32)
            counts["skipped_work_auth"] += 1
            continue
        # Not the candidate's level (Q70): read from the posting, or from the title alone for a job without its text
        # (LinkedIn's, Q97).
        if scorer is not None and scorer.resume is not None \
                and match.score(scorer.resume, fields, scorer.who).wrong_level:
            counts["skipped_level"] += 1
            continue
        key = job_id(fields)
        if key in seen:
            counts["skipped_duplicate"] += 1
            continue
        seen.add(key)
        picked.append((key, clean_json(raw), fields))
    return picked


def _save(*, firm_id, candidate_id, user_id, batch_id, query, country, provider, result: SearchResult,
          place: str | None = None, scorer=False) -> dict | None:
    counts = new_counts(result)
    if scorer is False:                 # not read by the caller
        scorer = _scorer(firm_id, candidate_id)
    picked = [(key, content) for key, content, _ in pick(provider, result, place == REMOTE, scorer, counts)]

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
                from backend.job_search.fanout import _keep_pasted
                # A posting fetched whole or pasted by the BDE stays (CodeRabbit on #135; Q107): the search's is
                # shorter, or none.
                content = _keep_pasted(row, content, provider.name)
                row.batch_id, row.last_seen_at, row.content, row.source = batch_id, now, content, provider.name
                counts["refreshed"] += 1
            elif counts["saved"] < room:
                row = JobPosting(firm_id=firm_id, candidate_id=candidate_id, batch_id=batch_id, source=provider.name,
                                 first_source=provider.name, job_id=key, content=content, discovered_at=now,
                                 last_seen_at=now)
                db.add(row)
                counts["saved"] += 1
            else:
                counts["skipped_over_cap"] += 1
                continue
            if scorer is not None:
                match_store.apply(row, scorer, match_store.fields_of(row))     # its Match, as it is saved (Q35)
        batch.meta = {**batch.meta, "counts": counts}
        _ledger(db, firm_id=firm_id, candidate_id=candidate_id, user_id=user_id, batch_id=batch_id, query=query,
                country=country, summary=f"{_searched(query, place)}: {counts['saved']} new, "
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
    candidate = scoped(db, Candidate, firm_id).filter(Candidate.id == candidate_id).first()
    if candidate is not None:
        match_store.score_posting(db, candidate, posting)          # its Match, as it is saved (Q35)
    actor = db.get(User, user_id)
    ledger.record(db, actor=actor, action="CREATE", entity_type="job_posting", entity_id=posting.id,
                  entity_label=f"{fields.title} at {fields.company}"[:200], firm_id=firm_id, candidate_id=candidate_id,
                  summary=f"Captured a job ({source})")
    return posting, True


async def run_search(*, firm_id: uuid.UUID, candidate_id: uuid.UUID, user_id: uuid.UUID, batch_id: uuid.UUID,
                     query: str, country: str, provider_name: str, place: str | None = None, titles=()) -> str:
    """The background task: finishes the `running` batch `batch_id`. Returns the run's summary; a failed search also
    marks its `job_runs` row failed. `provider_name` `ALL_SOURCES`: one click asks every source its place's mode names
    (fanout.py, decided 2026-11-17); otherwise that one source."""
    provider = REGISTRY[provider_name] if provider_name != ALL_SOURCES else REGISTRY["indeed"]
    started = time.monotonic()
    ids = dict(firm_id=firm_id, candidate_id=candidate_id, user_id=user_id, batch_id=batch_id, query=query,
               country=country, place=place)
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
    titles = list(titles or request.get("titles") or ())
    try:
        scorer = await asyncio.to_thread(_scorer, firm_id, candidate_id)
    except Exception:
        scorer = None                   # scored and filtered without it: the save reads it again
    years = match.most_years_asked(scorer.resume, scorer.who) if scorer is not None else None
    level = match.level_of(scorer.resume, scorer.who) if scorer is not None else None
    if provider_name == ALL_SOURCES:
        from backend.job_search import fanout
        try:
            summary = await fanout.run(firm_id=firm_id, candidate_id=candidate_id, user_id=user_id, batch_id=batch_id,
                                       query=query, country=country, place=place, titles=titles, request=request,
                                       scorer=scorer, years=years, level=level)
        except Exception as error:      # the save failed: the batch ends as an error, not `running` for 15 minutes
            logger.error("job search batch=%s candidate=%s all sources failed %s", batch_id, candidate_id,
                         type(error).__name__)
            try:
                await asyncio.to_thread(_save_error, provider=ALL_SOURCES, code="internal", **ids)
            except Exception:
                pass
            mark_run_failed("internal")
            return "failed: internal"
        if summary.startswith("failed: "):
            mark_run_failed(summary.removeprefix("failed: "))
        return summary
    try:
        # The source had nothing more for this role today: finish empty without asking again.
        result = SearchResult(jobs=[], metadata={"exhausted": True}) if exhausted else \
            await provider.search(query, country, limits.JOBS_PER_SEARCH, cursor, place=place,
                                  posted_within_days=limits.POSTED_WITHIN_DAYS, titles=titles, years=years,
                                  level=level, firm_id=firm_id)
    except ProviderError as error:
        code = error.code
    except Exception as error:          # the provider's own bug: its message may hold a URL, so only its type is logged
        logger.error("job search batch=%s candidate=%s provider=%s unexpected %s", batch_id, candidate_id,
                     provider.name, type(error).__name__)
        code = "internal"
    else:
        try:
            counts = await asyncio.to_thread(_save, provider=provider, result=result,
                                             scorer=scorer if scorer is not None else False, **ids)
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
