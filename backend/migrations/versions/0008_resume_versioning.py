"""Résumé versioning: base_resumes, the new resumes columns, award claims (docs/team/resume-versioning.md §3; PR 3)

Revision ID: 0008
Revises: 0007
Create Date: 2026-11-01 16:00:00.000000

Additive only; nothing reads or writes the new columns yet (PR 4 does):
- `base_resumes`: a candidate's shelf of bases, one active (§3.2). It holds no content.
- `resumes`: the base it comes from (`base_resume_id`, with the same candidate), `category` (BASE / TAILORED),
  `version`, who saved it, and one column per section of the parser's format; an empty section is `[]` (§3.3).
  Rows from before this migration have no base and keep their `json_data` until PR 6 converts them, so the version
  rules hold for rows with a base only; their `category` is filled from `is_base` here.
- `resumes.job_id` is ON DELETE CASCADE (was SET NULL): deleting a job deletes the résumés tailored for it (Abdul,
  2026-11-01). An application still blocks deleting a job it names.
- `claims.entity_type` gains `award` (§1, "Awards are claims").
- 0007's `uq_resumes_one_base_per_candidate` now covers rows from before versioning only: a versioned candidate has
  many bases, each with many versions. Abdul approved dropping it (§1); PR 6 does, once the old rows are converted.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = '0008'
down_revision = '0007'
branch_labels = None
depends_on = None

_EMPTY = sa.text("'[]'::jsonb")
_CONTENT = ('skills', 'experiences', 'projects', 'educations', 'certifications', 'awards', 'languages')
_HEADER = ('full_name', 'title', 'city', 'state', 'country', 'email', 'phone', 'work_authorization', 'github',
           'linkedin')
_OLD_ENTITY_TYPES = "entity_type IN ('summary', 'experience', 'skill', 'project', 'certificate', 'education')"
_ENTITY_TYPES = "entity_type IN ('summary', 'experience', 'skill', 'project', 'certificate', 'education', 'award')"
_ONE_BASE_OLD = 'is_base AND candidate_id IS NOT NULL'
_ONE_BASE_NEW = 'is_base AND candidate_id IS NOT NULL AND base_resume_id IS NULL'


def upgrade() -> None:
    op.create_table('base_resumes',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('firm_id', sa.UUID(), nullable=False),
    sa.Column('candidate_id', sa.UUID(), nullable=False),
    sa.Column('source', sa.String(), nullable=False),
    sa.Column('resume_parse_id', sa.UUID(), nullable=True),
    sa.Column('is_active', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    sa.Column('created_by_user_id', sa.UUID(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("source IN ('UPLOAD', 'PROMOTED')", name='ck_base_resumes_source_values'),
    sa.CheckConstraint("source = 'PROMOTED' OR resume_parse_id IS NOT NULL", name='ck_base_resumes_source'),
    sa.ForeignKeyConstraint(['candidate_id'], ['candidates.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['created_by_user_id'], ['users.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['firm_id'], ['firms.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['resume_parse_id'], ['resume_parses.id'], ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('id', 'candidate_id', name='uq_base_resumes_id_candidate')
    )
    op.create_index('ix_base_resumes_firm_candidate', 'base_resumes', ['firm_id', 'candidate_id'], unique=False)
    op.create_index('uq_base_resumes_one_active', 'base_resumes', ['candidate_id'], unique=True,
                    postgresql_where=sa.text('is_active'))

    op.add_column('resumes', sa.Column('base_resume_id', sa.UUID(), nullable=True))
    op.add_column('resumes', sa.Column('category', sa.String(), server_default=sa.text("'BASE'"), nullable=False))
    op.add_column('resumes', sa.Column('version', sa.Integer(), server_default=sa.text('1'), nullable=False))
    op.add_column('resumes', sa.Column('created_by_user_id', sa.UUID(), nullable=True))
    for name in _HEADER:
        op.add_column('resumes', sa.Column(name, sa.String(), nullable=True))
    op.add_column('resumes', sa.Column('summary', sa.Text(), nullable=True))
    for name in _CONTENT:
        op.add_column('resumes', sa.Column(name, postgresql.JSONB(astext_type=sa.Text()), server_default=_EMPTY,
                                           nullable=False))
    # Rows from before versioning: a tailored one is the one that isn't a base.
    op.execute("UPDATE resumes SET category = 'TAILORED' WHERE is_base IS FALSE")

    op.create_check_constraint('ck_resumes_category_values', 'resumes', "category IN ('BASE', 'TAILORED')")
    op.create_check_constraint('ck_resumes_category_job', 'resumes',
                               "base_resume_id IS NULL OR (category = 'BASE' AND job_id IS NULL) "
                               "OR (category = 'TAILORED' AND job_id IS NOT NULL)")
    op.create_check_constraint('ck_resumes_base_has_candidate', 'resumes',
                               'base_resume_id IS NULL OR candidate_id IS NOT NULL')
    op.create_foreign_key('fk_resumes_base_candidate', 'resumes', 'base_resumes', ['base_resume_id', 'candidate_id'],
                          ['id', 'candidate_id'], ondelete='RESTRICT')
    op.create_foreign_key('resumes_created_by_user_id_fkey', 'resumes', 'users', ['created_by_user_id'], ['id'],
                          ondelete='RESTRICT')
    op.create_index('uq_resumes_version', 'resumes', ['base_resume_id', 'category', 'job_id', 'version'], unique=True,
                    postgresql_nulls_not_distinct=True, postgresql_where=sa.text('base_resume_id IS NOT NULL'))

    op.drop_index('uq_resumes_one_base_per_candidate', table_name='resumes', postgresql_where=sa.text(_ONE_BASE_OLD))
    op.create_index('uq_resumes_one_base_per_candidate', 'resumes', ['candidate_id'], unique=True,
                    postgresql_where=sa.text(_ONE_BASE_NEW))

    op.drop_constraint('resumes_job_id_fkey', 'resumes', type_='foreignkey')
    op.create_foreign_key('resumes_job_id_fkey', 'resumes', 'jobs', ['job_id'], ['id'], ondelete='CASCADE')

    op.drop_constraint('ck_claims_entity_type', 'claims', type_='check')
    op.create_check_constraint('ck_claims_entity_type', 'claims', _ENTITY_TYPES)


def downgrade() -> None:
    # Fails while award claims exist, on purpose: delete them first if you really mean to go back.
    op.drop_constraint('ck_claims_entity_type', 'claims', type_='check')
    op.create_check_constraint('ck_claims_entity_type', 'claims', _OLD_ENTITY_TYPES)

    op.drop_constraint('resumes_job_id_fkey', 'resumes', type_='foreignkey')
    op.create_foreign_key('resumes_job_id_fkey', 'resumes', 'jobs', ['job_id'], ['id'], ondelete='SET NULL')

    # Fails while a candidate has more than one base row, on purpose: going back means one base per candidate again.
    op.drop_index('uq_resumes_one_base_per_candidate', table_name='resumes', postgresql_where=sa.text(_ONE_BASE_NEW))
    op.create_index('uq_resumes_one_base_per_candidate', 'resumes', ['candidate_id'], unique=True,
                    postgresql_where=sa.text(_ONE_BASE_OLD))

    op.drop_index('uq_resumes_version', table_name='resumes', postgresql_nulls_not_distinct=True,
                  postgresql_where=sa.text('base_resume_id IS NOT NULL'))
    op.drop_constraint('resumes_created_by_user_id_fkey', 'resumes', type_='foreignkey')
    op.drop_constraint('fk_resumes_base_candidate', 'resumes', type_='foreignkey')
    op.drop_constraint('ck_resumes_base_has_candidate', 'resumes', type_='check')
    op.drop_constraint('ck_resumes_category_job', 'resumes', type_='check')
    op.drop_constraint('ck_resumes_category_values', 'resumes', type_='check')
    for name in ('summary', *_HEADER, *_CONTENT, 'created_by_user_id', 'version', 'category', 'base_resume_id'):
        op.drop_column('resumes', name)

    op.drop_index('uq_base_resumes_one_active', table_name='base_resumes', postgresql_where=sa.text('is_active'))
    op.drop_index('ix_base_resumes_firm_candidate', table_name='base_resumes')
    op.drop_table('base_resumes')
