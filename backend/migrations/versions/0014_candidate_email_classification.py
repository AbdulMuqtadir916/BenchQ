"""Versioned candidate email evidence and lean processing state; no status backfill.

Revision ID: 0014
Revises: 0013
"""
from alembic import op
import sqlalchemy as sa

revision = '0014'
down_revision = '0013'
branch_labels = None
depends_on = None


def upgrade():
    columns = [
        sa.Column('classification_state', sa.String(16), nullable=False, server_default='NOT_QUEUED'),
        sa.Column('classification_attempts', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('classification_version', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('content_revision', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('classification_token', sa.UUID(), nullable=True),
        sa.Column('classification_lease_until', sa.DateTime(timezone=True), nullable=True),
        sa.Column('classification_next_retry_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('classification_error', sa.String(64), nullable=True),
        sa.Column('sender_auth_result', sa.String(8), nullable=False, server_default='UNKNOWN'),
        sa.Column('receive_time_verified', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('hidden_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('other_purge_after', sa.DateTime(timezone=True), nullable=True),
    ]
    for col in columns:
        op.add_column('inbox_messages', col)
    op.create_check_constraint('ck_inbox_classification_state', 'inbox_messages', "classification_state IN ('NOT_QUEUED','PENDING','PROCESSING','DONE','ERROR','EXCLUDED')")
    op.create_check_constraint('ck_inbox_sender_auth', 'inbox_messages', "sender_auth_result IN ('PASS','FAIL','UNKNOWN')")
    op.create_index('ix_inbox_classification_queue', 'inbox_messages', ['classification_state', 'classification_next_retry_at'])
    op.create_table('email_classifications',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('firm_id', sa.UUID(), nullable=False),
        sa.Column('candidate_id', sa.UUID(), nullable=False),
        sa.Column('inbox_message_id', sa.UUID(), nullable=False),
        sa.Column('application_id', sa.UUID(), nullable=True),
        sa.Column('application_revision', sa.Integer(), nullable=True),
        sa.Column('result_version', sa.Integer(), nullable=False),
        sa.Column('content_revision', sa.Integer(), nullable=False),
        sa.Column('category', sa.String(40), nullable=False),
        sa.Column('confidence', sa.Float(), nullable=False),
        sa.Column('probabilities', sa.JSON(), nullable=False),
        sa.Column('model', sa.String(120), nullable=False),
        sa.Column('provider', sa.String(80), nullable=False),
        sa.Column('prompt_version', sa.String(64), nullable=False),
        sa.Column('category_version', sa.String(40), nullable=False),
        sa.Column('sender_auth_result', sa.String(8), nullable=False),
        sa.Column('receive_time_verified', sa.Boolean(), nullable=False),
        sa.Column('outcome', sa.String(24), nullable=False),
        sa.Column('reason', sa.String(64), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['firm_id'], ['firms.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['candidate_id'], ['candidates.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['inbox_message_id'], ['inbox_messages.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['application_id'], ['applications.id'], ondelete='RESTRICT'),
        sa.UniqueConstraint('inbox_message_id', 'result_version', name='uq_email_result_version'),
        sa.CheckConstraint("category IN ('applied','screening_call','shortlisted','interview_schedule_request','interview_scheduled','assessment','offer','move_on','incomplete_application','other')", name='ck_email_category'),
        sa.CheckConstraint("confidence >= 0 AND confidence <= 1 AND confidence != 'NaN'::float", name='ck_email_confidence'),
        sa.CheckConstraint("sender_auth_result IN ('PASS','FAIL','UNKNOWN')", name='ck_email_sender_auth'),
        sa.CheckConstraint("outcome IN ('REVIEW','OTHER','NO_CHANGE')", name='ck_email_outcome'),
    )
    op.create_index('ix_email_classifications_firm_id', 'email_classifications', ['firm_id'])
    op.create_index('ix_email_results_scope', 'email_classifications', ['firm_id', 'candidate_id', 'created_at'])
    op.execute("""CREATE FUNCTION protect_email_classification() RETURNS trigger AS $$
    BEGIN
      IF TG_OP = 'UPDATE' OR EXISTS (SELECT 1 FROM inbox_messages WHERE id=OLD.inbox_message_id AND deleted_at IS NULL) THEN
        RAISE EXCEPTION 'Classification evidence is immutable until explicit content erasure';
      END IF;
      RETURN OLD;
    END; $$ LANGUAGE plpgsql""")
    op.execute("CREATE TRIGGER protect_email_result BEFORE UPDATE OR DELETE ON email_classifications FOR EACH ROW EXECUTE FUNCTION protect_email_classification()")
    op.alter_column('application_reviews', 'application_id', nullable=True)
    op.alter_column('application_reviews', 'application_revision', nullable=True)
    op.add_column('application_reviews', sa.Column('classification_id', sa.UUID(), nullable=True))
    op.add_column('application_reviews', sa.Column('classification_version', sa.Integer(), nullable=True))
    op.drop_constraint('uq_application_reviews_email', 'application_reviews', type_='unique')
    op.create_index('uq_application_reviews_email', 'application_reviews', ['application_id','inbox_message_id'], unique=True, postgresql_where=sa.text('classification_version IS NULL'))
    op.create_unique_constraint('uq_review_result_version', 'application_reviews', ['inbox_message_id','classification_version'])
    op.create_index('uq_pending_classified_email', 'application_reviews', ['inbox_message_id'], unique=True, postgresql_where=sa.text("state = 'PENDING' AND classification_version IS NOT NULL"))
    op.create_foreign_key('fk_review_classification', 'application_reviews', 'email_classifications', ['classification_id'], ['id'], ondelete='SET NULL')
    op.create_check_constraint('ck_review_match_revision', 'application_reviews', '(application_id IS NULL) = (application_revision IS NULL)')
    op.create_index('uq_unmatched_review_email', 'application_reviews', ['inbox_message_id'], unique=True, postgresql_where=sa.text('application_id IS NULL AND classification_version IS NULL'))


def downgrade():
    connection = op.get_bind()
    # Preserve completed evidence, private retention and unmatched/human work.
    unsafe = connection.execute(sa.text("SELECT EXISTS (SELECT 1 FROM email_classifications) OR EXISTS (SELECT 1 FROM application_reviews WHERE application_id IS NULL OR classification_id IS NOT NULL OR classification_version IS NOT NULL) OR EXISTS (SELECT 1 FROM inbox_messages WHERE classification_state != 'NOT_QUEUED' OR classification_attempts != 0 OR hidden_at IS NOT NULL OR content_revision != 0 OR sender_auth_result != 'UNKNOWN')")).scalar()
    if unsafe:
        raise RuntimeError('Refusing to discard email classification, retention or review evidence.')
    op.drop_index('uq_unmatched_review_email', table_name='application_reviews')
    op.drop_constraint('ck_review_match_revision', 'application_reviews', type_='check')
    op.drop_constraint('fk_review_classification', 'application_reviews', type_='foreignkey')
    op.drop_column('application_reviews', 'classification_id')
    op.drop_index('uq_pending_classified_email', table_name='application_reviews')
    op.drop_constraint('uq_review_result_version', 'application_reviews', type_='unique')
    op.drop_index('uq_application_reviews_email', table_name='application_reviews')
    op.create_unique_constraint('uq_application_reviews_email', 'application_reviews', ['application_id','inbox_message_id'])
    op.drop_column('application_reviews', 'classification_version')
    op.alter_column('application_reviews', 'application_revision', nullable=False)
    op.alter_column('application_reviews', 'application_id', nullable=False)
    op.execute('DROP TRIGGER protect_email_result ON email_classifications')
    op.execute('DROP FUNCTION protect_email_classification()')
    op.drop_index('ix_email_results_scope', table_name='email_classifications')
    op.drop_index('ix_email_classifications_firm_id', table_name='email_classifications')
    op.drop_table('email_classifications')
    op.drop_index('ix_inbox_classification_queue', table_name='inbox_messages')
    op.drop_constraint('ck_inbox_sender_auth', 'inbox_messages', type_='check')
    op.drop_constraint('ck_inbox_classification_state', 'inbox_messages', type_='check')
    for name in ('other_purge_after', 'hidden_at', 'receive_time_verified', 'sender_auth_result', 'classification_error', 'classification_next_retry_at', 'classification_lease_until', 'classification_token', 'content_revision', 'classification_version', 'classification_attempts', 'classification_state'):
        op.drop_column('inbox_messages', name)
