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
    ARRAY, Boolean, CheckConstraint, Column, DateTime, Index, Integer, LargeBinary, Numeric, String, Text, text,
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
