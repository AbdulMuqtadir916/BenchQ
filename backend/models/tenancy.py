"""Auth and tenancy tables (docs/02 §3.1; docs/integration/07-auth-and-tenancy.md F2a; 07 Q37, Q38).

Conventions (Q38): plural snake_case tables, UUID keys, `created_at` / `updated_at` with time zone, statuses as
CHECK constraints (never Postgres enum types), foreign keys ON DELETE RESTRICT (firms and users are suspended
or deactivated, never deleted), emails stored lowercase, tokens stored only as SHA-256 hex digests.

The rules that must never break live in the database itself, so no endpoint bug can get past them: one active
OWNER per firm, `firm_id` null exactly for a platform invite, one email per account across `users` and
`platform_users` (a trigger, migration 0003), the 60-minute support view.

These tables exist only through Alembic (migrations/versions/0003_auth_tenancy.py).
"""
import uuid

from sqlalchemy import (
    ARRAY, Boolean, CheckConstraint, Column, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint,
    text,
)
from sqlalchemy import event
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Session as OrmSession

from backend.models.db import Base, utcnow

FIRM_ROLES = ("OWNER", "MANAGER", "BDE", "VIEWER")
FIRM_STATUSES = ("ONBOARDING", "ACTIVE", "SUSPENDED")
TRUTH_GUARD_MODES = ("STRICT", "BALANCED", "LENIENT")
INVITE_ROLES = FIRM_ROLES + ("PLATFORM_ADMIN",)
INVITE_STATUSES = ("PENDING", "ACCEPTED", "REVOKED", "EXPIRED")
LEDGER_ACTOR_TYPES = ("USER", "SYSTEM", "AGENT", "PLATFORM_ADMIN")
LEDGER_ACTIONS = (
    "CREATE", "UPDATE", "DELETE", "STATE_CHANGE", "AI_GENERATE", "AI_BLOCK", "AI_OVERRIDE", "EXPORT", "LOGIN",
    "ADMIN_ACCESS", "ADMIN_ACCESS_END", "FIRM_CREATED", "FIRM_SUSPENDED", "FIRM_REACTIVATED", "PLAN_CHANGED",
    "INVITE_SENT", "INVITE_ACCEPTED", "INVITE_REVOKED",
)
CLAIM_STATES = ("VERIFIED", "UNVERIFIED", "CONTRADICTED")
FIRM_JOB_ORIGINS = ("SCRAPED", "CAPTURED")
# Job.source values a person captured by hand (migration 0005 backfills these as CAPTURED). Their routes link them.
CAPTURED_SOURCES = ("manual", "extension")

# The same pattern as the frontend's SlugSchema (src/lib/schemas/tenancy.ts): 3-32 characters, a letter first,
# lowercase letters, digits and single inner hyphens. Reserved words are refused in code, not here.
SLUG_PATTERN = r"^[a-z](?:[a-z0-9]|-(?=[a-z0-9])){2,31}$"
SHA256_HEX = r"^[0-9a-f]{64}$"

# Fixed ids for the rows migration 0003 creates; migration 0005 (F2b) fills `firm_id` on the rows that existed before
# it with DEFAULT_FIRM_ID.
DEFAULT_PLAN_ID = uuid.UUID("00000000-0000-4000-8000-000000000001")
DEFAULT_FIRM_ID = uuid.UUID("00000000-0000-4000-8000-000000000002")


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


def _pk():
    return Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()"))


def _created_at():
    return Column(DateTime(timezone=True), nullable=False, default=utcnow, server_default=text("now()"))


def _updated_at():
    return Column(DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow,
                  server_default=text("now()"))


def _restrict(target: str):
    return ForeignKey(target, ondelete="RESTRICT")


class Plan(Base):
    """A template (A3): assigning one copies its limits onto the firm; editing it never changes existing firms."""
    __tablename__ = "plans"

    id = _pk()
    name = Column(String, nullable=False, unique=True)
    seat_limit = Column(Integer, nullable=False)
    candidate_limit = Column(Integer, nullable=False)
    features = Column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))  # display labels only (A15)
    is_active = Column(Boolean, nullable=False, server_default=text("true"))      # false = hidden from new firms
    created_at = _created_at()
    updated_at = _updated_at()

    __table_args__ = (
        CheckConstraint("seat_limit >= 0 AND candidate_limit >= 0", name="ck_plans_limits_not_negative"),
    )


