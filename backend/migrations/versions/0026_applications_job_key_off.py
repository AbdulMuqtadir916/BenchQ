"""Applications let go of the old `jobs` pool (docs/02 §6.y; the add-job plan, decided 2026-11-11). Schema only.

Revision ID: 0026
Revises: 0025
Create Date: 2026-11-11 12:00:00.000000

- `applications.job_id` stops referencing `jobs.id` (`applications_job_id_fkey` goes): it is about to name one of the
  candidate's `job_postings` instead (0027), through `uq_job_postings_firm_candidate_id`, which job search PR 2 (0023)
  made for it.

Nothing is copied or changed in a row. A database with applications on old jobs moves them before 0027, whose new key
refuses them otherwise: locally, `python -m backend.scripts.move_local_jobs_to_postings` (it copies each candidate's old
jobs into `job_postings` and points the applications at them). Follows 0025 (PR 4's email outcome).
"""
from alembic import op


revision = '0026'
down_revision = '0025'
branch_labels = None
depends_on = None


def upgrade():
    op.drop_constraint('applications_job_id_fkey', 'applications', type_='foreignkey')


def downgrade():
    # The key back onto `jobs` holds only while every application still names an old job; the move's own downgrade
    # (`--undo`) points them back first.
    op.create_foreign_key('applications_job_id_fkey', 'applications', 'jobs', ['job_id'], ['id'])
