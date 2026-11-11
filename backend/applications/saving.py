"""Adding a job for a candidate, and saving it (decided 2026-11-11, the add-job plan).

- `add_job()`: a job the BDE adds, by hand or from the extension, becomes one of the candidate's `job_postings`, in a
  batch of its own (a finished capture, `kind = 'capture'`, as `backend.job_search.pipeline.capture` writes one). The
  same job again (the same identity, `job_hash`) is the posting the candidate already has: nothing is written.
- `ensure_saved()`: the candidate's application for a posting: the one they have, at any status, or a new Saved one.
  Adding a job always ends with one, so an added job is ready to apply to.

The caller holds the candidate's row (`_candidate(..., lock=True)`), so two adds of one job take turns, and commits.
Both write a ledger entry naming the job, never its description.
"""
import re
import uuid
from datetime import datetime, timezone
from urllib.parse import parse_qsl, urlsplit

from sqlalchemy import func

from backend.applications.postings import ADDED_SOURCES, job_hash, posting_job, read_content
from backend.auth.ledger import record
from backend.auth.scoping import scoped
from backend.models.db import Application, utcnow
from backend.models.job_search import JobPosting, ScrapeJob


def _clean(value):
    """A value Postgres keeps in JSONB: text without NUL characters."""
    return value.replace("\x00", "") if isinstance(value, str) else value


_JOB_KEYS = {"gh_jid", "jk", "vjk", "jobid", "job_id", "id", "req", "reqid", "req_id", "requisitionid", "pid", "currentjobid"}
# Codes that name one job in a link: a UUID (Lever, Ashby), a long number (Greenhouse, LinkedIn), a requisition code
# (Workday's R123456, JR-1234), as the extension reads them (extension/src/autofill/AddJobCard.tsx `jobIdsOf`).
_ID_IN_LINK = re.compile(r"(?<![a-z0-9])(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d{5,}"
                         r"|(?:jr|req|r)[-_]?\d{4,})(?![a-z0-9])", re.I)


def _link_ids(url) -> set[str]:
    try:
        link = urlsplit(str(url or ""))
    except ValueError:
        return set()
    query = [value for key, value in parse_qsl(link.query) if key.lower() in _JOB_KEYS]
    return {code.lower() for code in [*query, *_ID_IN_LINK.findall(link.path)] if len(code) >= 4}


def _site(url) -> str:
    try:
        return ".".join((urlsplit(str(url or "")).hostname or "").lower().split(".")[-2:])
    except ValueError:
        return ""


def _same_job_code(content: dict, url: str, company: str | None) -> bool:
    """A saved job whose link carries one of this link's job codes, on the same site or at the same company."""
    if not _link_ids(url) & _link_ids(content.get("url")):
        return False
    same_site = bool(_site(url)) and _site(url) == _site(content.get("url"))
    return same_site or " ".join(str(content.get("company") or "").split()).lower() == " ".join((company or "").split()).lower()


def _words(text) -> set[str]:
    return set(re.findall(r"[a-z0-9]+", str(text or "").lower()))


def _same_role(content: dict, fields) -> bool:
    """The same title word for word (any order, any punctuation), and places that share a word or aren't both named."""
    if not _words(fields.title) or _words(content.get("title")) != _words(fields.title):
        return False
    here, there = _words(content.get("location")), _words(fields.location)
    return not here or not there or bool(here & there)


def add_job(db, *, firm_id, actor, candidate, source: str, job: dict) -> tuple[JobPosting, bool]:
    """The candidate's posting for `job` (`{title, company, description, url, location}`) added from `source` (`manual`
    or `extension`), and whether it is new."""
    if source not in ADDED_SOURCES:
        raise ValueError(f"unknown source {source!r}")
    content = {key: _clean(value) for key, value in job.items() if value not in (None, "")}
    fields = read_content(source, content)
    digest = job_hash(fields.company, fields.title, fields.description)
    existing = scoped(db, JobPosting, firm_id).filter(JobPosting.candidate_id == candidate.id,
                                                      JobPosting.job_id == digest).first()
    if existing is None and content.get("url"):
        # The same job by its link and title, whatever its text says now: a copy moved from the old jobs table, or one
        # added before from a page whose description has changed since.
        link = content["url"].split("#")[0].rstrip("/")
        existing = scoped(db, JobPosting, firm_id).filter(
            JobPosting.candidate_id == candidate.id, JobPosting.content["url"].astext.in_([link, f"{link}/"]),
            func.lower(JobPosting.content["title"].astext) == fields.title.lower()).first()
    if existing is None and fields.company:
        # The same role at the same company is the job they have, at whatever link, unless both name places that differ.
        same_company = scoped(db, JobPosting, firm_id).filter(
            JobPosting.candidate_id == candidate.id,
            func.lower(func.trim(JobPosting.content["company"].astext)) == " ".join(fields.company.split()).lower())
        existing = next((posting for posting in same_company if _same_role(posting.content or {}, fields)), None)
    for code in sorted(_link_ids(content.get("url"))) if existing is None else []:
        # The same job by the code in its link (Greenhouse's 8329677 on the company's own careers site, too).
        coded = scoped(db, JobPosting, firm_id).filter(JobPosting.candidate_id == candidate.id,
                                                       JobPosting.content["url"].astext.ilike(f"%{code}%"))
        existing = next((posting for posting in coded if _same_job_code(posting.content or {}, content["url"], fields.company)), None)
        if existing is not None:
            break
    if existing is not None:
        return existing, False
    now = utcnow()
    batch = ScrapeJob(firm_id=firm_id, candidate_id=candidate.id, user_id=actor.id, batch_id=uuid.uuid4(),
                      kind="capture", state="success", finished_at=now, meta={"request": {"source": source}})
    db.add(batch)
    db.flush()
    posting = JobPosting(firm_id=firm_id, candidate_id=candidate.id, batch_id=batch.batch_id, source=source,
                         first_source=source, job_id=digest, content=content, discovered_at=now, last_seen_at=now)
    db.add(posting)
    db.flush()
    record(db, actor=actor, action="CREATE", entity_type="job_posting", entity_id=posting.id,
           entity_label=f"{fields.title} at {fields.company}"[:200], summary=f"Added a job for {candidate.full_name} "
           f"({source}).", firm_id=firm_id, candidate_id=candidate.id)
    return posting, True


def ensure_saved(db, *, firm_id, actor, candidate, posting) -> tuple[Application, bool]:
    """The candidate's application for `posting`, and whether it is new: the one they have, whatever its status, or a
    new Saved draft (no submission date or submitter, docs/02 §9)."""
    app = scoped(db, Application, firm_id).filter(Application.candidate_id == candidate.id,
                                                  Application.job_id == posting.id).first()
    if app is not None:
        return app, False
    now = datetime.now(timezone.utc)
    app = Application(firm_id=firm_id, candidate_id=candidate.id, job_id=posting.id, resume_id=None,
                      submitted_by_user_id=None, status="saved", applied_at=None,
                      status_transitions=[{"from": None, "to": "saved", "at": now.isoformat(), "source": "ui"}])
    db.add(app)
    db.flush()
    app.applied_at = None       # the column's default would stamp it; a Saved draft isn't a submission
    title = posting_job(posting).title
    record(db, actor=actor, action="CREATE", entity_type="application", entity_id=app.id,
           entity_label=(title or "Saved job")[:200], summary=f"Added {title or 'a job'} to Saved for "
           f"{candidate.full_name}.", firm_id=firm_id, candidate_id=candidate.id)
    return app, True
