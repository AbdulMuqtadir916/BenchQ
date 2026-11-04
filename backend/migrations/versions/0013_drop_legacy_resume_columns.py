"""Résumé versioning PR 6: JobNavigator's résumé rows removed, the approved drops, every résumé on a base
(docs/team/resume-versioning.md §3.3; decided 2026-11-02, simplified 2026-11-04)

Revision ID: 0013
Revises: 0012
Create Date: 2026-11-02 18:00:00.000000

**WARNING: this deletes résumé rows for good.** Every `resumes` row without a base (`base_resume_id IS NULL`) is
JobNavigator's from before versioning (the seeded "Sample PM", firm-level résumés, old tailored copies); BenchQ keeps
none of it and nothing is converted. Applications and cover letters that pointed at one lose the link; tracking links
and their click history on it are deleted. On a database with real customer data, check what it would delete first:
`SELECT id, name, candidate_id FROM resumes WHERE base_resume_id IS NULL`.

Then the approved drops: `resumes.is_base`, `parent_id`, `json_data`, `resume_parse_id`, `updated_at`,
`resume_parses.updated_at`, the index `uq_resumes_one_base_per_candidate`. `base_resume_id` and `candidate_id`
become `NOT NULL`, so the "rows with a base only" exceptions of 0008 go.

The downgrade brings the columns back, empty; the deleted rows don't come back.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = '0013'
down_revision = '0012'
branch_labels = None
depends_on = None

_ONE_BASE = 'is_base AND candidate_id IS NOT NULL AND base_resume_id IS NULL'   # 0008's narrowed form
_CATEGORY_JOB = "(category = 'BASE' AND job_id IS NULL) OR (category = 'TAILORED' AND job_id IS NOT NULL)"
_CATEGORY_JOB_OLD = f"base_resume_id IS NULL OR {_CATEGORY_JOB}"


# JobNavigator's own résumé rows (no base) are not kept: BenchQ starts from its own data (Zuhair, 2026-11-04). Anything
# that points at one lets go: applications and cover letters lose the link (SET NULL), tracking links and their click
# history go with it (CASCADE).
def _delete_old_rows(conn) -> None:
    conn.execute(sa.text("DELETE FROM resumes WHERE base_resume_id IS NULL"))


def upgrade() -> None:
    _delete_old_rows(op.get_bind())

    op.drop_index('uq_resumes_one_base_per_candidate', table_name='resumes', postgresql_where=sa.text(_ONE_BASE))
    op.drop_constraint('resumes_parent_id_fkey', 'resumes', type_='foreignkey')
    op.drop_constraint('resumes_resume_parse_id_fkey', 'resumes', type_='foreignkey')
    for name in ('is_base', 'parent_id', 'json_data', 'resume_parse_id', 'updated_at'):
        op.drop_column('resumes', name)
    op.drop_column('resume_parses', 'updated_at')

    op.drop_constraint('ck_resumes_base_has_candidate', 'resumes', type_='check')
    op.drop_constraint('ck_resumes_category_job', 'resumes', type_='check')
    op.create_check_constraint('ck_resumes_category_job', 'resumes', _CATEGORY_JOB)
    op.drop_index('uq_resumes_version', table_name='resumes', postgresql_nulls_not_distinct=True,
                  postgresql_where=sa.text('base_resume_id IS NOT NULL'))
    op.create_index('uq_resumes_version', 'resumes', ['base_resume_id', 'category', 'job_id', 'version'], unique=True,
                    postgresql_nulls_not_distinct=True)
    op.alter_column('resumes', 'base_resume_id', nullable=False)
    op.alter_column('resumes', 'candidate_id', nullable=False)

    # Soft delete (§4.7): deleting a version or a base marks the row instead of removing it.
    op.add_column('resumes', sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('base_resumes', sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column('base_resumes', 'deleted_at')
    op.drop_column('resumes', 'deleted_at')
    op.alter_column('resumes', 'candidate_id', nullable=True)
    op.alter_column('resumes', 'base_resume_id', nullable=True)
    op.drop_index('uq_resumes_version', table_name='resumes', postgresql_nulls_not_distinct=True)
    op.create_index('uq_resumes_version', 'resumes', ['base_resume_id', 'category', 'job_id', 'version'], unique=True,
                    postgresql_nulls_not_distinct=True, postgresql_where=sa.text('base_resume_id IS NOT NULL'))
    op.drop_constraint('ck_resumes_category_job', 'resumes', type_='check')
    op.create_check_constraint('ck_resumes_category_job', 'resumes', _CATEGORY_JOB_OLD)
    op.create_check_constraint('ck_resumes_base_has_candidate', 'resumes',
                               'base_resume_id IS NULL OR candidate_id IS NOT NULL')

    op.add_column('resume_parses', sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'),
                                             nullable=False))
    op.add_column('resumes', sa.Column('is_base', sa.Boolean(), nullable=True))
    op.add_column('resumes', sa.Column('parent_id', sa.UUID(), nullable=True))
    op.add_column('resumes', sa.Column('json_data', postgresql.JSON(astext_type=sa.Text()), nullable=True))
    op.add_column('resumes', sa.Column('resume_parse_id', sa.UUID(), nullable=True))
    op.add_column('resumes', sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True))
    op.create_foreign_key('resumes_parent_id_fkey', 'resumes', 'resumes', ['parent_id'], ['id'], ondelete='SET NULL')
    op.create_foreign_key('resumes_resume_parse_id_fkey', 'resumes', 'resume_parses', ['resume_parse_id'], ['id'],
                          ondelete='RESTRICT')
    op.get_bind().execute(sa.text("UPDATE resumes SET is_base = (category = 'BASE'), updated_at = created_at"))
    op.create_index('uq_resumes_one_base_per_candidate', 'resumes', ['candidate_id'], unique=True,
                    postgresql_where=sa.text(_ONE_BASE))