class Firm(Base):
    """The tenant. Seats used and active candidates are derived, never stored (A1, A2)."""
    __tablename__ = "firms"

    id = _pk()
    name = Column(String, nullable=False)
    slug = Column(String, nullable=False, unique=True)
    status = Column(String, nullable=False, server_default=text("'ONBOARDING'"))
    plan_id = Column(UUID(as_uuid=True), _restrict("plans.id"), nullable=False, index=True)  # required (A16)
    seat_limit = Column(Integer, nullable=False)          # effective limits, copied from the plan (A3)
    candidate_limit = Column(Integer, nullable=False)
    contact_phone = Column(String, nullable=True)
    logo_url = Column(String, nullable=True)
    primary_timezone = Column(String, nullable=False, server_default=text("'Asia/Kolkata'"))
    client_timezone = Column(String, nullable=False, server_default=text("'America/New_York'"))
    truth_guard_mode = Column(String, nullable=False, server_default=text("'BALANCED'"))
    application_expiry_days = Column(Integer, nullable=False, server_default=text("30"))
    created_at = _created_at()
    updated_at = _updated_at()

    __table_args__ = (
        CheckConstraint(f"slug ~ '{SLUG_PATTERN}'", name="ck_firms_slug_format"),
        CheckConstraint(_in("status", FIRM_STATUSES), name="ck_firms_status"),
        CheckConstraint(_in("truth_guard_mode", TRUTH_GUARD_MODES), name="ck_firms_truth_guard_mode"),
        CheckConstraint("seat_limit >= 0 AND candidate_limit >= 0", name="ck_firms_limits_not_negative"),
        CheckConstraint("application_expiry_days > 0", name="ck_firms_application_expiry_days_positive"),
    )


class User(Base):
    """A firm user: belongs to exactly one firm (07 Q9). Never deleted; `is_active` false instead."""
    __tablename__ = "users"

    id = _pk()
    firm_id = Column(UUID(as_uuid=True), _restrict("firms.id"), nullable=False, index=True)
    role = Column(String, nullable=False)
    name = Column(String, nullable=False)
    email = Column(String, nullable=False, unique=True)
    password_hash = Column(String, nullable=False)       # Argon2id (Q37)
    avatar_url = Column(String, nullable=True)
    is_active = Column(Boolean, nullable=False, server_default=text("true"))
    last_active_at = Column(DateTime(timezone=True), nullable=True)
    created_at = _created_at()
    updated_at = _updated_at()

    __table_args__ = (
        CheckConstraint(_in("role", FIRM_ROLES), name="ck_users_role"),
        CheckConstraint("email = lower(email)", name="ck_users_email_lowercase"),
        # At most one active OWNER per firm (A10); an ONBOARDING firm has none until its owner accepts.
        Index("uq_users_one_active_owner_per_firm", "firm_id", unique=True,
              postgresql_where=text("role = 'OWNER' AND is_active")),
    )


class PlatformUser(Base):
    """BenchQ staff. PLATFORM_ADMIN is the only platform role (A11), so it is not stored."""
    __tablename__ = "platform_users"

    id = _pk()
    name = Column(String, nullable=False)
    email = Column(String, nullable=False, unique=True)
    password_hash = Column(String, nullable=False)
    is_active = Column(Boolean, nullable=False, server_default=text("true"))
    last_active_at = Column(DateTime(timezone=True), nullable=True)
    created_at = _created_at()
    updated_at = _updated_at()

    __table_args__ = (
        CheckConstraint("email = lower(email)", name="ck_platform_users_email_lowercase"),
    )


