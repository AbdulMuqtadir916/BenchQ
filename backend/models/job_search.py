"""The job-search module's own tables (docs/02 §6.y; Zuhair's track): `job_postings` and `scrape_jobs`.

`job_postings` is candidate+batch scoped, not a shared pool: one row per job a search found for one candidate.
Deliberately not `jobs` (the old shared-pool table in `backend/models/db.py`) — that table, and everything that
still points at it (`applications.job_id`, `job_runs.target_job_id`, `candidate_jobs`, `favorite_jobs`,
`firm_jobs`), is unchanged for now. Renaming this table to `jobs` and retiring the old one is a later, separate
change once those are repointed.

Dedup identity (per candidate): `job_id` (SHA256 hex of normalized company + title + full JD text) is the only
identity key. A content change is a new posting by design, so the board's own id adds nothing and isn't stored. A
repeat match on `job_id` for the same candidate updates `batch_id`/`last_seen_at` on the existing row instead
of inserting a duplicate, and replaces `content` with the latest (backend/job_search/pipeline.py).

Everything about the job itself — title, description, location, salary, seniority, skills, apply link, whatever
a given source sends — lives in one `content` JSONB column, not separate typed columns (decided 2026-11-09): the
set of sources isn't fixed to JSearch/freehire.me, and a schema built around one source's fields would need a
migration every time another aggregator is added or a source's response shape changes. `content` is the provider's
own job object as it arrived (decided 2026-11-10); each provider's `read()` (backend/job_search/providers/) turns it
into the common fields, chosen by `source`. This table doesn't enforce a shape.

No status column (decided 2026-11-10): whether a job was saved or applied to lives in `applications`, so it can't
drift from a copy here. Hiding a job (dismissed) isn't built.

`scrape_jobs.user_id` (migration 0022) is who ran the search, the candidate's BDE; a plain FK to `users.id` (users has
no `UNIQUE (firm_id, id)` to aim a firm-safe key at; the route takes the user from the session, in the candidate's firm).

Tenancy: `(firm_id, candidate_id)` references `candidates (firm_id, id)` on both tables, so a row can't carry a
firm other than its candidate's; and `job_postings (firm_id, candidate_id, batch_id)` references the same three on
`scrape_jobs`, so a posting can't name another candidate's or another firm's batch.
"""
from sqlalchemy import CheckConstraint, Column, DateTime, ForeignKeyConstraint, Index, String, Text, \
    UniqueConstraint, event, text
from sqlalchemy.dialects.postgresql import JSONB, UUID

from backend.models.db import Base, sanitize_text, utcnow
from backend.models.tenancy import _created_at, _pk, _restrict, _updated_at


