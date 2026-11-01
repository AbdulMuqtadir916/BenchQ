"""candidate_gmail_oauth

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-31
"""
from alembic import op
import sqlalchemy as sa


revision = "0009"
down_revision = "0008"
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


def downgrade() -> None:
    bind = op.get_bind()
    if bind.execute(sa.text("SELECT count(*) FROM candidate_mailboxes WHERE refresh_token_ciphertext IS NOT NULL")).scalar():
        raise RuntimeError("Disconnect candidate mailboxes before downgrading 0009; this migration stores live credentials.")
    op.drop_index("ix_candidate_google_oauth_attempts_candidate_id", table_name="candidate_google_oauth_attempts")
    op.drop_index("ix_candidate_google_oauth_attempts_firm_id", table_name="candidate_google_oauth_attempts")
    op.drop_table("candidate_google_oauth_attempts")
    op.drop_column("candidate_mailboxes", "last_sync_error")
    op.drop_column("candidate_mailboxes", "initial_sync_complete")
    op.drop_column("candidate_mailboxes", "history_id")
    op.drop_column("candidate_mailboxes", "refresh_token_ciphertext")