class Invite(Base):
    """How every account is created (07 Q11). The link's token is never stored, only its SHA-256."""
    __tablename__ = "invites"

    id = _pk()
    firm_id = Column(UUID(as_uuid=True), _restrict("firms.id"), nullable=True, index=True)  # null = platform team
    email = Column(String, nullable=False)
    invitee_name = Column(String, nullable=True)          # 07 Q31
    role = Column(String, nullable=False)
    invited_by_user_id = Column(UUID(as_uuid=True), _restrict("users.id"), nullable=True)
    invited_by_platform_user_id = Column(UUID(as_uuid=True), _restrict("platform_users.id"), nullable=True)
    status = Column(String, nullable=False, server_default=text("'PENDING'"))
    token_hash = Column(String, nullable=False, unique=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)   # created or resent + 7 days (A9)
    accepted_at = Column(DateTime(timezone=True), nullable=True)
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    created_at = _created_at()
    updated_at = _updated_at()

    __table_args__ = (
        CheckConstraint(_in("role", INVITE_ROLES), name="ck_invites_role"),
        CheckConstraint(_in("status", INVITE_STATUSES), name="ck_invites_status"),
        CheckConstraint("email = lower(email)", name="ck_invites_email_lowercase"),
        CheckConstraint(f"token_hash ~ '{SHA256_HEX}'", name="ck_invites_token_hash_sha256"),
        # A11: firm_id is null exactly when the role is PLATFORM_ADMIN.
        CheckConstraint("(firm_id IS NULL) = (role = 'PLATFORM_ADMIN')", name="ck_invites_platform_iff_no_firm"),
        CheckConstraint("num_nonnulls(invited_by_user_id, invited_by_platform_user_id) = 1",
                        name="ck_invites_one_inviter"),
        CheckConstraint("status <> 'ACCEPTED' OR accepted_at IS NOT NULL", name="ck_invites_accepted_at"),
        CheckConstraint("status <> 'REVOKED' OR revoked_at IS NOT NULL", name="ck_invites_revoked_at"),
        # One open invite per email anywhere: an email is one account (07 Q9, Q38).
        Index("uq_invites_one_pending_per_email", "email", unique=True,
              postgresql_where=text("status = 'PENDING'")),
        # One pending OWNER invite per firm (implication 4).
        Index("uq_invites_one_pending_owner_per_firm", "firm_id", unique=True,
              postgresql_where=text("status = 'PENDING' AND role = 'OWNER'")),
    )


