"""Who ran a job search and whether it is still running: `scrape_jobs.user_id`, `running`, `finished_at` (docs/02 §6.y;
Zuhair's track, job search PR 1).

Revision ID: 0022
Revises: 0021
Create Date: 2026-11-10 18:00:00.000000

The candidate's BDE who started the search. A BDE has 20 search attempts a day, counted from these rows since the last
6:30 PM IST (backend/job_search/limits.py), so the count survives a restart and is derived, never stored. NOT NULL,
filled in first for rows already there, so the upgrade also runs again after a downgrade that kept them (Abdul's
review, P2): who ran it is the actor of the search's own ledger entry, else the candidate's BDE, else whoever added
the candidate (never null). A finished row's `finished_at` is its start, the best known.

The search runs in the background (decided 2026-11-10), so its row is written `running` when it starts and finished
in place: `state` also allows `running`, and `finished_at` is set exactly when it isn't running. A `running` row is
what "a search is running" and the BDE's attempts read; one left by a restart is marked `error` after 15 minutes.

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
    op.add_column('scrape_jobs', sa.Column('user_id', sa.UUID(), nullable=True))
    op.add_column('scrape_jobs', sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True))
    # Rows from before this revision (a downgrade keeps them): every one is finished; fill in who ran it.
    op.execute("""
        UPDATE scrape_jobs s SET user_id = COALESCE(
            (SELECT l.actor_user_id FROM ledger_entries l JOIN users u ON u.id = l.actor_user_id
              WHERE l.entity_type = 'job_search' AND l.entity_id = s.batch_id::text AND l.firm_id = s.firm_id
              ORDER BY l.created_at LIMIT 1),
            (SELECT COALESCE(c.bde_id, c.created_by_user_id) FROM candidates c
              WHERE c.id = s.candidate_id AND c.firm_id = s.firm_id))
        WHERE s.user_id IS NULL""")
    op.execute("UPDATE scrape_jobs SET finished_at = created_at WHERE finished_at IS NULL")
    op.alter_column('scrape_jobs', 'user_id', nullable=False)
    op.drop_constraint('ck_scrape_jobs_state', 'scrape_jobs', type_='check')
    op.create_check_constraint('ck_scrape_jobs_state', 'scrape_jobs', "state IN ('success', 'empty', 'error', 'running')")
    op.create_check_constraint('ck_scrape_jobs_finished_iff_done', 'scrape_jobs', "(state = 'running') = (finished_at IS NULL)")
    op.create_foreign_key('scrape_jobs_user_id_fkey', 'scrape_jobs', 'users', ['user_id'], ['id'], ondelete='RESTRICT')
    op.create_index('ix_scrape_jobs_user_created', 'scrape_jobs', ['user_id', 'created_at'])
    op.create_index('ix_scrape_jobs_candidate_created', 'scrape_jobs', ['candidate_id', 'created_at'])
    op.create_index('ix_job_postings_candidate_discovered', 'job_postings', ['candidate_id', 'discovered_at'])


def downgrade():
    op.drop_index('ix_job_postings_candidate_discovered', table_name='job_postings')
    op.drop_index('ix_scrape_jobs_candidate_created', table_name='scrape_jobs')
    op.drop_index('ix_scrape_jobs_user_created', table_name='scrape_jobs')
    op.drop_constraint('scrape_jobs_user_id_fkey', 'scrape_jobs', type_='foreignkey')
    op.drop_constraint('ck_scrape_jobs_finished_iff_done', 'scrape_jobs', type_='check')
    # A search still running has no place in 0021's states: it ends as an error, as a restart would leave it.
    op.execute("UPDATE scrape_jobs SET state = 'error', error = 'internal: The search was stopped.' "
               "WHERE state = 'running'")
    op.drop_constraint('ck_scrape_jobs_state', 'scrape_jobs', type_='check')
    op.create_check_constraint('ck_scrape_jobs_state', 'scrape_jobs', "state IN ('success', 'empty', 'error')")
    op.drop_column('scrape_jobs', 'finished_at')
    op.drop_column('scrape_jobs', 'user_id')
