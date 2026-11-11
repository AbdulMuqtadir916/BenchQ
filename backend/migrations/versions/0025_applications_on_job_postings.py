"""Applications on `job_postings` (docs/02 §6.y; the add-job plan, decided 2026-11-11). Schema only.

Revision ID: 0025
Revises: 0024
Create Date: 2026-11-11 12:05:00.000000

- `applications (firm_id, candidate_id, job_id)` → `job_postings (firm_id, candidate_id, id)` ON DELETE RESTRICT: an
  application names one of its own candidate's jobs, in its own firm; a job with an application can't be deleted.
- `applications.candidate_id` is NOT NULL: every application is a candidate's.

Refuses, changing nothing, while an application has no candidate or names anything but one of its candidate's
postings (an old pool job): move them first. Locally, `python -m backend.scripts.move_local_jobs_to_postings`, run at
0024, does that; a database with no such rows needs nothing. Follows 0024.
"""
from alembic import op
import sqlalchemy as sa


revision = '0025'
down_revision = '0024'
branch_labels = None
depends_on = None


def upgrade():
    unmoved = op.get_bind().execute(sa.text(
        "SELECT count(*) FROM applications a WHERE a.candidate_id IS NULL OR NOT EXISTS ("
        "SELECT 1 FROM job_postings p WHERE p.id = a.job_id AND p.candidate_id = a.candidate_id "
        "AND p.firm_id = a.firm_id)")).scalar()
    if unmoved:
        raise RuntimeError(f"{unmoved} application(s) still name an old pool job (or no candidate). Move them first: "
                           "at 0024, run `python -m backend.scripts.move_local_jobs_to_postings`, then upgrade again.")
    op.alter_column('applications', 'candidate_id', nullable=False)
    op.create_foreign_key('fk_applications_job_posting', 'applications', 'job_postings',
                          ['firm_id', 'candidate_id', 'job_id'], ['firm_id', 'candidate_id', 'id'], ondelete='RESTRICT')


def downgrade():
    op.drop_constraint('fk_applications_job_posting', 'applications', type_='foreignkey')
    op.alter_column('applications', 'candidate_id', nullable=True)
