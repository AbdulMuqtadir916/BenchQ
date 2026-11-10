"""Who ran a job search: `scrape_jobs.user_id` (docs/02 §6.y; Zuhair's track, job search PR 1).

Revision ID: 0022
Revises: 0021
Create Date: 2026-11-10 18:00:00.000000

The candidate's BDE who started the search. A BDE has 20 search attempts a day, counted from these rows since the last
6:30 PM IST (backend/job_search/limits.py), so the count survives a restart and is derived, never stored. NOT NULL with
no backfill: nothing wrote `scrape_jobs` before this revision (0020 only made the table), so the column is added to an
empty table; a row from a hand-run test would stop the upgrade, which is the safe failure.

Two indexes for the limits and the history: `scrape_jobs (user_id, created_at)` (a BDE's attempts today) and
`scrape_jobs (candidate_id, created_at)` (a candidate's searches, newest first); `job_postings (candidate_id,
discovered_at)` (a candidate's jobs newest first, and the new jobs saved today, capped at 100).

Follows 0021 (Arbaz's).
"""
from alembic import op
import sqlalchemy as sa


revision = '0022'
down_revision = '0021'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('scrape_jobs', sa.Column('user_id', sa.UUID(), nullable=False))
    op.create_foreign_key('scrape_jobs_user_id_fkey', 'scrape_jobs', 'users', ['user_id'], ['id'], ondelete='RESTRICT')
    op.create_index('ix_scrape_jobs_user_created', 'scrape_jobs', ['user_id', 'created_at'])
    op.create_index('ix_scrape_jobs_candidate_created', 'scrape_jobs', ['candidate_id', 'created_at'])
    op.create_index('ix_job_postings_candidate_discovered', 'job_postings', ['candidate_id', 'discovered_at'])


def downgrade():
    op.drop_index('ix_job_postings_candidate_discovered', table_name='job_postings')
    op.drop_index('ix_scrape_jobs_candidate_created', table_name='scrape_jobs')
    op.drop_index('ix_scrape_jobs_user_created', table_name='scrape_jobs')
    op.drop_constraint('scrape_jobs_user_id_fkey', 'scrape_jobs', type_='foreignkey')
    op.drop_column('scrape_jobs', 'user_id')
