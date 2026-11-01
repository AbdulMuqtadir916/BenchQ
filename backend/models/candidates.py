"""Candidates and the résumés read for them (docs/02 §4 and §3.4; docs/candidate-onboarding/06-backend.md; 07 Q40–Q51).

The Candidates track (decision D1, option 1): one row per consultant on a firm's bench. Every candidate has a manager
(a MANAGER of the same firm) and at most one BDE who reports to that manager (07 Q41–Q42); that the BDE reports to
the manager is checked in code, since a CHECK can't read another row. The values mirror the frontend's
`CandidateSchema` (src/lib/schemas/candidate.ts) in snake_case; the API maps them (src/lib/api/dto/).

Truth Guard (07 Q49): skills and the summary are claims, stored here UNVERIFIED with their source until Track 04 builds
the candidate's Record (with evidence) from them and the kept résumé parse. Nothing here is ever VERIFIED.

Conventions as backend/models/tenancy.py (Q38): UUID keys, timestamps with time zone, CHECKs not enum types,
foreign keys ON DELETE RESTRICT.
"""
from sqlalchemy import (
    ARRAY, Boolean, CheckConstraint, Column, DateTime, ForeignKey, Index, Integer, LargeBinary, Numeric, String, Text,
    UniqueConstraint, text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID

from backend.models.db import Base
from backend.models.tenancy import _created_at, _in, _pk, _restrict, _updated_at

# The frontend's enums (src/lib/schemas/enums.ts).
WORK_AUTHS = ("H1B", "H4_EAD", "OPT", "CPT", "GC", "GC_EAD", "USC", "TN", "OTHER")
EMPLOYMENT_TYPES = ("C2C", "W2", "TEEN99", "FTE")
CANDIDATE_STATUSES = ("ON_BENCH", "INTERVIEWING", "OFFER", "PLACED", "PAUSED", "INACTIVE")
REMOTE_MODES = ("ONSITE", "HYBRID", "REMOTE")
# 07 Q45: the statuses that count toward the plan's candidate limit and a BDE's load (WORKING_STATUSES in
# src/lib/derive/tenancy.ts). Change both together, with a decision entry.
WORKING_STATUSES = ("ON_BENCH", "INTERVIEWING", "OFFER")


def _array_within(column: str, values: tuple[str, ...]) -> str:
    return f"{column} <@ ARRAY[{', '.join(repr(v) for v in values)}]::varchar[]"


class Candidate(Base):
    __tablename__ = "candidates"

    id = _pk()
    firm_id = Column(UUID(as_uuid=True), _restrict("firms.id"), nullable=False, index=True)
    manager_id = Column(UUID(as_uuid=True), _restrict("users.id"), nullable=False)    # always set (Q41)
    bde_id = Column(UUID(as_uuid=True), _restrict("users.id"), nullable=True)         # null = "Needs a BDE" (Q42)
    created_by_user_id = Column(UUID(as_uuid=True), _restrict("users.id"), nullable=False)

    full_name = Column(String, nullable=False)
    email = Column(String, nullable=True)
    phone = Column(String, nullable=True)
    linkedin_url = Column(String, nullable=True)
    city = Column(String, nullable=True)
    state = Column(String, nullable=True)
    country = Column(String, nullable=False, server_default=text("'US'"))
    willing_to_relocate = Column(Boolean, nullable=False, server_default=text("false"))

    work_auth = Column(String, nullable=False)
    work_auth_expiry = Column(DateTime(timezone=True), nullable=True)
    needs_sponsorship = Column(Boolean, nullable=False, server_default=text("false"))
    needs_transfer = Column(Boolean, nullable=False, server_default=text("false"))

    employment_types = Column(ARRAY(String), nullable=False, server_default=text("'{}'::character varying[]"))
    rate_min = Column(Numeric(10, 2), nullable=True)
    rate_target = Column(Numeric(10, 2), nullable=True)

    status = Column(String, nullable=False, server_default=text("'ON_BENCH'"))
    bench_start_date = Column(DateTime(timezone=True), nullable=True)
    available_from = Column(DateTime(timezone=True), nullable=True)
    notice_period_days = Column(Integer, nullable=True)

    years_experience = Column(Numeric(4, 1), nullable=True)
    primary_role = Column(String, nullable=True)                   # "Marketed as"
    target_roles = Column(ARRAY(String), nullable=False, server_default=text("'{}'::character varying[]"))

    # Provisional fields (07 Q50).
    work_settings = Column(ARRAY(String), nullable=False, server_default=text("'{}'::character varying[]"))
    preferred_locations = Column(ARRAY(String), nullable=False, server_default=text("'{}'::character varying[]"))
    contact_notes = Column(Text, nullable=True)

    # The persona (docs/02 §4 PersonaSchema: summary, tone_notes, will_relocate, notice_period_days,
    # preferred_industries, deal_breakers) and the answer bank, as the frontend shapes them, in snake_case.
    persona = Column(JSONB, nullable=True)
    qa_bank = Column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))
    # Claims until Track 04's Record: [{name, family, source, state: "UNVERIFIED"}] and the summary's state (Q49).
    skills = Column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))
    summary_state = Column(String, nullable=False, server_default=text("'UNVERIFIED'"))

    created_at = _created_at()
    updated_at = _updated_at()

    __table_args__ = (
        CheckConstraint(_in("work_auth", WORK_AUTHS), name="ck_candidates_work_auth"),
        CheckConstraint(_in("status", CANDIDATE_STATUSES), name="ck_candidates_status"),
        CheckConstraint(_array_within("employment_types", EMPLOYMENT_TYPES), name="ck_candidates_employment_types"),
        CheckConstraint(_array_within("work_settings", REMOTE_MODES), name="ck_candidates_work_settings"),
        CheckConstraint("rate_min IS NULL OR rate_min > 0", name="ck_candidates_rate_min_positive"),
        CheckConstraint("rate_target IS NULL OR rate_target > 0", name="ck_candidates_rate_target_positive"),
        CheckConstraint("rate_min IS NULL OR rate_target IS NULL OR rate_min <= rate_target",
                        name="ck_candidates_floor_not_above_target"),
        CheckConstraint("notice_period_days IS NULL OR notice_period_days BETWEEN 0 AND 365",
                        name="ck_candidates_notice_period"),
        CheckConstraint("years_experience IS NULL OR years_experience BETWEEN 0 AND 60",
                        name="ck_candidates_years_experience"),
        # Onboarding never produces a VERIFIED claim (Q49); verification comes with evidence, in Track 04.
        CheckConstraint("summary_state = 'UNVERIFIED'", name="ck_candidates_summary_unverified"),
        CheckConstraint("char_length(btrim(full_name)) > 0", name="ck_candidates_full_name_not_blank"),
        Index("ix_candidates_firm_manager", "firm_id", "manager_id"),
        Index("ix_candidates_firm_bde", "firm_id", "bde_id"),
    )


