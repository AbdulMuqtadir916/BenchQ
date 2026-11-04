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

`candidates.skills` and `summary_state` go too: skills, the summary and every other item are claims now (`claims`,
written UNVERIFIED when a candidate or a later upload is made), and the state lives on the claim. **WARNING: nothing is
converted.** A candidate made before this has its skills only in its résumé version 1, and no claims; BenchQ ships on a
fresh database, so none exist.

`candidates.needs_sponsorship` may now be NULL (unknown), and loses its default of false: a candidate whose work authorization is `OTHER` has no rule to
work it out from, and nobody entering a value is not the same as "no". The downgrade turns NULL into false.

`base_resumes.source` gains `MANUAL`: a candidate created without a résumé file gets a base made from the new-candidate
form alone, so every candidate has a base. Such a base has no parse (`resume_parse_id` NULL), like a promoted one.

Follows 0014 (Samad's email classification, PR #111).

The downgrade rebuilds `persona` from the columns (its summary from the active base's version 1; `tone_notes` empty),
`skills` from the candidate's skill claims (no family), `summary_state` as UNVERIFIED, and turns each `MANUAL` base into
a `PROMOTED` one, the nearest source the old CHECK allows.
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
    op.alter_column('candidates', 'needs_sponsorship', existing_type=sa.Boolean(), nullable=True, server_default=None)
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


def downgrade() -> None:
    conn = op.get_bind()
    op.drop_constraint('ck_base_resumes_source', 'base_resumes', type_='check')
    op.drop_constraint('ck_base_resumes_source_values', 'base_resumes', type_='check')
    conn.execute(sa.text("UPDATE base_resumes SET source = 'PROMOTED' WHERE source = 'MANUAL'"))
    op.create_check_constraint('ck_base_resumes_source_values', 'base_resumes', "source IN ('UPLOAD', 'PROMOTED')")
    op.create_check_constraint('ck_base_resumes_source', 'base_resumes',
                               "source = 'PROMOTED' OR resume_parse_id IS NOT NULL")

    conn.execute(sa.text("UPDATE candidates SET needs_sponsorship = false WHERE needs_sponsorship IS NULL"))
    op.alter_column('candidates', 'needs_sponsorship', existing_type=sa.Boolean(), nullable=False,
                    server_default=sa.text('false'))
    op.add_column('candidates', sa.Column('summary_state', sa.String(), nullable=False,
                                          server_default=sa.text("'UNVERIFIED'")))
    op.add_column('candidates', sa.Column('skills', postgresql.JSONB(astext_type=sa.Text()), nullable=False,
                                          server_default=sa.text("'[]'::jsonb")))
    op.add_column('candidates', sa.Column('persona', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    conn.execute(sa.text("""
        UPDATE candidates c SET skills = COALESCE((
            SELECT jsonb_agg(jsonb_build_object('name', d.text, 'family', NULL, 'source', d.source,
                                                'state', 'UNVERIFIED') ORDER BY d.created_at)
            FROM (SELECT DISTINCT ON (k.text) k.text, k.source, k.created_at FROM claims k
                  WHERE k.candidate_id = c.id AND k.entity_type = 'skill' ORDER BY k.text, k.created_at) d),
            '[]'::jsonb)
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
