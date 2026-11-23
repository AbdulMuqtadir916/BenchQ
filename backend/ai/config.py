"""The model and prompts an AI module runs with: the one seam the AI presets plug into
(docs/integration/08-ai-presets.md).

Every LLM call of an AI module reads its setup here, never from `settings` directly:

    cfg = ai_config("resume_parse")
    resp = await call_llm(prompt, system, provider=cfg.provider, model=cfg.model, api_key=cfg.api_key,
                          effort=cfg.effort)

The four live use cases (`backend/ai/modules.py`) read their active preset and the one shared key; `preset_id` and
`preset_version` say which one ran. The older code outside the panel reads its model from the settings and, on
OpenRouter, the same key. Firms never choose a model or a prompt (08 Q4).
"""
from dataclasses import dataclass, field

from backend.ai import store
from backend.ai.modules import PRESET_MODULES
from backend.analyzer.llm_client import resolve_llm_config
from backend.models.db import SessionLocal, Setting


@dataclass(frozen=True)
class AiModule:
    """Older code outside the presets: `feature` is the settings prefix of its model (`<feature>_llm_*`; "" = the
    primary model); `prompts` maps each prompt it uses to the setting that holds it."""
    feature: str
    prompts: dict[str, str] = field(default_factory=dict)


LEGACY_MODULES: dict[str, AiModule] = {
    "scoring": AiModule("scoring", {"rubric": "scoring_rubric"}),
    # Résumé building: JobNavigator's PDF -> résumé parser, removed in résumé versioning PR 6. Nothing calls it.
    "resume_building": AiModule(""),
    "cover_letter": AiModule("cover_letter", {"letter": "cover_letter_prompt"}),
}
AI_MODULES = (*PRESET_MODULES, *LEGACY_MODULES)


@dataclass(frozen=True)
class AiConfig:
    module: str
    provider: str
    model: str
    api_key: str
    effort: str
    prompts: dict[str, str]
    # The preset and version this setup came from: a run records them (08 Q5).
    preset_id: object = None
    preset_version: int | None = None

    def prompt(self, name: str) -> str:
        """A prompt of this module; an empty one is a setup error, never a silent empty prompt."""
        text = self.prompts.get(name, "")
        if not text.strip():
            raise RuntimeError(f"The {self.module} module has no '{name}' prompt set up.")
        return text


def _preset_config(module: str, db) -> AiConfig:
    row = store.provider_row(db)
    provider = row.provider if row is not None else "openrouter"
    found = store.active_preset(db, module)
    if found is None:
        return AiConfig(module=module, provider=provider, model="", api_key=store.shared_key(db), effort="", prompts={})
    preset, version = found
    return AiConfig(module=module, provider=provider, model=version.model_id, api_key=store.shared_key(db),
                    effort=version.effort or "", prompts=dict(version.prompts or {}), preset_id=preset.id,
                    preset_version=version.version)


def ai_config(module: str, db=None) -> AiConfig:
    """The setup `module` runs with now. An unknown module is a bug, so it raises."""
    if module not in AI_MODULES:
        raise ValueError(f"unknown AI module {module!r}; add it to backend/ai/modules.py")
    own_db = db is None
    if own_db:
        db = SessionLocal()
    try:
        if module in PRESET_MODULES:
            return _preset_config(module, db)
        spec = LEGACY_MODULES[module]
        llm = resolve_llm_config(spec.feature, db=db)
        prompts = {}
        for name, key in spec.prompts.items():
            row = db.query(Setting).filter(Setting.key == key).first()
            prompts[name] = row.value if row and row.value else ""
    finally:
        if own_db:
            db.close()
    return AiConfig(module=module, provider=llm["provider"], model=llm["model"], api_key=llm["api_key"],
                    effort=llm["effort"], prompts=prompts)
