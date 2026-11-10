"""Job search tables (docs/02 §6.y; Zuhair's track): `job_postings` and `scrape_jobs`.

`job_postings`: the job-search module's own candidate-scoped jobs table. Deliberately not named `jobs` — the
existing shared-pool `jobs` table and everything that points at it (`applications.job_id`,
`job_runs.target_job_id`, `candidate_jobs`, `favorite_jobs`, `firm_jobs`) is unchanged. Repointing those, and
reclaiming the `jobs` name once nothing references the old table, is a later migration. One row per job a search
found for one candidate: `(candidate_id, job_id)` is unique, and a repeat match updates `batch_id`/`last_seen_at`
on the existing row instead of inserting a duplicate (application code, not this migration). `job_id` is a content
hash, not the board's id. Everything about the job lives in one `content` JSONB column (decided 2026-11-09): the
set of sources isn't fixed, and typed columns built around one source would need a migration per new source.

`scrape_jobs`: one row per finished batch. Logging, not a queue — written once a batch completes (success or
error), so there are no `request`/`pending` rows. `error` is the failure detail, only set when `state = 'error'`. `metadata` holds the rest of the source's response
(request id, parameters, totals): everything but the jobs, which are `job_postings` rows.
`batch_id` is unique: one row logs the whole batch, not per source (freehire.me is the only live source).

Follows 0019.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = '0020'
down_revision = '0019'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'job_postings',
        sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('firm_id', sa.UUID(), nullable=False),
        sa.Column('candidate_id', sa.UUID(), nullable=False),
        sa.Column('batch_id', sa.UUID(), nullable=False),
        sa.Column('source', sa.String(), nullable=False),
        sa.Column('job_id', sa.String(length=64), nullable=False),
        sa.Column('content', postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"),
                  nullable=False),
        sa.Column('status', sa.String(), server_default=sa.text("'new'"), nullable=False),
        sa.Column('discovered_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('last_seen_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint("status IN ('new', 'saved', 'dismissed', 'applied')", name='ck_job_postings_status'),
        sa.ForeignKeyConstraint(['candidate_id'], ['candidates.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['firm_id'], ['firms.id'], ondelete='RESTRICT'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('candidate_id', 'job_id', name='uq_job_postings_candidate_job'),
    )
    op.create_index(op.f('ix_job_postings_firm_id'), 'job_postings', ['firm_id'], unique=False)
    op.create_index(op.f('ix_job_postings_candidate_id'), 'job_postings', ['candidate_id'], unique=False)
    op.create_index(op.f('ix_job_postings_batch_id'), 'job_postings', ['batch_id'], unique=False)
    op.create_index(op.f('ix_job_postings_job_id'), 'job_postings', ['job_id'], unique=False)

    op.create_table(
        'scrape_jobs',
        sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('firm_id', sa.UUID(), nullable=False),
        sa.Column('candidate_id', sa.UUID(), nullable=False),
        sa.Column('batch_id', sa.UUID(), nullable=False),
        sa.Column('state', sa.String(), nullable=False),
        sa.Column('error', sa.Text(), nullable=True),
        sa.Column('metadata', postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"),
                  nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint("state IN ('success', 'error')", name='ck_scrape_jobs_state'),
        sa.CheckConstraint("state = 'error' OR error IS NULL", name='ck_scrape_jobs_error_only_on_error'),
        sa.ForeignKeyConstraint(['candidate_id'], ['candidates.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['firm_id'], ['firms.id'], ondelete='RESTRICT'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('batch_id'),
    )
    op.create_index(op.f('ix_scrape_jobs_firm_id'), 'scrape_jobs', ['firm_id'], unique=False)
    op.create_index(op.f('ix_scrape_jobs_candidate_id'), 'scrape_jobs', ['candidate_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_scrape_jobs_candidate_id'), table_name='scrape_jobs')
    op.drop_index(op.f('ix_scrape_jobs_firm_id'), table_name='scrape_jobs')
    op.drop_table('scrape_jobs')
    op.drop_index(op.f('ix_job_postings_job_id'), table_name='job_postings')
    op.drop_index(op.f('ix_job_postings_batch_id'), table_name='job_postings')
    op.drop_index(op.f('ix_job_postings_candidate_id'), table_name='job_postings')
    op.drop_index(op.f('ix_job_postings_firm_id'), table_name='job_postings')
    op.drop_table('job_postings')