class ScrapeJob(Base):
    """One row per search batch (docs/02 §6.y). Written `running` when the BDE starts the search (migration 0022,
    decided 2026-11-10: the search runs in the background, so its row exists while it runs) and finished in place:
    `success` / `empty` / `error`, `finished_at` set. On success the finish and the batch's `job_postings` are one
    transaction (`job_postings.batch_id` references this row). A row left `running` by a restart is marked `error`
    once it is older than 15 minutes (backend/job_search/limits.py)."""
    __tablename__ = "scrape_jobs"

    id = _pk()
    firm_id = Column(UUID(as_uuid=True), _restrict("firms.id"), nullable=False)
    candidate_id = Column(UUID(as_uuid=True), nullable=False)
    # Who ran the search (migration 0022): the candidate's BDE. The BDE's daily attempts are counted from these rows.
    user_id = Column(UUID(as_uuid=True), _restrict("users.id"), nullable=False)
    batch_id = Column(UUID(as_uuid=True), nullable=False, unique=True)
    # running: started, not finished | success: the source answered with at least one job | empty: it answered with
    # none | error: it failed
    state = Column(String, nullable=False)
    # search: a BDE's search | capture: one job the BDE captured by hand or from the extension, its own batch (0023)
    kind = Column(String, nullable=False, default="search", server_default=text("'search'"))
    error = Column(Text, nullable=True)      # the failure detail; set exactly when state = 'error'
    # Everything in the source's response except the jobs themselves (those are job_postings rows): request id,
    # parameters, totals, pagination. `metadata` is reserved on a declarative model, hence the attribute name.
    meta = Column("metadata", JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    created_at = _created_at()                                        # when the search started
    finished_at = Column(DateTime(timezone=True), nullable=True)      # set exactly when it isn't running (0022)

    __table_args__ = (
        ForeignKeyConstraint(["firm_id", "candidate_id"], ["candidates.firm_id", "candidates.id"],
                             name="fk_scrape_jobs_firm_candidate", ondelete="RESTRICT"),
        CheckConstraint("state IN ('success', 'empty', 'error', 'running')", name="ck_scrape_jobs_state"),
        CheckConstraint("(state = 'running') = (finished_at IS NULL)", name="ck_scrape_jobs_finished_iff_done"),
        CheckConstraint("kind IN ('search', 'capture')", name="ck_scrape_jobs_kind"),
        CheckConstraint("(state = 'error') = (error IS NOT NULL)", name="ck_scrape_jobs_error_iff_error"),
        # The target of job_postings' batch key: a posting can only name a batch run for its own candidate and firm.
        UniqueConstraint("firm_id", "candidate_id", "batch_id", name="uq_scrape_jobs_firm_candidate_batch"),
        # The BDE's attempts since the last 6:30 PM IST, and a candidate's search history (backend/job_search/limits.py).
        Index("ix_scrape_jobs_user_created", "user_id", "created_at"),
        Index("ix_scrape_jobs_candidate_created", "candidate_id", "created_at"),
    )


class JobPosting(Base):
    __tablename__ = "job_postings"

    id = _pk()
    firm_id = Column(UUID(as_uuid=True), _restrict("firms.id"), nullable=False)
    candidate_id = Column(UUID(as_uuid=True), nullable=False)
    # The last batch that found this job: a repeat match updates it in place, so it is not the batch history.
    # References scrape_jobs with (firm_id, candidate_id, batch_id), so it can't name another candidate's batch.
    batch_id = Column(UUID(as_uuid=True), nullable=False)

    source = Column(String, nullable=False)          # freehire | jsearch | coresignal | manual | extension | ...
    # How the job was first saved, never changed (0023; Abdul's comment on PR 2): a search that finds a captured job
    # replaces its `source` and `content`, but the job stays a capture here, so it never counts toward the
    # candidate's 100 new jobs a day. Filled from `source` on insert unless given.
    first_source = Column(String, nullable=False,
                          default=lambda context: context.get_current_parameters()["source"])
    job_id = Column(String(64), nullable=False)      # SHA256 hex of normalized company + title + full JD

    # Everything about the job: title, description, location, salary, seniority, skills, apply link, etc. Shape is
    # the adapter's decision, not this table's — see the module docstring.
    content = Column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))

    discovered_at = Column(DateTime(timezone=True), nullable=False, default=utcnow, server_default=text("now()"))
    last_seen_at = Column(DateTime(timezone=True), nullable=False, default=utcnow, server_default=text("now()"))
    created_at = _created_at()
    updated_at = _updated_at()

    __table_args__ = (
        ForeignKeyConstraint(["firm_id", "candidate_id"], ["candidates.firm_id", "candidates.id"],
                             name="fk_job_postings_firm_candidate", ondelete="RESTRICT"),
        ForeignKeyConstraint(["firm_id", "candidate_id", "batch_id"],
                             ["scrape_jobs.firm_id", "scrape_jobs.candidate_id", "scrape_jobs.batch_id"],
                             name="fk_job_postings_batch", ondelete="RESTRICT"),
        # The dedup scope: content seen before for this candidate is updated in place, never duplicated. Also the
        # index for lookups by candidate_id alone (its leading column).
        UniqueConstraint("candidate_id", "job_id", name="uq_job_postings_candidate_job"),
        CheckConstraint("job_id ~ '^[0-9a-f]{64}$'", name="ck_job_postings_job_id_sha256"),
        # The target of the candidate-safe keys pointing here: `resumes` (0023) and `applications` (Samad's PR).
        UniqueConstraint("firm_id", "candidate_id", "id", name="uq_job_postings_firm_candidate_id"),
        # The list screen (one candidate's jobs in a firm, or a firm's) and the batch key, by its leading columns.
        Index("ix_job_postings_firm_candidate_batch", "firm_id", "candidate_id", "batch_id"),
        # A candidate's jobs newest first, and the new jobs saved since the last 6:30 PM IST (migration 0022).
        Index("ix_job_postings_candidate_discovered", "candidate_id", "discovered_at"),
    )


# The same control-character guard as `Job` (sanitize_text in backend/models/db.py): scraped text can carry a C0
# control byte that aborts the whole insert. It only reaches these models' own String/Text columns; the strings
# inside JobPosting.content (JSONB) are the ingestion code's to sanitise before it builds the dict.
def _sanitize_field(target, value, oldvalue, initiator):
    return sanitize_text(value)


for _model in (JobPosting, ScrapeJob):
    for _col in _model.__table__.columns:
        if isinstance(_col.type, String):
            event.listen(getattr(_model, _col.name), "set", _sanitize_field, retval=True)
del _model, _col
