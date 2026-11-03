"""Extensible in-app notifications and the approved password-recovery request workflow (07 Q54)."""
from sqlalchemy import (
    Boolean, CheckConstraint, Column, DateTime, ForeignKey, Index, String, Text, UniqueConstraint, text,
)
from sqlalchemy.dialects.postgresql import UUID

from backend.models.db import Base, utcnow
from backend.models.tenancy import SHA256_HEX, _created_at, _pk, _restrict, _updated_at


class PasswordResetRequest(Base):
    """A firm user's pending approval, frozen-password window, and one-use reset credential."""
    __tablename__ = "password_reset_requests"

    id = _pk()
    firm_id = Column(UUID(as_uuid=True), _restrict("firms.id"), nullable=False, index=True)
    requester_user_id = Column(UUID(as_uuid=True), _restrict("users.id"), nullable=False, index=True)
    requester_role = Column(String(16), nullable=False)
    approver_role = Column(String(16), nullable=False)
    # A firm approver is exact; platform approval is broadcast to active Super Admins through notifications.
    approver_user_id = Column(UUID(as_uuid=True), _restrict("users.id"), nullable=True, index=True)
    is_platform_approval = Column(Boolean, nullable=False, server_default=text("false"))
    status = Column(String(16), nullable=False, server_default=text("'PENDING'"))
    expires_at = Column(DateTime(timezone=True), nullable=False)
    decided_at = Column(DateTime(timezone=True), nullable=True)
    decided_by_user_id = Column(UUID(as_uuid=True), _restrict("users.id"), nullable=True)
    decided_by_platform_user_id = Column(UUID(as_uuid=True), _restrict("platform_users.id"), nullable=True)
    reset_token_hash = Column(String(64), nullable=True)
    reset_token_expires_at = Column(DateTime(timezone=True), nullable=True)
    reset_token_consumed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = _created_at()
    updated_at = _updated_at()

    __table_args__ = (
        CheckConstraint("status IN ('PENDING', 'APPROVED', 'DENIED', 'EXPIRED', 'COMPLETED', 'CANCELLED')",
                        name="ck_password_reset_requests_status"),
        CheckConstraint("requester_role IN ('OWNER', 'MANAGER', 'BDE', 'VIEWER')",
                        name="ck_password_reset_requests_requester_role"),
        CheckConstraint("approver_role IN ('OWNER', 'MANAGER', 'PLATFORM_ADMIN')",
                        name="ck_password_reset_requests_approver_role"),
        CheckConstraint("expires_at > created_at", name="ck_password_reset_requests_expiry_after_creation"),
        CheckConstraint("(is_platform_approval AND approver_user_id IS NULL AND approver_role = 'PLATFORM_ADMIN') OR "
                        "(NOT is_platform_approval AND approver_user_id IS NOT NULL AND approver_role IN ('OWNER', 'MANAGER'))",
                        name="ck_password_reset_requests_approver_kind"),
        CheckConstraint("num_nonnulls(decided_by_user_id, decided_by_platform_user_id) <= 1",
                        name="ck_password_reset_requests_one_decider"),
        CheckConstraint("(decided_at IS NULL) = (num_nonnulls(decided_by_user_id, decided_by_platform_user_id) = 0)",
                        name="ck_password_reset_requests_decision_actor"),
        CheckConstraint("(reset_token_hash IS NULL AND reset_token_expires_at IS NULL) OR "
                        "(reset_token_hash IS NOT NULL AND reset_token_expires_at IS NOT NULL)",
                        name="ck_password_reset_requests_token_fields"),
        CheckConstraint("reset_token_hash IS NULL OR reset_token_hash ~ '^[0-9a-f]{64}$'",
                        name="ck_password_reset_requests_token_hash_sha256"),
        UniqueConstraint("reset_token_hash", name="uq_password_reset_requests_token_hash"),
        Index("uq_password_reset_requests_one_open_per_user", "requester_user_id", unique=True,
              postgresql_where=text("status IN ('PENDING', 'APPROVED')")),
        Index("ix_password_reset_requests_expiry", "expires_at"),
    )


class Notification(Base):
    """An in-app notification for one account; entity_type makes the inbox extensible."""
    __tablename__ = "notifications"

    id = _pk()
    firm_id = Column(UUID(as_uuid=True), _restrict("firms.id"), nullable=True, index=True)
    user_id = Column(UUID(as_uuid=True), _restrict("users.id"), nullable=True, index=True)
    platform_user_id = Column(UUID(as_uuid=True), _restrict("platform_users.id"), nullable=True, index=True)
    type = Column(String(80), nullable=False)
    entity_id = Column(String(80), nullable=False)
    title = Column(String(200), nullable=False)
    detail = Column(Text, nullable=False)
    read_at = Column(DateTime(timezone=True), nullable=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    created_at = _created_at()
    updated_at = _updated_at()

    __table_args__ = (
        CheckConstraint("num_nonnulls(user_id, platform_user_id) = 1", name="ck_notifications_one_recipient"),
        CheckConstraint("(user_id IS NOT NULL) = (firm_id IS NOT NULL)", name="ck_notifications_firm_recipient"),
        CheckConstraint("char_length(btrim(type)) > 0", name="ck_notifications_type_nonempty"),
        CheckConstraint("char_length(btrim(entity_id)) > 0", name="ck_notifications_entity_id_nonempty"),
        Index("ix_notifications_user_unread", "user_id", "created_at",
              postgresql_where=text("user_id IS NOT NULL AND read_at IS NULL")),
        Index("ix_notifications_platform_unread", "platform_user_id", "created_at",
              postgresql_where=text("platform_user_id IS NOT NULL AND read_at IS NULL")),
    )
