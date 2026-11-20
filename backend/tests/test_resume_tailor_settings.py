"""The résumé tailor's setup in `settings` (docs/team/tailoring.md §3): seeded like the parser's, its own model only,
the save check and the run's check naming the row."""
import json

import pytest

from backend.models.db import Setting
from backend.resume_tailor import settings as tailor
from backend.seed import invalid_setting_values, seed_settings


def _set(db, **values):
    for key, value in values.items():
        db.merge(Setting(key=key, value=value))
    db.commit()


@pytest.fixture
def seeded(test_db):
    seed_settings(test_db)
    _set(test_db, **{tailor.KEY_ROW: "test-key"})
    return test_db


def test_every_row_is_seeded_and_the_key_empty(test_db):
    seed_settings(test_db)
    rows = {r.key: r.value for r in test_db.query(Setting).filter(Setting.key.in_(tailor.DEFAULT_SETTINGS))}
    assert set(rows) == set(tailor.DEFAULT_SETTINGS) and len(rows) == 16
    assert rows[tailor.KEY_ROW] == ""
    assert (rows[tailor.PROVIDER_ROW], rows[tailor.MODEL_ROW]) == ("openrouter", "openai/gpt-6-luna")


def test_the_stored_setup_is_the_handoffs(seeded):
    """What a run reads from settings is what the tests run with (default_setup): the prompts and formats verbatim."""
    setup = tailor.read_setup(seeded)
    assert setup == tailor.default_setup(api_key="test-key")
    assert setup.format("revise")["json_schema"]["name"] == "mads_revise"
    assert setup.format("revise")["json_schema"]["schema"] == setup.format("draft")["json_schema"]["schema"]


@pytest.mark.parametrize("row,value,named", [
    (tailor.KEY_ROW, "", "resume_tailor_llm_api_key is not set"),
    (tailor.MODEL_ROW, "", "resume_tailor_llm_model is not set"),
    (tailor.PROVIDER_ROW, "claude_api", "resume_tailor_llm_provider must be openrouter"),
    (tailor.PROMPT_ROWS["analyse"], "Analyse the posting.", "{resume}, {posting} placeholders"),
    (tailor.PROMPT_ROWS["system"], "", "resume_tailor_system_prompt is empty"),
    (tailor.FORMAT_ROWS["verify"], "not json", "resume_tailor_verify_format is not valid JSON"),
])
def test_a_missing_or_broken_row_stops_the_run_naming_it(seeded, row, value, named):
    """It never falls back to the shared (Claude) model or runs a prompt that can't work."""
    _set(seeded, **{row: value}, llm_provider="claude_api", llm_model="claude-sonnet-5", llm_api_key="shared-key")
    with pytest.raises(tailor.TailorSetupError, match=named.replace("{", r"\{").replace("}", r"\}")):
        tailor.read_setup(seeded)


def _without(step: str, field: str) -> dict:
    stored = tailor.response_format(step)
    schema = stored["json_schema"]["schema"]
    return {**stored, "json_schema": {**stored["json_schema"],
                                      "schema": {**schema, "required": [k for k in schema["required"] if k != field]}}}


@pytest.mark.parametrize("row,value,named", [
    (tailor.FORMAT_ROWS["draft"], _without("draft", "gaps"), "doesn't require gaps"),
    (tailor.FORMAT_ROWS["review"], {"type": "json_object"}, '"type": "json_schema"'),
    (tailor.FORMAT_ROWS["analyse"], "{", "not valid JSON"),
    (tailor.PROMPT_ROWS["verify"], "Verify {resume} {posting} {analysis}", "{draft}"),
    (tailor.PROMPT_ROWS["writing_style"], "  ", "is empty"),
    (tailor.PROVIDER_ROW, "claude_api", "openrouter"),
])
def test_a_broken_value_is_refused_on_save(row, value, named):
    problems = invalid_setting_values({row: value})
    assert len(problems) == 1 and row in problems[0] and named in problems[0]


def test_the_defaults_are_accepted_as_text_or_parsed():
    values = {key: value for key, (value, _description) in tailor.DEFAULT_SETTINGS.items()}
    assert invalid_setting_values(values) == []
    assert invalid_setting_values({row: json.loads(values[row]) for row in tailor.FORMAT_ROWS.values()}) == []


def test_a_broken_prompt_is_refused_over_the_api(api_client, test_db):
    r = api_client.patch("/api/settings", json={tailor.PROMPT_ROWS["draft"]: "Draft the CV."})
    assert r.status_code == 400 and "{cv_rules}" in r.json()["detail"]


def test_the_api_key_never_comes_back(api_client, seeded):
    assert api_client.get("/api/settings").json()[tailor.KEY_ROW] == "•" * 6