class SupportView(Base):
    """A Super Admin's read-only look inside one firm: 60 minutes, no extension (A12)."""
    __tablename__ = "support_views"

    id = _pk()                                            # also the ledger entries' entity_id
    platform_user_id = Column(UUID(as_uuid=True), _restrict("platform_users.id"), nullable=False)
    firm_id = Column(UUID(as_uuid=True), _restrict("firms.id"), nullable=False, index=True)
    reason = Column(Text, nullable=False)                 # shown to the firm exactly as written
    started_at = Column(DateTime(timezone=True), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    ended_at = Column(DateTime(timezone=True), nullable=True)
    created_at = _created_at()
    updated_at = _updated_at()

    __table_args__ = (
        CheckConstraint("char_length(btrim(reason)) >= 10", name="ck_support_views_reason_length"),
        CheckConstraint("expires_at = started_at + interval '60 minutes'", name="ck_support_views_sixty_minutes"),
        CheckConstraint("ended_at IS NULL OR ended_at >= started_at", name="ck_support_views_ended_after_start"),
        # One view at a time per admin (07 §4).
        Index("uq_support_views_one_open_per_admin", "platform_user_id", unique=True,
              postgresql_where=text("ended_at IS NULL")),
    )


class Session(Base):
    """An opaque cookie session (Q37): the cookie holds the token, this row only its SHA-256. User and firm
    status are re-read on every request, so suspension or deactivation applies on the next one."""
    __tablename__ = "sessions"

    id = _pk()
    token_hash = Column(String, nullable=False, unique=True)
    user_id = Column(UUID(as_uuid=True), _restrict("users.id"), nullable=True, index=True)
    platform_user_id = Column(UUID(as_uuid=True), _restrict("platform_users.id"), nullable=True, index=True)
    support_view_id = Column(UUID(as_uuid=True), _restrict("support_views.id"), nullable=True)
    last_seen_at = Column(DateTime(timezone=True), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)            # sliding: last seen + 7 days
    absolute_expires_at = Column(DateTime(timezone=True), nullable=False)   # created + 30 days, never moves
    created_at = _created_at()
    updated_at = _updated_at()

    __table_args__ = (
        CheckConstraint(f"token_hash ~ '{SHA256_HEX}'", name="ck_sessions_token_hash_sha256"),
        CheckConstraint("num_nonnulls(user_id, platform_user_id) = 1", name="ck_sessions_one_account"),
        CheckConstraint("support_view_id IS NULL OR platform_user_id IS NOT NULL",
                        name="ck_sessions_support_view_is_platform"),
        CheckConstraint("expires_at <= absolute_expires_at", name="ck_sessions_expiry_within_cap"),
        CheckConstraint("absolute_expires_at <= created_at + interval '30 days'", name="ck_sessions_thirty_day_cap"),
    )


class LedgerEntry(Base):
    """The business ledger: who did what (docs/02 §10, 07-auth §6.6). Append-only, so no `updated_at`.
    `firm_id` is null only for platform-only events (A13). The actor may be a firm user, a platform user or
    nobody (SYSTEM, AGENT), so `actor_user_id` has no foreign key; `actor_name` keeps the name as it was."""
    __tablename__ = "ledger_entries"

    id = _pk()
    firm_id = Column(UUID(as_uuid=True), _restrict("firms.id"), nullable=True)
    actor_type = Column(String, nullable=False)
    actor_user_id = Column(UUID(as_uuid=True), nullable=True)
    actor_name = Column(String, nullable=False)
    entity_type = Column(String, nullable=False)          # lowercase: firm, invite, user, support_view… (07 Q30)
    entity_id = Column(String, nullable=False)
    entity_label = Column(String, nullable=False)
    action = Column(String, nullable=False)
    summary = Column(Text, nullable=False)
    model_id = Column(String, nullable=True)
    prompt_version = Column(String, nullable=True)
    evidence_ids = Column(ARRAY(String), nullable=False, server_default=text("'{}'::character varying[]"))
    claim_state = Column(String, nullable=True)
    created_at = _created_at()

    __table_args__ = (
        CheckConstraint(_in("actor_type", LEDGER_ACTOR_TYPES), name="ck_ledger_entries_actor_type"),
        CheckConstraint(_in("action", LEDGER_ACTIONS), name="ck_ledger_entries_action"),
        CheckConstraint(f"claim_state IS NULL OR {_in('claim_state', CLAIM_STATES)}",
                        name="ck_ledger_entries_claim_state"),
        Index("ix_ledger_entries_firm_created", "firm_id", "created_at"),
        Index("ix_ledger_entries_created", "created_at"),
    )


class FirmJob(Base):
    """Which jobs a firm sees (07 Q37): `jobs` is one shared pool, and a firm sees the jobs its own searches found
    plus the ones its people captured by hand. The API gives a job its firm through this link. A captured job is
    linked only to the firm that captured it."""
    __tablename__ = "firm_jobs"

    id = _pk()
    firm_id = Column(UUID(as_uuid=True), _restrict("firms.id"), nullable=False)   # leads uq_firm_jobs_firm_job
    # The link means nothing without the posting, and old skipped jobs are cleaned up, so it goes with the job.
    job_id = Column(UUID(as_uuid=True), ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False, index=True)
    origin = Column(String, nullable=False)
    search_id = Column(UUID(as_uuid=True), ForeignKey("searches.id", ondelete="SET NULL"), nullable=True)
    captured_by_user_id = Column(UUID(as_uuid=True), _restrict("users.id"), nullable=True)
    created_at = _created_at()
    updated_at = _updated_at()

    __table_args__ = (
        CheckConstraint(_in("origin", FIRM_JOB_ORIGINS), name="ck_firm_jobs_origin"),
        CheckConstraint("origin = 'CAPTURED' OR captured_by_user_id IS NULL", name="ck_firm_jobs_scraped_no_capturer"),
        UniqueConstraint("firm_id", "job_id", name="uq_firm_jobs_firm_job"),
    )


def link_job_to_firm(db, firm_id: uuid.UUID, job_id: uuid.UUID, origin: str, *, search_id: uuid.UUID | None = None,
                     captured_by_user_id: uuid.UUID | None = None) -> None:
    """Let a firm see a job (07 Q37). Idempotent: a job the firm already sees keeps its first link."""
    with db.no_autoflush:
        exists = db.query(FirmJob.id).filter(FirmJob.firm_id == firm_id, FirmJob.job_id == job_id).first()
        pending = any(isinstance(o, FirmJob) and o.firm_id == firm_id and o.job_id == job_id for o in db.new)
    if not exists and not pending:
        db.add(FirmJob(firm_id=firm_id, job_id=job_id, origin=origin, search_id=search_id,
                       captured_by_user_id=captured_by_user_id))


@event.listens_for(OrmSession, "before_flush")
def _link_scraped_jobs(db, _flush_context, _instances) -> None:
    """Every scraper source creates `Job` rows its own way, so the link to a firm is made here, once, for all of
    them: a new job that a search found goes to that search's firm. Jobs captured by hand are linked by the route
    that captures them. Left for the Jobs track: jobs from company pages (companies are global reference data
    with no firm yet, 07 §6.4), and a job already in the pool that another firm's search finds again."""
    from backend.models.db import Job, Search
    for job in [o for o in db.new
                if isinstance(o, Job) and o.search_id is not None and o.source not in CAPTURED_SOURCES]:
        if job.id is None:
            job.id = uuid.uuid4()
        with db.no_autoflush:
            firm_id = db.query(Search.firm_id).filter(Search.id == job.search_id).scalar()
        if firm_id is not None:
            link_job_to_firm(db, firm_id, job.id, "SCRAPED", search_id=job.search_id)