class ResumeParse(Base):
    """A résumé read for a new candidate (06 §4, decided 2026-10-27): the file and the parser's answer, kept for 60
    minutes. Nothing about a candidate is saved until create (Q49); create links the parse to the candidate and keeps
    it (expires_at null), and Track 04 builds the Record from it. Unused parses are deleted once expired."""
    __tablename__ = "resume_parses"

    id = _pk()
    firm_id = Column(UUID(as_uuid=True), _restrict("firms.id"), nullable=False, index=True)
    uploaded_by_user_id = Column(UUID(as_uuid=True), _restrict("users.id"), nullable=False)
    candidate_id = Column(UUID(as_uuid=True), _restrict("candidates.id"), nullable=True, index=True)
    file_name = Column(String, nullable=False)
    mime_type = Column(String, nullable=False)
    size_bytes = Column(Integer, nullable=False)
    content = Column(LargeBinary, nullable=False)
    parse = Column(JSONB, nullable=False)                 # the parser's answer, Zuhair's format, as returned
    expires_at = Column(DateTime(timezone=True), nullable=True)
    created_at = _created_at()
    updated_at = _updated_at()

    __table_args__ = (
        CheckConstraint("size_bytes BETWEEN 1 AND 10485760", name="ck_resume_parses_size"),   # 10 MB
        # Either still waiting for a create (and expiring), or kept with its candidate.
        CheckConstraint("(candidate_id IS NULL) = (expires_at IS NOT NULL)", name="ck_resume_parses_kept_or_expiring"),
    )


BASE_RESUME_SOURCES = ("UPLOAD", "PROMOTED")


class BaseResume(Base):
    """One of a candidate's base résumés (docs/team/resume-versioning.md §3.2, migration 0008): an entry on their shelf
    of bases, holding no content. Its content is its `resumes` versions (category BASE); the active one is what
    tailoring and job search use. Made from an upload (with the parse it came from) or promoted by a person from a
    version. Owner: Zuhair."""
    __tablename__ = "base_resumes"

    id = _pk()
    firm_id = Column(UUID(as_uuid=True), _restrict("firms.id"), nullable=False)
    candidate_id = Column(UUID(as_uuid=True), _restrict("candidates.id"), nullable=False)
    source = Column(String, nullable=False)
    resume_parse_id = Column(UUID(as_uuid=True), _restrict("resume_parses.id"), nullable=True)
    is_active = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    created_by_user_id = Column(UUID(as_uuid=True), _restrict("users.id"), nullable=False)
    created_at = _created_at()

    __table_args__ = (
        CheckConstraint(_in("source", BASE_RESUME_SOURCES), name="ck_base_resumes_source_values"),
        CheckConstraint("source = 'PROMOTED' OR resume_parse_id IS NOT NULL", name="ck_base_resumes_source"),
        # For the composite foreign key from resumes: a version's base belongs to the same candidate.
        UniqueConstraint("id", "candidate_id", name="uq_base_resumes_id_candidate"),
        Index("uq_base_resumes_one_active", "candidate_id", unique=True, postgresql_where=text("is_active")),
        Index("ix_base_resumes_firm_candidate", "firm_id", "candidate_id"),
    )


