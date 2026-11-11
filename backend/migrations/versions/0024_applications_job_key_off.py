"""Applications let go of the old `jobs` pool (docs/02 §6.y; the add-job plan, decided 2026-11-11). Schema only.

Revision ID: 0024
Revises: 0021
Create Date: 2026-11-11 12:00:00.000000

- `applications.job_id` stops referencing `jobs.id` (`applications_job_id_fkey` goes): it is about to name one of the
  candidate's `job_postings` instead (0025).
- `job_postings` gets `UNIQUE (firm_id, candidate_id, id)`, the target of `applications`' new key (the name job search
  PR 2, #124, gives it too).

Nothing is copied or changed in a row. A database with applications on old jobs moves them before 0025, which refuses
until it's done: locally, `python -m backend.scripts.move_local_jobs_to_postings` (it copies each candidate's old
jobs into `job_postings` and points the applications at them). Follows 0021.
"""
from alembic import op


revision = '0024'
down_revision = '0021'
branch_labels = None
depends_on = None


def upgrade():
    op.drop_constraint('applications_job_id_fkey', 'applications', type_='foreignkey')
    op.create_unique_constraint('uq_job_postings_firm_candidate_id', 'job_postings', ['firm_id', 'candidate_id', 'id'])


def downgrade():
    # The key back onto `jobs` holds only while every application still names an old job; the move's own downgrade
    # (`--undo`) points them back first.
    op.drop_constraint('uq_job_postings_firm_candidate_id', 'job_postings', type_='unique')
    op.create_foreign_key('applications_job_id_fkey', 'applications', 'jobs', ['job_id'], ['id'])
