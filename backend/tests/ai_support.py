"""The AI setup a test runs with: the seeded presets and a made-up shared key."""
from backend.ai import store
from backend.models.ai_presets import AiPresetVersion


def set_up_ai(db, key: str = "test-key") -> None:
    store.seed_defaults(db)
    row = store.provider_row(db)
    if key:
        store.store_key(row, key)
    else:
        row.api_key_encrypted, row.key_last4 = None, None
    db.commit()


def edit_active(db, module: str, *, model: str | None = None, effort: str | None = None, **prompts) -> None:
    """Change the active preset's newest version in place: a test's way to set up a broken or different preset."""
    _preset, version = store.active_preset(db, module)
    row = db.get(AiPresetVersion, version.id)
    if model is not None:
        row.model_id = model
    if effort is not None:
        row.effort = effort
    if prompts:
        row.prompts = {**row.prompts, **prompts}
    db.commit()
