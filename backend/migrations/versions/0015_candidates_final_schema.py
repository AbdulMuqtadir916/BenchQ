"""Candidates final schema: `persona`, `skills` and `summary_state` removed, industries and deal breakers flat, a base
from the form alone (docs/team/zuhair.md §1.1 and §1.3; docs/team/resume-versioning.md §3.2; decided 2026-11-04)

Revision ID: 0015
Revises: 0014
Create Date: 2026-11-04 20:00:00.000000

`candidates.persona` (a JSON column holding the summary, tone notes, two stale copies of real columns, the preferred
industries and the deal breakers) goes. The industries and the deal breakers become two list columns, copied out of
`persona` first; the rest is dropped: the two copies (`will_relocate`, `notice_period_days`) are the columns
`willing_to_relocate` and `notice_period_days`, `tone_notes` was never filled, and the summary lives in the active base
résumé's version 1 (`resumes.summary`), not on the candidate.

`candidates.skills` and `summary_state` go too. **WARNING: nothing is converted.** A candidate made before this keeps
its skills only in its résumé version 1; BenchQ ships on a fresh database, so none exist.

**`claims` and `evidence` are dropped** (decided 2026-11-05: BenchQ has no claim or verified states). Their rows are
deleted for good. Nothing else points at either table (only `claims.evidence_id` points at `evidence`).

`base_resumes.source` gains `MANUAL`: a candidate created without a résumé file gets a base made from the new-candidate
form alone, so every candidate has a base. Such a base has no parse (`resume_parse_id` NULL), like a promoted one.

Follows 0014 (Samad's email classification, PR #111).

The downgrade rebuilds `persona` from the columns (its summary from the active base's version 1; `tone_notes` empty),
`skills` from the active base's version 1 (no family), `summary_state` as UNVERIFIED, recreates `evidence` and `claims`
empty, and turns each `MANUAL` base into a `PROMOTED` one, the nearest source the old CHECK allows.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = '0015'
down_revision = '0014'
branch_labels = None
depends_on = None

_EMPTY = sa.text("'{}'::character varying[]")


def upgrade() -> None:
    conn = op.get_bind()
    for column in ('preferred_industries', 'deal_breakers'):
        op.add_column('candidates', sa.Column(column, postgresql.ARRAY(sa.String()), nullable=False, server_default=_EMPTY))
        conn.execute(sa.text(
            f"UPDATE candidates SET {column} = ARRAY(SELECT jsonb_array_elements_text(persona -> '{column}')) "
            f"WHERE jsonb_typeof(persona -> '{column}') = 'array'"))
    op.drop_constraint('ck_candidates_summary_unverified', 'candidates', type_='check')
    op.drop_column('candidates', 'persona')
    op.drop_column('candidates', 'skills')
    op.drop_column('candidates', 'summary_state')

    op.drop_constraint('ck_base_resumes_source', 'base_resumes', type_='check')
    op.drop_constraint('ck_base_resumes_source_values', 'base_resumes', type_='check')
    op.create_check_constraint('ck_base_resumes_source_values', 'base_resumes',
                               "source IN ('UPLOAD', 'PROMOTED', 'MANUAL')")
    op.create_check_constraint('ck_base_resumes_source', 'base_resumes',
                               "source IN ('PROMOTED', 'MANUAL') OR resume_parse_id IS NOT NULL")

    op.drop_table('claims')                  # claims point at evidence, so they go first
    op.drop_table('evidence')


def downgrade() -> None:
    conn = op.get_bind()
    op.drop_constraint('ck_base_resumes_source', 'base_resumes', type_='check')
    op.drop_constraint('ck_base_resumes_source_values', 'base_resumes', type_='check')
    conn.execute(sa.text("UPDATE base_resumes SET source = 'PROMOTED' WHERE source = 'MANUAL'"))
    op.create_check_constraint('ck_base_resumes_source_values', 'base_resumes', "source IN ('UPLOAD', 'PROMOTED')")
    op.create_check_constraint('ck_base_resumes_source', 'base_resumes',
                               "source = 'PROMOTED' OR resume_parse_id IS NOT NULL")

    # The two tables come back empty (their rows were deleted by the upgrade), as 0007 and 0008 made them.
    op.create_table(
        'evidence',
        sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('firm_id', sa.UUID(), nullable=False),
        sa.Column('candidate_id', sa.UUID(), nullable=False),
        sa.Column('resume_parse_id', sa.UUID(), nullable=True),
        sa.Column('document_url', sa.String(), nullable=True),
        sa.Column('excerpt', sa.Text(), nullable=True),
        sa.Column('page_number', sa.Integer(), nullable=True),
        sa.Column('source', sa.String(), nullable=False),
        sa.Column('confirmed_by_user_id', sa.UUID(), nullable=True),
        sa.Column('confirmed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint("source IN ('MANUAL', 'RESUME_UPLOAD', 'LINKEDIN_EXPORT', 'INTAKE_CALL', 'AI_EXTRACTED')",
                           name='ck_evidence_source'),
        sa.ForeignKeyConstraint(['candidate_id'], ['candidates.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['confirmed_by_user_id'], ['users.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['firm_id'], ['firms.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['resume_parse_id'], ['resume_parses.id'], ondelete='RESTRICT'),
        sa.PrimaryKeyConstraint('id'))
    op.create_index(op.f('ix_evidence_candidate_id'), 'evidence', ['candidate_id'], unique=False)
    op.create_index(op.f('ix_evidence_firm_id'), 'evidence', ['firm_id'], unique=False)
    op.create_table(
        'claims',
        sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('firm_id', sa.UUID(), nullable=False),
        sa.Column('candidate_id', sa.UUID(), nullable=False),
        sa.Column('entity_type', sa.String(), nullable=False),
        sa.Column('entity_ref', sa.String(), nullable=True),
        sa.Column('state', sa.String(), server_default=sa.text("'UNVERIFIED'"), nullable=False),
        sa.Column('text', sa.Text(), nullable=False),
        sa.Column('evidence_id', sa.UUID(), nullable=True),
        sa.Column('source', sa.String(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint("entity_type IN ('summary', 'experience', 'skill', 'project', 'certificate', 'education', "
                           "'award')", name='ck_claims_entity_type'),
        sa.CheckConstraint("source IN ('MANUAL', 'RESUME_UPLOAD', 'LINKEDIN_EXPORT', 'INTAKE_CALL', 'AI_EXTRACTED')",
                           name='ck_claims_source'),
        sa.CheckConstraint("state <> 'VERIFIED' OR evidence_id IS NOT NULL", name='ck_claims_verified_has_evidence'),
        sa.CheckConstraint("state IN ('VERIFIED', 'UNVERIFIED', 'CONTRADICTED')", name='ck_claims_state'),
        sa.ForeignKeyConstraint(['candidate_id'], ['candidates.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['evidence_id'], ['evidence.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['firm_id'], ['firms.id'], ondelete='RESTRICT'),
        sa.PrimaryKeyConstraint('id'))
    op.create_index(op.f('ix_claims_candidate_id'), 'claims', ['candidate_id'], unique=False)
    op.create_index(op.f('ix_claims_firm_id'), 'claims', ['firm_id'], unique=False)

    op.add_column('candidates', sa.Column('summary_state', sa.String(), nullable=False,
                                          server_default=sa.text("'UNVERIFIED'")))
    op.add_column('candidates', sa.Column('skills', postgresql.JSONB(astext_type=sa.Text()), nullable=False,
                                          server_default=sa.text("'[]'::jsonb")))
    op.add_column('candidates', sa.Column('persona', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    conn.execute(sa.text("""
        UPDATE candidates c SET skills = COALESCE((
            SELECT jsonb_agg(jsonb_build_object('name', e ->> 'name', 'family', NULLIF(e ->> 'category', ''),
                                                'source', 'MANUAL', 'state', 'UNVERIFIED'))
            FROM resumes r JOIN base_resumes b ON b.id = r.base_resume_id
            CROSS JOIN LATERAL jsonb_array_elements(r.skills) e
            WHERE b.candidate_id = c.id AND b.is_active AND r.category = 'BASE' AND r.version = 1
              AND r.deleted_at IS NULL), '[]'::jsonb)
    """))
    conn.execute(sa.text("""
        UPDATE candidates c SET persona = jsonb_build_object(
            'summary', COALESCE((
                SELECT r.summary FROM resumes r JOIN base_resumes b ON b.id = r.base_resume_id
                WHERE b.candidate_id = c.id AND b.is_active AND r.category = 'BASE' AND r.version = 1
                  AND r.deleted_at IS NULL LIMIT 1), ''),
            'tone_notes', NULL,
            'will_relocate', c.willing_to_relocate,
            'notice_period_days', c.notice_period_days,
            'preferred_industries', to_jsonb(c.preferred_industries),
            'deal_breakers', to_jsonb(c.deal_breakers))
    """))
    op.create_check_constraint('ck_candidates_summary_unverified', 'candidates', "summary_state = 'UNVERIFIED'")
    op.drop_column('candidates', 'deal_breakers')
    op.drop_column('candidates', 'preferred_industries')
