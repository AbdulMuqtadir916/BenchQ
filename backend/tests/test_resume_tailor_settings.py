"""The résumé tailor's setup (docs/team/tailoring.md §3): the active preset's model and prompts, the one shared key, its
response formats in code, and a run's check naming what's missing."""
import pytest

from backend.ai.modules import PRESET_MODULES, prompt_problems
from backend.resume_tailor import settings as tailor
from backend.tests.ai_support import edit_active, set_up_ai


@pytest.fixture
def seeded(test_db):
    set_up_ai(test_db)
    return test_db


def test_the_stored_setup_is_the_handoffs(seeded):
    """What a run reads is what the tests run with (default_setup): the prompts and formats verbatim."""
    setup = tailor.read_setup(seeded)
    assert (setup.model, setup.api_key) == ("openai/gpt-6-luna", "test-key")
    assert setup.prompts == tailor.DEFAULT_PROMPTS and setup.formats == tailor.default_setup().formats
    assert setup.preset_id is not None and setup.preset_version == 1
    assert setup.format("revise")["json_schema"]["name"] == "mads_revise"
    assert setup.format("revise")["json_schema"]["schema"] == setup.format("draft")["json_schema"]["schema"]


def test_no_key_stops_the_run(test_db):
    set_up_ai(test_db, key="")
    with pytest.raises(tailor.TailorSetupError, match="API key is not set"):
        tailor.read_setup(test_db)


def test_no_active_preset_stops_the_run(test_db):
    with pytest.raises(tailor.TailorSetupError, match="no active AI preset"):
        tailor.read_setup(test_db)


@pytest.mark.parametrize("prompt,value,named", [
    ("analyse", "Analyse the posting.", "{resume}, {posting} placeholders"),
    ("system", "", "system prompt is empty"),
])
def test_a_broken_prompt_stops_the_run_naming_it(seeded, prompt, value, named):
    edit_active(seeded, "resume_tailor", **{prompt: value})
    with pytest.raises(tailor.TailorSetupError, match=named.replace("{", r"\{").replace("}", r"\}")):
        tailor.read_setup(seeded)


@pytest.mark.parametrize("prompt,value,named", [
    ("verify", "Verify {resume} {posting} {analysis}", "{draft}"),
    ("writing_style", "  ", "is empty"),
])
def test_a_broken_prompt_is_refused_on_save(prompt, value, named):
    module = PRESET_MODULES["resume_tailor"]
    problems = prompt_problems(module, {**module.prompts, prompt: value})
    assert len(problems) == 1 and named in problems[0]


def test_the_default_prompts_are_accepted():
    module = PRESET_MODULES["resume_tailor"]
    assert prompt_problems(module, module.prompts) == []


def test_formats_stay_in_code_and_cover_every_read_field():
    for step in tailor.FORMAT_STEPS:
        required = tailor.response_format(step)["json_schema"]["schema"]["required"]
        assert set(tailor.READ_FIELDS[step]) <= set(required)