# ── The candidate core (docs/team/00-candidate-core.md, migration 0007, 07 Q53) ────────────────────────────────────
# Everything a candidate has, fixed before the team splits up. Owners in docs/team/README.md §3: add columns to your
# own tables only; renaming or removing one needs Abdul.

FIELD_SOURCES = ("MANUAL", "RESUME_UPLOAD", "LINKEDIN_EXPORT", "INTAKE_CALL", "AI_EXTRACTED")   # FieldSource (enums.ts)
CLAIM_STATES = ("VERIFIED", "UNVERIFIED", "CONTRADICTED")
CLAIM_ENTITY_TYPES = ("summary", "experience", "skill", "project", "certificate", "education", "award")   # award: 0008
MAILBOX_PROVIDERS = ("GOOGLE",)
MAILBOX_STATUSES = ("CONNECTED", "DISCONNECTED", "ERROR")


class CandidateJob(Base):
    """A job found for a candidate (Q53b). The job row stays in the shared pool (`jobs`, 07 Q37). Owner: Zuhair."""
    __tablename__ = "candidate_jobs"

    id = _pk()
    firm_id = Column(UUID(as_uuid=True), _restrict("firms.id"), nullable=False, index=True)
    candidate_id = Column(UUID(as_uuid=True), _restrict("candidates.id"), nullable=False)
    job_id = Column(UUID(as_uuid=True), _restrict("jobs.id"), nullable=False, index=True)
    search_id = Column(UUID(as_uuid=True), ForeignKey("searches.id", ondelete="SET NULL"), nullable=True)
    match_score = Column(Integer, nullable=True)
    found_at = _created_at()

    __table_args__ = (
        UniqueConstraint("candidate_id", "job_id", name="uq_candidate_jobs_candidate_job"),
        CheckConstraint("match_score IS NULL OR match_score BETWEEN 0 AND 100", name="ck_candidate_jobs_match_score"),
    )


class FavoriteJob(Base):
    """A job a BDE marked for a candidate (Q53c); the extension applies from these. Owner: Samad."""
    __tablename__ = "favorite_jobs"

    id = _pk()
    firm_id = Column(UUID(as_uuid=True), _restrict("firms.id"), nullable=False, index=True)
    candidate_id = Column(UUID(as_uuid=True), _restrict("candidates.id"), nullable=False)
    job_id = Column(UUID(as_uuid=True), _restrict("jobs.id"), nullable=False, index=True)
    marked_by_user_id = Column(UUID(as_uuid=True), _restrict("users.id"), nullable=False)
    created_at = _created_at()

    __table_args__ = (UniqueConstraint("candidate_id", "job_id", name="uq_favorite_jobs_candidate_job"),)


class CandidateMailbox(Base):
    """The candidate's own connected email account (Q53f), one per candidate. Token columns are Samad's (D8)."""
    __tablename__ = "candidate_mailboxes"

    id = _pk()
    firm_id = Column(UUID(as_uuid=True), _restrict("firms.id"), nullable=False, index=True)
    candidate_id = Column(UUID(as_uuid=True), _restrict("candidates.id"), nullable=False, unique=True)
    provider = Column(String, nullable=False, server_default=text("'GOOGLE'"))
    address = Column(String, nullable=False)
    status = Column(String, nullable=False, server_default=text("'CONNECTED'"))
    connected_by_user_id = Column(UUID(as_uuid=True), _restrict("users.id"), nullable=False)
    refresh_token_ciphertext = Column(LargeBinary, nullable=True)
    history_id = Column(String, nullable=True)
    initial_sync_complete = Column(Boolean, nullable=False, server_default=text("false"))
    last_sync_error = Column(Text, nullable=True)
    connected_at = _created_at()
    last_synced_at = Column(DateTime(timezone=True), nullable=True)
    created_at = _created_at()
    updated_at = _updated_at()

    __table_args__ = (
        CheckConstraint(_in("provider", MAILBOX_PROVIDERS), name="ck_candidate_mailboxes_provider"),
        CheckConstraint(_in("status", MAILBOX_STATUSES), name="ck_candidate_mailboxes_status"),
    )


