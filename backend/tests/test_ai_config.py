"""ai_config: the one place an AI module reads its model and prompts (backend/ai/config.py,
docs/integration/08-ai-presets.md)."""
import pytest

from backend.ai.config import AI_MODULES, ai_config
from backend.models.db import Setting
from backend.settings_scope import SETTING_SCOPES, Scope


def _set(db, **values):
    for key, value in values.items():
        db.merge(Setting(key=key, value=value))
    db.commit()


def test_a_module_reads_its_own_model_and_prompts(test_db):
    _set(test_db, llm_provider="claude_api", llm_model="primary-model", scoring_llm_model="scoring-model",
         scoring_rubric="Score it like this.")
    cfg = ai_config("scoring", db=test_db)
    assert (cfg.module, cfg.provider, cfg.model) == ("scoring", "claude_api", "scoring-model")
    assert cfg.prompt("rubric") == "Score it like this."
    assert cfg.preset_id is None and cfg.preset_version is None


def test_a_module_without_its_own_model_uses_the_primary(test_db):
    _set(test_db, llm_provider="claude_api", llm_model="primary-model", cover_letter_llm_model="")
    assert ai_config("cover_letter", db=test_db).model == "primary-model"
    assert ai_config("resume_building", db=test_db).model == "primary-model"


def test_an_empty_prompt_is_a_setup_error(test_db):
    _set(test_db, cv_tailor_prompt="")
    with pytest.raises(RuntimeError, match="tailoring module has no 'tailor' prompt"):
        ai_config("tailoring", db=test_db).prompt("tailor")


def test_an_unknown_module_raises(test_db):
    with pytest.raises(ValueError, match="unknown AI module"):
        ai_config("horoscope", db=test_db)


def test_every_prompt_setting_is_an_ai_preset_setting():
    """The prompts ai_config reads are the ones F2c marked as moving to the AI presets."""
    for module in AI_MODULES.values():
        for key in module.prompts.values():
            assert SETTING_SCOPES[key][0] is Scope.AI_PRESET, key
