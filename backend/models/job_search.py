"""The job-search module's own jobs table (docs/02 §6; Zuhair's track).

`job_postings` is candidate+batch scoped, not a shared pool: one row per job a search found for one candidate.
Deliberately not `jobs` (the old shared-pool table in `backend/models/db.py`) — that table, and everything that
still points at it (`applications.job_id`, `job_runs.target_job_id`, `candidate_jobs`, `favorite_jobs`,
`firm_jobs`), is unchanged for now. Renaming this table to `jobs` and retiring the old one is a later, separate
change once those are repointed.

Dedup identity (per candidate): `job_id` (SHA256 of normalized company + title + full JD text) is the only
identity key. A content change is a new posting by design, so the board's own id adds nothing and isn't stored. A
repeat match on `job_id` for the same candidate updates `batch_id`/`last_seen_at` on the existing row instead
of inserting a duplicate (done in the ingestion code, not here).

Everything about the job itself — title, description, location, salary, seniority, skills, apply link, whatever
a given source sends — lives in one `content` JSONB column, not separate typed columns (decided 2026-11-09): the
set of sources isn't fixed to JSearch/freehire.me, and a schema built around one source's fields would need a
migration every time another aggregator is added or a source's response shape changes. The ingestion/adapter code
(not yet written) decides `content`'s internal shape; this table doesn't enforce one. `status` stays a real
column — it's the BDE's own interaction with the row (new/saved/dismissed/applied), not job content from a source,
and the app filters on it directly.
"""
import re

from sqlalchemy import CheckConstraint, Column, DateTime, String, Text, UniqueConstraint, event, text
from sqlalchemy.dialects.postgresql import JSONB, UUID

from backend.models.db import Base, utcnow
from backend.models.tenancy import _created_at, _pk, _restrict, _updated_at


class JobPosting(Base):
    __tablename__ = "job_postings"

    id = _pk()
    firm_id = Column(UUID(as_uuid=True), _restrict("firms.id"), nullable=False, index=True)
    candidate_id = Column(UUID(as_uuid=True), _restrict("candidates.id"), nullable=False, index=True)
    # The most recent search run this row was seen in. No FK yet: the batch/run-log table (`scrape_jobs`) doesn't
    # exist yet. Updated in place on a job_id repeat match, not re-inserted.
    batch_id = Column(UUID(as_uuid=True), nullable=False, index=True)

    source = Column(String, nullable=False)          # jsearch | freehire | coresignal | ...
    job_id = Column(String(64), nullable=False, index=True)  # SHA256(normalized company+title+full JD)

    # Everything about the job: title, description, location, salary, seniority, skills, apply link, etc. Shape is
    # the adapter's decision, not this table's — see the module docstring.
    content = Column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))

    status = Column(String, nullable=False, server_default=text("'new'"))  # new | saved | dismissed | applied

    discovered_at = Column(DateTime(timezone=True), nullable=False, default=utcnow, server_default=text("now()"))
    last_seen_at = Column(DateTime(timezone=True), nullable=False, default=utcnow, server_default=text("now()"))
    created_at = _created_at()
    updated_at = _updated_at()

    __table_args__ = (
        # The dedup scope: content seen before for this candidate is updated in place, never duplicated.
        UniqueConstraint("candidate_id", "job_id", name="uq_job_postings_candidate_job"),
        CheckConstraint("status IN ('new', 'saved', 'dismissed', 'applied')", name="ck_job_postings_status"),
    )


class ScrapeJob(Base):
    """One row per finished search batch (docs/02 §6.y): logging, not a queue. Written once the batch completes —
    there is no in-progress state, so a row's existence already means the batch is done."""
    __tablename__ = "scrape_jobs"

    id = _pk()
    firm_id = Column(UUID(as_uuid=True), _restrict("firms.id"), nullable=False, index=True)
    candidate_id = Column(UUID(as_uuid=True), _restrict("candidates.id"), nullable=False, index=True)
    batch_id = Column(UUID(as_uuid=True), nullable=False, unique=True)
    state = Column(String, nullable=False)   # success | error
    error = Column(Text, nullable=True)      # only set when state='error'
    created_at = _created_at()

    __table_args__ = (
        CheckConstraint("state IN ('success', 'error')", name="ck_scrape_jobs_state"),
        CheckConstraint("state = 'error' OR error IS NULL", name="ck_scrape_jobs_error_only_on_error"),
    )


# Same NUL-byte guard as `Job` in db.py (backend/models/db.py) — scraped text can carry a C0 control byte that
# aborts the whole insert. This only reaches JobPosting/ScrapeJob's own String/Text columns; JobPosting.content is
# JSONB, so its internal string values (title, description, ...) are the ingestion/adapter code's own
# responsibility to sanitise before building the dict — a per-column event listener can't reach inside a JSON blob.
_CONTROL_CHARS_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")


def _sanitize(value):
    if not isinstance(value, str) or not value:
        return value
    return _CONTROL_CHARS_RE.sub("", value)


def _make_sanitizer():
    def _sanitize_field(target, value, oldvalue, initiator):
        return _sanitize(value)
    return _sanitize_field


for _model in (JobPosting, ScrapeJob):
    for _col in _model.__table__.columns:
        if isinstance(_col.type, String):
            event.listen(getattr(_model, _col.name), "set", _make_sanitizer(), retval=True)
del _model, _col