class CandidateGoogleOAuthAttempt(Base):
    """Single-use, PKCE-bound OAuth handoff for a candidate-scoped mailbox connection."""
    __tablename__ = "candidate_google_oauth_attempts"

    id = _pk()
    state_hash = Column(String(64), nullable=False, unique=True)
    firm_id = Column(UUID(as_uuid=True), _restrict("firms.id"), nullable=False, index=True)
    candidate_id = Column(UUID(as_uuid=True), _restrict("candidates.id"), nullable=False, index=True)
    initiated_by_user_id = Column(UUID(as_uuid=True), _restrict("users.id"), nullable=False)
    code_verifier_ciphertext = Column(LargeBinary, nullable=False)
    return_to = Column(String(500), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    consumed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = _created_at()


class InboxMessage(Base):
    """An email in the candidate's mailbox; `application_id` links it to the application it is about (Q53f), so an
    application has many. Owner: Samad."""
    __tablename__ = "inbox_messages"

    id = _pk()
    firm_id = Column(UUID(as_uuid=True), _restrict("firms.id"), nullable=False, index=True)
    candidate_id = Column(UUID(as_uuid=True), _restrict("candidates.id"), nullable=False)
    mailbox_id = Column(UUID(as_uuid=True), _restrict("candidate_mailboxes.id"), nullable=False)
    application_id = Column(UUID(as_uuid=True), ForeignKey("applications.id", ondelete="SET NULL"), nullable=True,
                            index=True)
    provider_message_id = Column(String, nullable=False)
    source_address = Column(String, nullable=False, server_default=text("''"))
    thread_id = Column(String, nullable=True)
    from_name = Column(String, nullable=False)
    from_email = Column(String, nullable=False)
    subject = Column(String, nullable=False)
    snippet = Column(Text, nullable=False)
    body = Column(Text, nullable=True)
    received_at = Column(DateTime(timezone=True), nullable=False)
    is_read = Column(Boolean, nullable=False, server_default=text("false"))
    created_at = _created_at()

    __table_args__ = (
        UniqueConstraint("mailbox_id", "source_address", "provider_message_id", name="uq_inbox_messages_mailbox_message"),
        Index("ix_inbox_messages_candidate_received", "firm_id", "candidate_id", "received_at"),
    )


class Evidence(Base):
    """What substantiates a claim (D4, Q53g). Owner: Zuhair."""
    __tablename__ = "evidence"

    id = _pk()
    firm_id = Column(UUID(as_uuid=True), _restrict("firms.id"), nullable=False, index=True)
    candidate_id = Column(UUID(as_uuid=True), _restrict("candidates.id"), nullable=False, index=True)
    resume_parse_id = Column(UUID(as_uuid=True), _restrict("resume_parses.id"), nullable=True)
    document_url = Column(String, nullable=True)
    excerpt = Column(Text, nullable=True)
    page_number = Column(Integer, nullable=True)
    source = Column(String, nullable=False)
    confirmed_by_user_id = Column(UUID(as_uuid=True), _restrict("users.id"), nullable=True)
    confirmed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = _created_at()

    __table_args__ = (CheckConstraint(_in("source", FIELD_SOURCES), name="ck_evidence_source"),)


class Claim(Base):
    """A statement about the candidate (Q53g). The database refuses a VERIFIED claim without evidence (Truth Guard,
    D4): never relax `ck_claims_verified_has_evidence`. Owner: Zuhair."""
    __tablename__ = "claims"

    id = _pk()
    firm_id = Column(UUID(as_uuid=True), _restrict("firms.id"), nullable=False, index=True)
    candidate_id = Column(UUID(as_uuid=True), _restrict("candidates.id"), nullable=False, index=True)
    entity_type = Column(String, nullable=False)
    entity_ref = Column(String, nullable=True)
    # Before `text` below, which shadows sqlalchemy's text() in this class body.
    state = Column(String, nullable=False, server_default=text("'UNVERIFIED'"))
    text = Column(Text, nullable=False)
    evidence_id = Column(UUID(as_uuid=True), _restrict("evidence.id"), nullable=True)
    source = Column(String, nullable=False)
    created_at = _created_at()
    updated_at = _updated_at()

    __table_args__ = (
        CheckConstraint(_in("entity_type", CLAIM_ENTITY_TYPES), name="ck_claims_entity_type"),
        CheckConstraint(_in("state", CLAIM_STATES), name="ck_claims_state"),
        CheckConstraint(_in("source", FIELD_SOURCES), name="ck_claims_source"),
        CheckConstraint("state <> 'VERIFIED' OR evidence_id IS NOT NULL", name="ck_claims_verified_has_evidence"),
    )
