"""Reading and seeding the Super Admin's AI setup (backend/models/ai_presets.py). No request or provider code here."""
import logging

from sqlalchemy import text

from backend.ai.secrets import AiSecretError, decrypt_key, encrypt_key
from backend.models.ai_presets import AiModel, AiPreset, AiPresetVersion, AiProvider

logger = logging.getLogger("benchq.ai")

_SEED_LOCK = 2026_11_22_32


def provider_row(db) -> AiProvider | None:
    return db.get(AiProvider, 1)


def shared_key(db) -> str:
    """The one API key, decrypted, or "" when none is set. A wrong server secret logs its name and reads as no key, so a
    call fails as "not set up" and no other credential is tried."""
    row = provider_row(db)
    if row is None or not row.api_key_encrypted:
        return ""
    try:
        return decrypt_key(row.api_key_encrypted)
    except AiSecretError as error:
        logger.error("AI key unreadable: %s", error)
        return ""


def store_key(row: AiProvider, key: str) -> None:
    row.api_key_encrypted = encrypt_key(key)
    row.key_last4 = key[-4:]


def latest_version(db, preset_id) -> AiPresetVersion | None:
    return (db.query(AiPresetVersion).filter(AiPresetVersion.preset_id == preset_id)
            .order_by(AiPresetVersion.version.desc()).first())


def active_preset(db, module: str) -> tuple[AiPreset, AiPresetVersion] | None:
    preset = db.query(AiPreset).filter(AiPreset.module == module, AiPreset.is_active.is_(True)).first()
    if preset is None:
        return None
    version = latest_version(db, preset.id)
    return (preset, version) if version is not None else None


def label_for(model_id: str) -> str:
    return model_id.split("/", 1)[-1]


def seed_defaults(db) -> None:
    """The provider row, the default models and each use case's first preset, where missing (a new database; migration
    0032 fills an existing one from its settings first). Idempotent, under a lock, so every worker may run it."""
    from backend.ai.modules import PRESET_MODULES
    db.execute(text("SELECT pg_advisory_xact_lock(:lock)"), {"lock": _SEED_LOCK})
    if provider_row(db) is None:
        db.add(AiProvider(id=1, provider="openrouter"))
    known = {row.model_id for row in db.query(AiModel.model_id)}
    for module in PRESET_MODULES.values():
        if module.default_model not in known:
            db.add(AiModel(model_id=module.default_model, label=label_for(module.default_model)))
            known.add(module.default_model)
        if db.query(AiPreset.id).filter(AiPreset.module == module.key).first() is None:
            preset = AiPreset(module=module.key, name="Preset 1", notes="The setup BenchQ started with.", is_active=True)
            db.add(preset)
            db.flush()
            db.add(AiPresetVersion(preset_id=preset.id, version=1, model_id=module.default_model, effort="",
                                   prompts=dict(module.prompts)))
    db.commit()
