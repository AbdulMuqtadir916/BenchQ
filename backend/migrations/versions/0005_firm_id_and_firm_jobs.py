"""firm_id on the firm-owned tables, and firm_jobs (F2b)

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-23 10:00:00.000000

Every firm-owned table that exists today gets a `firm_id` (docs/integration/07-auth-and-tenancy.md F2b, agreed
2026-10-23): applications, interviews, resumes, cover_letters, tracer_links, tracer_click_events and searches,
NOT NULL; job_runs and llm_call_log, nullable (a platform run or call has no firm). Child rows carry their own
column, so one scoping rule and the isolation test (F7) treat every table the same way.

Rows that existed before this revision belong to the "Default firm" migration 0003 created, so each column is
added nullable, backfilled, then made NOT NULL. `jobs` stays one shared pool; `firm_jobs` says which jobs a firm
sees (07 Q37), and every existing job is linked to the Default firm.
"""
from alembic import op
import sqlalchemy as sa


revision = '0005'
down_revision = '0004'
branch_labels = None
depends_on = None

DEFAULT_FIRM_ID = '00000000-0000-4000-8000-000000000002'   # models/tenancy.py DEFAULT_FIRM_ID (migration 0003)

REQUIRED = ('searches', 'applications', 'interviews', 'resumes', 'cover_letters', 'tracer_links',
            'tracer_click_events')
OPTIONAL = ('job_runs', 'llm_call_log')


def _add_firm_id(table: str, nullable: bool) -> None:
    op.add_column(table, sa.Column('firm_id', sa.UUID(), nullable=True))
    op.create_index(op.f(f'ix_{table}_firm_id'), table, ['firm_id'], unique=False)
    op.create_foreign_key(f'{table}_firm_id_fkey', table, 'firms', ['firm_id'], ['id'], ondelete='RESTRICT')
    if not nullable:
        op.execute(f"UPDATE {table} SET firm_id = '{DEFAULT_FIRM_ID}'")
        op.alter_column(table, 'firm_id', nullable=False)


def upgrade() -> None:
    for table in REQUIRED:
        _add_firm_id(table, nullable=False)
    for table in OPTIONAL:
        _add_firm_id(table, nullable=True)   # existing runs and calls stay platform-wide

    op.create_table('firm_jobs',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('firm_id', sa.UUID(), nullable=False),
    sa.Column('job_id', sa.UUID(), nullable=False),
    sa.Column('origin', sa.String(), nullable=False),
    sa.Column('search_id', sa.UUID(), nullable=True),
    sa.Column('captured_by_user_id', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("origin = 'CAPTURED' OR captured_by_user_id IS NULL", name='ck_firm_jobs_scraped_no_capturer'),
    sa.CheckConstraint("origin IN ('SCRAPED', 'CAPTURED')", name='ck_firm_jobs_origin'),
    sa.ForeignKeyConstraint(['captured_by_user_id'], ['users.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['firm_id'], ['firms.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['job_id'], ['jobs.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['search_id'], ['searches.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('firm_id', 'job_id', name='uq_firm_jobs_firm_job')
    )
    op.create_index(op.f('ix_firm_jobs_job_id'), 'firm_jobs', ['job_id'], unique=False)

    # Every job so far was found or captured for the one user the app had, now the Default firm. A job logged by
    # hand or saved from the extension is CAPTURED (by nobody we can name); everything else was scraped.
    op.execute(f"""
        INSERT INTO firm_jobs (firm_id, job_id, origin, search_id)
        SELECT '{DEFAULT_FIRM_ID}', id,
               CASE WHEN source IN ('manual', 'extension') THEN 'CAPTURED' ELSE 'SCRAPED' END,
               search_id
        FROM jobs
    """)


def downgrade() -> None:
    op.drop_index(op.f('ix_firm_jobs_job_id'), table_name='firm_jobs')
    op.drop_table('firm_jobs')
    for table in REQUIRED + OPTIONAL:
        op.drop_constraint(f'{table}_firm_id_fkey', table, type_='foreignkey')
        op.drop_index(op.f(f'ix_{table}_firm_id'), table_name=table)
        op.drop_column(table, 'firm_id')
