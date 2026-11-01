"""Candidate Gmail connection and retained account identity.

Revision ID: 0010
Revises: 0009
"""
from alembic import op
import sqlalchemy as sa

revision = '0010'
down_revision = '0009'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("candidate_mailboxes", sa.Column("refresh_token_ciphertext", sa.LargeBinary(), nullable=True))
    op.add_column("candidate_mailboxes", sa.Column("history_id", sa.String(), nullable=True))
    op.add_column("candidate_mailboxes", sa.Column("initial_sync_complete", sa.Boolean(), server_default=sa.text("false"), nullable=False))
    op.add_column("candidate_mailboxes", sa.Column("last_sync_error", sa.Text(), nullable=True))
    op.create_table(
        "candidate_google_oauth_attempts",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("state_hash", sa.String(length=64), nullable=False),
        sa.Column("firm_id", sa.UUID(), nullable=False),
        sa.Column("candidate_id", sa.UUID(), nullable=False),
        sa.Column("initiated_by_user_id", sa.UUID(), nullable=False),
        sa.Column("code_verifier_ciphertext", sa.LargeBinary(), nullable=False),
        sa.Column("return_to", sa.String(length=500), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["candidate_id"], ["candidates.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["firm_id"], ["firms.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["initiated_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("state_hash", name="uq_candidate_google_oauth_state_hash"),
    )
    op.create_index("ix_candidate_google_oauth_attempts_firm_id", "candidate_google_oauth_attempts", ["firm_id"])
    op.create_index("ix_candidate_google_oauth_attempts_candidate_id", "candidate_google_oauth_attempts", ["candidate_id"])
    op.add_column('inbox_messages', sa.Column('source_address', sa.String(), nullable=False, server_default=''))
    op.execute("UPDATE inbox_messages AS m SET source_address = lower(trim(b.address)) "
               "FROM candidate_mailboxes AS b WHERE b.id = m.mailbox_id")
    op.drop_constraint('uq_inbox_messages_mailbox_message', 'inbox_messages', type_='unique')
    op.create_unique_constraint('uq_inbox_messages_mailbox_message', 'inbox_messages',
                                ['mailbox_id', 'source_address', 'provider_message_id'])


def downgrade() -> None:
    if op.get_bind().execute(sa.text("SELECT EXISTS (SELECT 1 FROM candidate_google_oauth_attempts "
            "WHERE consumed_at IS NULL AND expires_at > now())")).scalar():
        raise RuntimeError("Wait for active OAuth attempts to expire before downgrading 0010.")
    if op.get_bind().execute(sa.text("SELECT EXISTS (SELECT 1 FROM inbox_messages m "
            "JOIN candidate_mailboxes b ON b.id=m.mailbox_id "
            "WHERE m.source_address NOT IN ('', lower(trim(b.address)))) "
            "OR EXISTS (SELECT 1 FROM inbox_messages GROUP BY mailbox_id, provider_message_id HAVING count(*) > 1)")).scalar():
        raise RuntimeError('Keep revision 0010 to preserve retained mailbox account provenance.')
    op.drop_constraint('uq_inbox_messages_mailbox_message', 'inbox_messages', type_='unique')
    op.create_unique_constraint('uq_inbox_messages_mailbox_message', 'inbox_messages',
                                ['mailbox_id', 'provider_message_id'])
    op.drop_column('inbox_messages', 'source_address')
    bind = op.get_bind()
    if bind.execute(sa.text("SELECT count(*) FROM candidate_mailboxes WHERE refresh_token_ciphertext IS NOT NULL")).scalar():
        raise RuntimeError("Disconnect candidate mailboxes before downgrading 0010; this migration stores live credentials.")
    op.drop_index("ix_candidate_google_oauth_attempts_candidate_id", table_name="candidate_google_oauth_attempts")
    op.drop_index("ix_candidate_google_oauth_attempts_firm_id", table_name="candidate_google_oauth_attempts")
    op.drop_table("candidate_google_oauth_attempts")
    op.drop_column("candidate_mailboxes", "last_sync_error")
    op.drop_column("candidate_mailboxes", "initial_sync_complete")
    op.drop_column("candidate_mailboxes", "history_id")
    op.drop_column("candidate_mailboxes", "refresh_token_ciphertext")
