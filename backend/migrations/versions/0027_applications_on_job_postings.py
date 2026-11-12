"""Applications on `job_postings` (docs/02 §6.y; the add-job plan, decided 2026-11-11). Schema only.

Revision ID: 0027
Revises: 0026
Create Date: 2026-11-11 12:05:00.000000

- `applications (firm_id, candidate_id, job_id)` → `job_postings (firm_id, candidate_id, id)` ON DELETE RESTRICT: an
  application names one of its own candidate's jobs, in its own firm; a job with an application can't be deleted.
- `applications.candidate_id` is NOT NULL: every application is a candidate's.

Nothing is moved here: the app isn't live, so only a developer's database holds applications, and those were moved
by `python -m backend.scripts.move_local_jobs_to_postings` (run at 0026). On a database that still has an application
without a candidate or on an old pool job, the NOT NULL or the new key refuses it and the upgrade stops. Follows 0026.
"""
from alembic import op


revision = '0027'
down_revision = '0026'
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column('applications', 'candidate_id', nullable=False)
    op.create_foreign_key('fk_applications_job_posting', 'applications', 'job_postings',
                          ['firm_id', 'candidate_id', 'job_id'], ['firm_id', 'candidate_id', 'id'], ondelete='RESTRICT')


def downgrade():
    op.drop_constraint('fk_applications_job_posting', 'applications', type_='foreignkey')
    op.alter_column('applications', 'candidate_id', nullable=True)
