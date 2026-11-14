"""The Match score, stored (decided 2026-11-14, Q34, Q35, Q39, Q49; migration 0028).

What is scored, against what:
- **a candidate's job** (`job_postings`): the candidate's active résumé's version 1 (Q34, the version tailoring starts
  from), against the job's text as its source reads it;
- **a tailored version** (`resumes`, category TAILORED): that version, against its own job (Q39: the "Resume sent"
  tag). It never ranks jobs.

Each row keeps `match_basis`, a SHA-256 of everything its score was worked out from: the calculator's version, the
résumé version scored, the candidate's fields it reads (`score.Who`) and the job's text. A row is scored when its basis
doesn't match: so a new job, a job whose text changed, a new active résumé, an edit to the candidate's details and a
new calculator all lead to a new score, by one rule.

When: a search's save and a capture score their jobs as they write them; a résumé or details edit re-scores the
candidate in the background (`rescore_later`); and the backend, when it starts, scores every row whose basis doesn't
match, one candidate at a time, in one thread, under a Postgres advisory lock so one process does it (Q49). Logs carry
counts and timings only.
"""
import dataclasses
import hashlib
import json
import logging
import threading
import time
import uuid
from dataclasses import dataclass

from fastapi import HTTPException
from sqlalchemy import text

from backend.auth.scoping import scoped
from backend.job_search.country import search_country
from backend.job_search.providers import reader_for
from backend.match import score as match
from backend.match.ats_match import VERSION
from backend.match.ats_match_terms import ResumeFacts
from backend.models.candidates import Candidate
from backend.models.db import Resume, SessionLocal
from backend.models.job_search import JobPosting

logger = logging.getLogger("benchq.match")

# The startup pass's lock (any constant both processes agree on; pg_try_advisory_lock takes a bigint).
_LOCK = 2026_11_14_28


@dataclass(frozen=True)
class Scorer:
    """One candidate's side of every score: their résumé read once, and themselves as the calculator reads them."""
    who: match.Who
    resume_id: uuid.UUID | None = None
    resume: ResumeFacts | None = None


def scorer_for(db, candidate, version=None) -> Scorer:
    """`version` (a tailored one), else the candidate's active résumé's v1. Without one (none is active), a Scorer
    that scores nothing: its `who` still reads eligibility."""
    from backend.candidates.versions import content_of
    from backend.resume_tailor.runs import tailoring_source
    who = match.who(candidate, search_country(candidate.country))
    if version is None:
        try:
            version = tailoring_source(db, candidate)
        except HTTPException:
            return Scorer(who=who)
    try:
        return Scorer(who=who, resume_id=version.id, resume=match.read_resume(content_of(version)))
    except Exception as error:          # a résumé the calculator can't read scores nothing; the job is still saved
        logger.warning("match resume unreadable resume_id=%s %s", version.id, type(error).__name__)
        return Scorer(who=who)


def fields_of(posting: JobPosting):
    """The posting as its source reads it, or None when it can't be read."""
    reader = reader_for(posting.source)
    try:
        fields = reader.read(posting.content or {}) if reader else None
    except Exception:
        return None
    return fields if fields is not None and fields.title else None


def basis(scorer: Scorer, fields) -> str:
    payload = [VERSION, str(scorer.resume_id), dataclasses.astuple(scorer.who),
               fields.title, fields.company, fields.location, fields.description]
    return hashlib.sha256(json.dumps(payload, default=str).encode()).hexdigest()


def apply(row, scorer: Scorer, fields) -> bool:
    """Score `row` (a JobPosting or a tailored Resume) against `fields` unless its basis matches. True when written."""
    if scorer.resume is None or fields is None:
        return False
    current = basis(scorer, fields)
    if row.match_basis == current:
        return False
    try:
        found = match.score(scorer.resume, fields, scorer.who)
    except Exception as error:          # never fails the save: the row stays unscored, and the next pass tries again
        logger.warning("match score failed row_id=%s %s", getattr(row, "id", None), type(error).__name__)
        return False
    row.match_score, row.match_note, row.match_basis = found.score, found.note, current
    return True


def score_posting(db, candidate, posting: JobPosting) -> bool:
    """One job, as a capture writes it (the caller commits)."""
    return apply(posting, scorer_for(db, candidate), fields_of(posting))


def score_tailored(db, candidate, version: Resume, posting: JobPosting) -> bool:
    """A tailored version against its job, as tailoring writes it (the caller commits)."""
    return apply(version, scorer_for(db, candidate, version), fields_of(posting))


def rescore(firm_id, candidate_id) -> int:
    """Every row of one candidate whose basis doesn't match, scored again and committed. The count written."""
    with SessionLocal() as db:
        candidate = scoped(db, Candidate, firm_id).filter(Candidate.id == candidate_id).first()
        if candidate is None:
            return 0
        scorer, written = scorer_for(db, candidate), 0
        postings = {p.id: p for p in scoped(db, JobPosting, firm_id).filter(JobPosting.candidate_id == candidate_id)}
        for posting in postings.values():
            written += apply(posting, scorer, fields_of(posting))
        tailored = scoped(db, Resume, firm_id).filter(Resume.candidate_id == candidate_id, Resume.category == "TAILORED",
                                                      Resume.deleted_at.is_(None))
        for version in tailored:
            posting = postings.get(version.job_id)
            if posting is not None:
                written += apply(version, scorer_for(db, candidate, version), fields_of(posting))
        db.commit()
    return written


def _rescore_quietly(firm_id, candidate_id) -> None:
    try:
        rescore(firm_id, candidate_id)
    except Exception as error:          # the next pass tries again
        logger.warning("match rescore failed firm_id=%s candidate_id=%s %s", firm_id, candidate_id,
                       type(error).__name__)


def rescore_later(background, firm_id, candidate_id) -> None:
    """`rescore` after the response to the request that changed the candidate or their résumé (FastAPI's
    `BackgroundTasks`: the same worker, once the answer is sent)."""
    background.add_task(_rescore_quietly, firm_id, candidate_id)


def score_everything() -> None:
    """The startup pass (Q49): every candidate's rows whose basis doesn't match, one candidate at a time."""
    started, candidates, written = time.monotonic(), 0, 0
    with SessionLocal() as db:
        if not db.execute(text("SELECT pg_try_advisory_lock(:key)"), {"key": _LOCK}).scalar():
            return                                       # another process is doing it
        try:
            # Every firm's candidates: this is the platform's own pass, no user reads the rows.
            for firm_id, candidate_id in db.query(Candidate.firm_id, Candidate.id).order_by(Candidate.created_at).all():
                try:
                    written += rescore(firm_id, candidate_id)
                except Exception:
                    logger.exception("match pass failed firm_id=%s candidate_id=%s", firm_id, candidate_id)
                candidates += 1
        finally:
            db.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": _LOCK})
            db.commit()
    logger.info("match pass candidates=%d scored=%d ms=%d version=%s", candidates, written,
                (time.monotonic() - started) * 1000, VERSION)


def start_pass() -> None:
    threading.Thread(target=score_everything, name="match-pass", daemon=True).start()
