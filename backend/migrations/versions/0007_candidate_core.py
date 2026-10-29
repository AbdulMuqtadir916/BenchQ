"""The candidate core tables (docs/team/00-candidate-core.md; 07 Q53)

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-29 03:56:10.582314

Everything a candidate has, fixed before the team splits up (docs/team/README.md):
- `searches.candidate_id` and `candidate_jobs`: each candidate's own searches and the jobs found for them (Q53b).
- `favorite_jobs`: per candidate, marked by a BDE (Q53c).
- `applications.candidate_id`, `resume_id` (the tailored résumé sent), `submitted_by_user_id`; one per candidate per
  job (Q53d).
- `resumes.candidate_id`, `resume_parse_id`; one base résumé per candidate (Q53e).
- `candidate_mailboxes`, `inbox_messages`: the candidate's own mailbox, each email linked to its application (Q53f).
- `evidence`, `claims`: the database refuses a VERIFIED claim without evidence (D4, Q53g).
- `ledger_entries.candidate_id`, backfilled from entries about a candidate (Q53h).

Rows from before this migration keep a null candidate where they have none; the routes require it from now on.
"""
from alembic import op
import sqlalchemy as sa


revision = '0007'
down_revision = '0006'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('candidate_mailboxes',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('firm_id', sa.UUID(), nullable=False),
    sa.Column('candidate_id', sa.UUID(), nullable=False),
    sa.Column('provider', sa.String(), server_default=sa.text("'GOOGLE'"), nullable=False),
    sa.Column('address', sa.String(), nullable=False),
    sa.Column('status', sa.String(), server_default=sa.text("'CONNECTED'"), nullable=False),
    sa.Column('connected_by_user_id', sa.UUID(), nullable=False),
    sa.Column('connected_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('last_synced_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("provider IN ('GOOGLE')", name='ck_candidate_mailboxes_provider'),
    sa.CheckConstraint("status IN ('CONNECTED', 'DISCONNECTED', 'ERROR')", name='ck_candidate_mailboxes_status'),
    sa.ForeignKeyConstraint(['candidate_id'], ['candidates.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['connected_by_user_id'], ['users.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['firm_id'], ['firms.id'], ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('candidate_id')
    )
    op.create_index(op.f('ix_candidate_mailboxes_firm_id'), 'candidate_mailboxes', ['firm_id'], unique=False)
    op.create_table('evidence',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('firm_id', sa.UUID(), nullable=False),
    sa.Column('candidate_id', sa.UUID(), nullable=False),
    sa.Column('resume_parse_id', sa.UUID(), nullable=True),
    sa.Column('document_url', sa.String(), nullable=True),
    sa.Column('excerpt', sa.Text(), nullable=True),
    sa.Column('page_number', sa.Integer(), nullable=True),
    sa.Column('source', sa.String(), nullable=False),
    sa.Column('confirmed_by_user_id', sa.UUID(), nullable=True),
    sa.Column('confirmed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("source IN ('MANUAL', 'RESUME_UPLOAD', 'LINKEDIN_EXPORT', 'INTAKE_CALL', 'AI_EXTRACTED')", name='ck_evidence_source'),
    sa.ForeignKeyConstraint(['candidate_id'], ['candidates.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['confirmed_by_user_id'], ['users.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['firm_id'], ['firms.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['resume_parse_id'], ['resume_parses.id'], ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_evidence_candidate_id'), 'evidence', ['candidate_id'], unique=False)
    op.create_index(op.f('ix_evidence_firm_id'), 'evidence', ['firm_id'], unique=False)
    op.create_table('candidate_jobs',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('firm_id', sa.UUID(), nullable=False),
    sa.Column('candidate_id', sa.UUID(), nullable=False),
    sa.Column('job_id', sa.UUID(), nullable=False),
    sa.Column('search_id', sa.UUID(), nullable=True),
    sa.Column('match_score', sa.Integer(), nullable=True),
    sa.Column('found_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('match_score IS NULL OR match_score BETWEEN 0 AND 100', name='ck_candidate_jobs_match_score'),
    sa.ForeignKeyConstraint(['candidate_id'], ['candidates.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['firm_id'], ['firms.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['job_id'], ['jobs.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['search_id'], ['searches.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('candidate_id', 'job_id', name='uq_candidate_jobs_candidate_job')
    )
    op.create_index(op.f('ix_candidate_jobs_firm_id'), 'candidate_jobs', ['firm_id'], unique=False)
    op.create_index(op.f('ix_candidate_jobs_job_id'), 'candidate_jobs', ['job_id'], unique=False)
    op.create_table('claims',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('firm_id', sa.UUID(), nullable=False),
    sa.Column('candidate_id', sa.UUID(), nullable=False),
    sa.Column('entity_type', sa.String(), nullable=False),
    sa.Column('entity_ref', sa.String(), nullable=True),
    sa.Column('state', sa.String(), server_default=sa.text("'UNVERIFIED'"), nullable=False),
    sa.Column('text', sa.Text(), nullable=False),
    sa.Column('evidence_id', sa.UUID(), nullable=True),
    sa.Column('source', sa.String(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("entity_type IN ('summary', 'experience', 'skill', 'project', 'certificate', 'education')", name='ck_claims_entity_type'),
    sa.CheckConstraint("source IN ('MANUAL', 'RESUME_UPLOAD', 'LINKEDIN_EXPORT', 'INTAKE_CALL', 'AI_EXTRACTED')", name='ck_claims_source'),
    sa.CheckConstraint("state <> 'VERIFIED' OR evidence_id IS NOT NULL", name='ck_claims_verified_has_evidence'),
    sa.CheckConstraint("state IN ('VERIFIED', 'UNVERIFIED', 'CONTRADICTED')", name='ck_claims_state'),
    sa.ForeignKeyConstraint(['candidate_id'], ['candidates.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['evidence_id'], ['evidence.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['firm_id'], ['firms.id'], ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_claims_candidate_id'), 'claims', ['candidate_id'], unique=False)
    op.create_index(op.f('ix_claims_firm_id'), 'claims', ['firm_id'], unique=False)
    op.create_table('favorite_jobs',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('firm_id', sa.UUID(), nullable=False),
    sa.Column('candidate_id', sa.UUID(), nullable=False),
    sa.Column('job_id', sa.UUID(), nullable=False),
    sa.Column('marked_by_user_id', sa.UUID(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['candidate_id'], ['candidates.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['firm_id'], ['firms.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['job_id'], ['jobs.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['marked_by_user_id'], ['users.id'], ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('candidate_id', 'job_id', name='uq_favorite_jobs_candidate_job')
    )
    op.create_index(op.f('ix_favorite_jobs_firm_id'), 'favorite_jobs', ['firm_id'], unique=False)
    op.create_index(op.f('ix_favorite_jobs_job_id'), 'favorite_jobs', ['job_id'], unique=False)
    op.create_table('inbox_messages',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('firm_id', sa.UUID(), nullable=False),
    sa.Column('candidate_id', sa.UUID(), nullable=False),
    sa.Column('mailbox_id', sa.UUID(), nullable=False),
    sa.Column('application_id', sa.UUID(), nullable=True),
    sa.Column('provider_message_id', sa.String(), nullable=False),
    sa.Column('thread_id', sa.String(), nullable=True),
    sa.Column('from_name', sa.String(), nullable=False),
    sa.Column('from_email', sa.String(), nullable=False),
    sa.Column('subject', sa.String(), nullable=False),
    sa.Column('snippet', sa.Text(), nullable=False),
    sa.Column('body', sa.Text(), nullable=True),
    sa.Column('received_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('is_read', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['application_id'], ['applications.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['candidate_id'], ['candidates.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['firm_id'], ['firms.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['mailbox_id'], ['candidate_mailboxes.id'], ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('mailbox_id', 'provider_message_id', name='uq_inbox_messages_mailbox_message')
    )
    op.create_index(op.f('ix_inbox_messages_application_id'), 'inbox_messages', ['application_id'], unique=False)
    op.create_index('ix_inbox_messages_candidate_received', 'inbox_messages', ['firm_id', 'candidate_id', 'received_at'], unique=False)
    op.create_index(op.f('ix_inbox_messages_firm_id'), 'inbox_messages', ['firm_id'], unique=False)
    op.add_column('applications', sa.Column('candidate_id', sa.UUID(), nullable=True))
    op.add_column('applications', sa.Column('resume_id', sa.UUID(), nullable=True))
    op.add_column('applications', sa.Column('submitted_by_user_id', sa.UUID(), nullable=True))
    op.create_index(op.f('ix_applications_candidate_id'), 'applications', ['candidate_id'], unique=False)
    op.create_index('uq_applications_candidate_job', 'applications', ['candidate_id', 'job_id'], unique=True, postgresql_where=sa.text('candidate_id IS NOT NULL'))
    op.create_foreign_key('applications_submitted_by_user_id_fkey', 'applications', 'users', ['submitted_by_user_id'], ['id'], ondelete='RESTRICT')
    op.create_foreign_key('applications_candidate_id_fkey', 'applications', 'candidates', ['candidate_id'], ['id'], ondelete='RESTRICT')
    op.create_foreign_key('applications_resume_id_fkey', 'applications', 'resumes', ['resume_id'], ['id'], ondelete='SET NULL')
    op.add_column('ledger_entries', sa.Column('candidate_id', sa.UUID(), nullable=True))
    op.create_index('ix_ledger_entries_firm_candidate_created', 'ledger_entries', ['firm_id', 'candidate_id', 'created_at'], unique=False)
    # Entries already about a candidate get it, so the candidate's activity is complete from the start.
    op.execute(
        "UPDATE ledger_entries SET candidate_id = entity_id::uuid WHERE entity_type = 'candidate' "
        "AND entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'"
    )
    op.add_column('resumes', sa.Column('candidate_id', sa.UUID(), nullable=True))
    op.add_column('resumes', sa.Column('resume_parse_id', sa.UUID(), nullable=True))
    op.create_index(op.f('ix_resumes_candidate_id'), 'resumes', ['candidate_id'], unique=False)
    op.create_index('uq_resumes_one_base_per_candidate', 'resumes', ['candidate_id'], unique=True, postgresql_where=sa.text('is_base AND candidate_id IS NOT NULL'))
    op.create_foreign_key('resumes_resume_parse_id_fkey', 'resumes', 'resume_parses', ['resume_parse_id'], ['id'], ondelete='RESTRICT')
    op.create_foreign_key('resumes_candidate_id_fkey', 'resumes', 'candidates', ['candidate_id'], ['id'], ondelete='RESTRICT')
    op.add_column('searches', sa.Column('candidate_id', sa.UUID(), nullable=True))
    op.create_index(op.f('ix_searches_candidate_id'), 'searches', ['candidate_id'], unique=False)
    op.create_foreign_key('searches_candidate_id_fkey', 'searches', 'candidates', ['candidate_id'], ['id'], ondelete='RESTRICT')


def downgrade() -> None:
    op.drop_constraint('searches_candidate_id_fkey', 'searches', type_='foreignkey')
    op.drop_index(op.f('ix_searches_candidate_id'), table_name='searches')
    op.drop_column('searches', 'candidate_id')
    op.drop_constraint('resumes_candidate_id_fkey', 'resumes', type_='foreignkey')
    op.drop_constraint('resumes_resume_parse_id_fkey', 'resumes', type_='foreignkey')
    op.drop_index('uq_resumes_one_base_per_candidate', table_name='resumes', postgresql_where=sa.text('is_base AND candidate_id IS NOT NULL'))
    op.drop_index(op.f('ix_resumes_candidate_id'), table_name='resumes')
    op.drop_column('resumes', 'resume_parse_id')
    op.drop_column('resumes', 'candidate_id')
    op.drop_index('ix_ledger_entries_firm_candidate_created', table_name='ledger_entries')
    op.drop_column('ledger_entries', 'candidate_id')
    op.drop_constraint('applications_resume_id_fkey', 'applications', type_='foreignkey')
    op.drop_constraint('applications_candidate_id_fkey', 'applications', type_='foreignkey')
    op.drop_constraint('applications_submitted_by_user_id_fkey', 'applications', type_='foreignkey')
    op.drop_index('uq_applications_candidate_job', table_name='applications', postgresql_where=sa.text('candidate_id IS NOT NULL'))
    op.drop_index(op.f('ix_applications_candidate_id'), table_name='applications')
    op.drop_column('applications', 'submitted_by_user_id')
    op.drop_column('applications', 'resume_id')
    op.drop_column('applications', 'candidate_id')
    op.drop_index(op.f('ix_inbox_messages_firm_id'), table_name='inbox_messages')
    op.drop_index('ix_inbox_messages_candidate_received', table_name='inbox_messages')
    op.drop_index(op.f('ix_inbox_messages_application_id'), table_name='inbox_messages')
    op.drop_table('inbox_messages')
    op.drop_index(op.f('ix_favorite_jobs_job_id'), table_name='favorite_jobs')
    op.drop_index(op.f('ix_favorite_jobs_firm_id'), table_name='favorite_jobs')
    op.drop_table('favorite_jobs')
    op.drop_index(op.f('ix_claims_firm_id'), table_name='claims')
    op.drop_index(op.f('ix_claims_candidate_id'), table_name='claims')
    op.drop_table('claims')
    op.drop_index(op.f('ix_candidate_jobs_job_id'), table_name='candidate_jobs')
    op.drop_index(op.f('ix_candidate_jobs_firm_id'), table_name='candidate_jobs')
    op.drop_table('candidate_jobs')
    op.drop_index(op.f('ix_evidence_firm_id'), table_name='evidence')
    op.drop_index(op.f('ix_evidence_candidate_id'), table_name='evidence')
    op.drop_table('evidence')
    op.drop_index(op.f('ix_candidate_mailboxes_firm_id'), table_name='candidate_mailboxes')
    op.drop_table('candidate_mailboxes')
