"""In-app notifications and firm password-reset approval requests (07 Q54)."""
from alembic import op
import sqlalchemy as sa


revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "password_reset_requests",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("firm_id", sa.UUID(), nullable=False),
        sa.Column("requester_user_id", sa.UUID(), nullable=False),
        sa.Column("requester_role", sa.String(length=16), nullable=False),
        sa.Column("approver_role", sa.String(length=16), nullable=False),
        sa.Column("approver_user_id", sa.UUID(), nullable=True),
        sa.Column("is_platform_approval", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("status", sa.String(length=16), server_default=sa.text("'PENDING'"), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decided_by_user_id", sa.UUID(), nullable=True),
        sa.Column("decided_by_platform_user_id", sa.UUID(), nullable=True),
        sa.Column("reset_token_hash", sa.String(length=64), nullable=True),
        sa.Column("reset_token_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reset_token_consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("status IN ('PENDING', 'APPROVED', 'DENIED', 'EXPIRED', 'COMPLETED', 'CANCELLED')",
                           name="ck_password_reset_requests_status"),
        sa.CheckConstraint("requester_role IN ('OWNER', 'MANAGER', 'BDE', 'VIEWER')",
                           name="ck_password_reset_requests_requester_role"),
        sa.CheckConstraint("approver_role IN ('OWNER', 'MANAGER', 'PLATFORM_ADMIN')",
                           name="ck_password_reset_requests_approver_role"),
        sa.CheckConstraint("expires_at > created_at", name="ck_password_reset_requests_expiry_after_creation"),
        sa.CheckConstraint("(is_platform_approval AND approver_user_id IS NULL AND approver_role = 'PLATFORM_ADMIN') OR "
                           "(NOT is_platform_approval AND approver_user_id IS NOT NULL AND approver_role IN ('OWNER', 'MANAGER'))",
                           name="ck_password_reset_requests_approver_kind"),
        sa.CheckConstraint("num_nonnulls(decided_by_user_id, decided_by_platform_user_id) <= 1",
                           name="ck_password_reset_requests_one_decider"),
        sa.CheckConstraint("(decided_at IS NULL) = "
                           "(num_nonnulls(decided_by_user_id, decided_by_platform_user_id) = 0)",
                           name="ck_password_reset_requests_decision_actor"),
        sa.CheckConstraint("(reset_token_hash IS NULL AND reset_token_expires_at IS NULL) OR "
                           "(reset_token_hash IS NOT NULL AND reset_token_expires_at IS NOT NULL)",
                           name="ck_password_reset_requests_token_fields"),
        sa.CheckConstraint("reset_token_hash IS NULL OR reset_token_hash ~ '^[0-9a-f]{64}$'",
                           name="ck_password_reset_requests_token_hash_sha256"),
        sa.ForeignKeyConstraint(["firm_id"], ["firms.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["requester_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["approver_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["decided_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["decided_by_platform_user_id"], ["platform_users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("reset_token_hash", name="uq_password_reset_requests_token_hash"),
    )
    op.create_index("ix_password_reset_requests_firm_id", "password_reset_requests", ["firm_id"])
    op.create_index("ix_password_reset_requests_requester_user_id", "password_reset_requests", ["requester_user_id"])
    op.create_index("ix_password_reset_requests_approver_user_id", "password_reset_requests", ["approver_user_id"])
    op.create_index("ix_password_reset_requests_expiry", "password_reset_requests", ["expires_at"])
    op.create_index("uq_password_reset_requests_one_open_per_user", "password_reset_requests",
                    ["requester_user_id"], unique=True,
                    postgresql_where=sa.text("status IN ('PENDING', 'APPROVED')"))

    op.create_table(
        "notifications",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("firm_id", sa.UUID(), nullable=True),
        sa.Column("user_id", sa.UUID(), nullable=True),
        sa.Column("platform_user_id", sa.UUID(), nullable=True),
        sa.Column("type", sa.String(length=80), nullable=False),
        sa.Column("entity_id", sa.String(length=80), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("detail", sa.Text(), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("num_nonnulls(user_id, platform_user_id) = 1", name="ck_notifications_one_recipient"),
        sa.CheckConstraint("(user_id IS NOT NULL) = (firm_id IS NOT NULL)", name="ck_notifications_firm_recipient"),
        sa.CheckConstraint("char_length(btrim(type)) > 0", name="ck_notifications_type_nonempty"),
        sa.CheckConstraint("char_length(btrim(entity_id)) > 0", name="ck_notifications_entity_id_nonempty"),
        sa.ForeignKeyConstraint(["firm_id"], ["firms.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["platform_user_id"], ["platform_users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_notifications_firm_id", "notifications", ["firm_id"])
    op.create_index("ix_notifications_user_id", "notifications", ["user_id"])
    op.create_index("ix_notifications_platform_user_id", "notifications", ["platform_user_id"])
    op.create_index("ix_notifications_user_unread", "notifications", ["user_id", "created_at"],
                    postgresql_where=sa.text("user_id IS NOT NULL AND read_at IS NULL"))
    op.create_index("ix_notifications_platform_unread", "notifications", ["platform_user_id", "created_at"],
                    postgresql_where=sa.text("platform_user_id IS NOT NULL AND read_at IS NULL"))


def downgrade() -> None:
    op.drop_table("notifications")
    op.drop_table("password_reset_requests")
