"""email classification results and queue state

Revision ID: 0010
Revises: 0009
Create Date: 2026-10-31
"""
from alembic import op
import sqlalchemy as sa

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("inbox_messages", sa.Column("classification_state", sa.String(length=16),
                                               server_default=sa.text("'PENDING'"), nullable=False))
    op.add_column("inbox_messages", sa.Column("classification_attempts", sa.Integer(),
                                               server_default=sa.text("0"), nullable=False))
    op.add_column("inbox_messages", sa.Column("classification_lease_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("inbox_messages", sa.Column("classification_error", sa.Text(), nullable=True))
    op.create_check_constraint("ck_inbox_messages_classification_state", "inbox_messages",
                               "classification_state IN ('PENDING', 'PROCESSING', 'DONE', 'ERROR')")
    op.create_index("ix_inbox_messages_classification_queue", "inbox_messages",
                    ["classification_state", "received_at"])
    op.create_table(
        "email_classifications",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("firm_id", sa.UUID(), nullable=False),
        sa.Column("candidate_id", sa.UUID(), nullable=False),
        sa.Column("inbox_message_id", sa.UUID(), nullable=False),
        sa.Column("application_id", sa.UUID(), nullable=True),
        sa.Column("category", sa.String(length=40), nullable=False),
        sa.Column("probabilities", sa.JSON(), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("model", sa.String(length=120), nullable=False),
        sa.Column("category_version", sa.String(length=40), nullable=False),
        sa.Column("provider", sa.String(length=80), nullable=True),
        sa.Column("provider_request_id", sa.String(length=160), nullable=True),
        sa.Column("outcome", sa.String(length=24), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("category IN ('applied', 'screening_call', 'interview_schedule_request', 'interview_scheduled', 'offer', 'shortlisted', 'move_on', 'incomplete_application', 'assessment', 'other')",
                           name="ck_email_classifications_category"),
        sa.CheckConstraint("confidence >= 0 AND confidence <= 1", name="ck_email_classifications_confidence"),
        sa.CheckConstraint("outcome IN ('UNMATCHED', 'REVIEW', 'AUTO_APPLIED', 'NO_CHANGE')",
                           name="ck_email_classifications_outcome"),
        sa.ForeignKeyConstraint(["firm_id"], ["firms.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["candidate_id"], ["candidates.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["inbox_message_id"], ["inbox_messages.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["application_id"], ["applications.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("inbox_message_id", name="uq_email_classifications_message"),
    )
    op.create_index("ix_email_classifications_firm_id", "email_classifications", ["firm_id"])
    op.create_index("ix_email_classifications_firm_candidate", "email_classifications",
                    ["firm_id", "candidate_id", "created_at"])
    op.add_column("application_reviews", sa.Column("classification_id", sa.UUID(), nullable=True))
    op.create_foreign_key("fk_application_reviews_classification_id_email_classifications",
                          "application_reviews", "email_classifications", ["classification_id"], ["id"],
                          ondelete="RESTRICT")


def downgrade() -> None:
    bind = op.get_bind()
    if bind.execute(sa.text("SELECT count(*) FROM email_classifications")).scalar():
        raise RuntimeError("Export/preserve classifier decisions before downgrading 0010.")
    op.drop_constraint("fk_application_reviews_classification_id_email_classifications",
                       "application_reviews", type_="foreignkey")
    op.drop_column("application_reviews", "classification_id")
    op.drop_index("ix_email_classifications_firm_candidate", table_name="email_classifications")
    op.drop_index("ix_email_classifications_firm_id", table_name="email_classifications")
    op.drop_table("email_classifications")
    op.drop_index("ix_inbox_messages_classification_queue", table_name="inbox_messages")
    op.drop_constraint("ck_inbox_messages_classification_state", "inbox_messages", type_="check")
    op.drop_column("inbox_messages", "classification_error")
    op.drop_column("inbox_messages", "classification_lease_at")
    op.drop_column("inbox_messages", "classification_attempts")
    op.drop_column("inbox_messages", "classification_state")
