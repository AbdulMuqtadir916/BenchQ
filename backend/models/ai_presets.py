"""The Super Admin's AI setup (docs/integration/08-ai-presets.md, migration 0032): one provider with one encrypted key, a
catalog of approved models, and per use case its presets, of which one is active. Platform data: no firm owns a row."""
import uuid

from sqlalchemy import (Boolean, CheckConstraint, Column, DateTime, ForeignKey, Index, Integer, LargeBinary, SmallInteger,
                        String, Text, UniqueConstraint, text)
from sqlalchemy.dialects.postgresql import JSONB, UUID

from backend.models.db import Base, utcnow


class AiProvider(Base):
    """The one provider every AI call uses. `api_key_encrypted` is Fernet ciphertext; only the last 4 characters are
    ever shown."""
    __tablename__ = "ai_provider"
    __table_args__ = (CheckConstraint("id = 1", name="ck_ai_provider_one_row"),
                      CheckConstraint("provider IN ('openrouter')", name="ck_ai_provider_supported"),)

    id = Column(SmallInteger, primary_key=True, autoincrement=False, default=1)
    provider = Column(String, nullable=False, default="openrouter", server_default="openrouter")
    api_key_encrypted = Column(LargeBinary, nullable=True)
    key_last4 = Column(String(4), nullable=True)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=utcnow, server_default=text("now()"))
    updated_by_id = Column(UUID(as_uuid=True), ForeignKey("platform_users.id", ondelete="SET NULL"), nullable=True)


class AiModel(Base):
    """A model a Super Admin approved. Hidden ones stay so old presets and runs keep their name (08 Q15)."""
    __tablename__ = "ai_models"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    model_id = Column(String, nullable=False, unique=True)
    label = Column(String, nullable=False)
    is_hidden = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    created_at = Column(DateTime(timezone=True), nullable=False, default=utcnow, server_default=text("now()"))


class AiPreset(Base):
    """One way of running one AI use case. At most one is active per use case (08 Q4)."""
    __tablename__ = "ai_presets"
    __table_args__ = (
        UniqueConstraint("module", "name", name="uq_ai_presets_module_name"),
        CheckConstraint("NOT (is_active AND archived_at IS NOT NULL)", name="ck_ai_presets_active_not_archived"),
        Index("uq_ai_presets_one_active", "module", unique=True, postgresql_where=text("is_active")),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    module = Column(String, nullable=False)
    name = Column(String(120), nullable=False)
    notes = Column(Text, nullable=False, default="", server_default="")
    is_active = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    archived_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utcnow, server_default=text("now()"))


class AiPresetVersion(Base):
    """A preset as it stood after one save: never edited (08 Q5). A run records the version it used."""
    __tablename__ = "ai_preset_versions"
    __table_args__ = (UniqueConstraint("preset_id", "version", name="uq_ai_preset_versions_preset_version"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    preset_id = Column(UUID(as_uuid=True), ForeignKey("ai_presets.id", ondelete="RESTRICT"), nullable=False)
    version = Column(Integer, nullable=False)
    model_id = Column(String, nullable=False)
    effort = Column(String, nullable=False, default="", server_default="")
    prompts = Column(JSONB, nullable=False, default=dict)
    created_by_id = Column(UUID(as_uuid=True), ForeignKey("platform_users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utcnow, server_default=text("now()"))
