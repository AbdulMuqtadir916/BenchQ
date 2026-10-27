"""The model and prompts an AI module runs with: the one seam the AI presets plug into
(docs/integration/08-ai-presets.md).

Every LLM call of an AI module reads its setup here, never from `settings` directly:

    cfg = ai_config("scoring")
    resp = await call_llm(prompt, system, provider=cfg.provider, model=cfg.model, api_key=cfg.api_key,
                          effort=cfg.effort)

Today `ai_config` reads the platform settings (backend/settings_scope.py, scope AI_PRESET). When the AI presets
module ships, it reads the module's active preset instead, and `preset_id` / `preset_version` say which one ran;
callers don't change. Firms never choose a model or a prompt (08 Q4).
"""
from dataclasses import dataclass, field

from backend.analyzer.llm_client import resolve_llm_config
from backend.models.db import SessionLocal, Setting


@dataclass(frozen=True)
class AiModule:
    """`feature` is the settings prefix of the module's own model (`<feature>_llm_*`; "" = the primary model);
    `prompts` maps each prompt the module uses to the setting that holds it today."""
    feature: str
    prompts: dict[str, str] = field(default_factory=dict)


# The AI modules that get presets first (08 Q3). Email classification and autofill join when their tracks are live.
AI_MODULES: dict[str, AiModule] = {
    "scoring": AiModule("scoring", {"rubric": "scoring_rubric"}),
    "tailoring": AiModule("cv_tailor", {"tailor": "cv_tailor_prompt", "persona_tailor": "persona_tailor_prompt"}),
    # Résumé building (PDF -> structured résumé) uses the primary model; its prompt is still in code
    # (routes_resumes.parse_resume_pdf) and moves into the module's preset with the Candidates track.
    "resume_building": AiModule(""),
    "cover_letter": AiModule("cover_letter", {"letter": "cover_letter_prompt"}),
    # The new-candidate parser (docs/candidate-onboarding/06-backend.md §4), on the primary model; Zuhair's format.
    "resume_parse": AiModule("", {"parse": "resume_parse_prompt"}),
}


@dataclass(frozen=True)
class AiConfig:
    module: str
    provider: str
    model: str
    api_key: str
    effort: str
    prompts: dict[str, str]
    # Set once presets exist; a run records them (the ledger's modelId / promptVersion, 08 Q5).
    preset_id: str | None = None
    preset_version: int | None = None

    def prompt(self, name: str) -> str:
        """A prompt of this module; an empty one is a setup error, never a silent empty prompt."""
        text = self.prompts.get(name, "")
        if not text.strip():
            raise RuntimeError(f"The {self.module} module has no '{name}' prompt set up.")
        return text


def ai_config(module: str, db=None) -> AiConfig:
    """The setup `module` runs with now. An unknown module is a bug, so it raises."""
    if module not in AI_MODULES:
        raise ValueError(f"unknown AI module {module!r}; add it to backend/ai/config.py AI_MODULES")
    spec = AI_MODULES[module]
    own_db = db is None
    if own_db:
        db = SessionLocal()
    try:
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
