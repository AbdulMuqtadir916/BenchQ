"""Job search tables (docs/02 §6.y; Zuhair's track): `job_postings` and `scrape_jobs`.

`job_postings`: the job-search module's own candidate-scoped jobs table. Deliberately not named `jobs` — the
existing shared-pool `jobs` table and everything that points at it (`applications.job_id`,
`job_runs.target_job_id`, `candidate_jobs`, `favorite_jobs`, `firm_jobs`) is unchanged. Repointing those, and
reclaiming the `jobs` name once nothing references the old table, is a later migration. One row per job a search
found for one candidate: `(candidate_id, job_id)` is unique, and a repeat match updates `batch_id`/`last_seen_at`
on the existing row instead of inserting a duplicate (application code, not this migration), so `batch_id` is the
last batch that found it. `job_id` is a content hash (SHA256 hex, checked), not the board's id. Everything about
the job lives in one `content` JSONB column (decided 2026-11-09). No status column: saved/applied live in
`applications` (decided 2026-11-10).

`scrape_jobs`: one row per finished batch. Logging, not a queue — written once a batch completes, so there are no
`request`/`pending` rows. `state` is success (jobs came back), empty (the source answered with none) or error (it
failed); `error` holds the failure detail and is set exactly when `state = 'error'`. `metadata` holds the rest of
the source's response (request id, parameters, totals): everything but the jobs. `batch_id` is unique, and
`job_postings.batch_id` references it: on success the batch row and its postings are written in one transaction.

Tenancy: both tables reference `candidates (firm_id, id)` with `(firm_id, candidate_id)`, so a row can't carry a
firm other than its candidate's. That needs `UNIQUE (firm_id, id)` on `candidates`, added here.

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
    op.create_unique_constraint('uq_candidates_firm_id', 'candidates', ['firm_id', 'id'])

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
        sa.CheckConstraint("state IN ('success', 'empty', 'error')", name='ck_scrape_jobs_state'),
        sa.CheckConstraint("(state = 'error') = (error IS NOT NULL)", name='ck_scrape_jobs_error_iff_error'),
        sa.ForeignKeyConstraint(['firm_id'], ['firms.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['firm_id', 'candidate_id'], ['candidates.firm_id', 'candidates.id'],
                                name='fk_scrape_jobs_firm_candidate', ondelete='RESTRICT'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('batch_id'),
    )
    op.create_index('ix_scrape_jobs_firm_candidate', 'scrape_jobs', ['firm_id', 'candidate_id'], unique=False)

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
        sa.Column('discovered_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('last_seen_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint("job_id ~ '^[0-9a-f]{64}$'", name='ck_job_postings_job_id_sha256'),
        sa.ForeignKeyConstraint(['firm_id'], ['firms.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['firm_id', 'candidate_id'], ['candidates.firm_id', 'candidates.id'],
                                name='fk_job_postings_firm_candidate', ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['batch_id'], ['scrape_jobs.batch_id'], ondelete='RESTRICT'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('candidate_id', 'job_id', name='uq_job_postings_candidate_job'),
    )
    op.create_index(op.f('ix_job_postings_batch_id'), 'job_postings', ['batch_id'], unique=False)
    op.create_index('ix_job_postings_firm_candidate', 'job_postings', ['firm_id', 'candidate_id'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_job_postings_firm_candidate', table_name='job_postings')
    op.drop_index(op.f('ix_job_postings_batch_id'), table_name='job_postings')
    op.drop_table('job_postings')
    op.drop_index('ix_scrape_jobs_firm_candidate', table_name='scrape_jobs')
    op.drop_table('scrape_jobs')
    op.drop_constraint('uq_candidates_firm_id', 'candidates', type_='unique')
