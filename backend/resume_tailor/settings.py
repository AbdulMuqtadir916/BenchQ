"""The résumé tailor's setup: its own model, its prompts and its response formats, kept in `settings` the way the
résumé parser keeps its own (candidates/parse.py, parse_defaults.py; docs/team/tailoring.md §3).

- **Model:** three rows of its own, all required: `resume_tailor_llm_provider` (openrouter only: the strict format and
  reasoning-off travel only on that call), `resume_tailor_llm_model` and `resume_tailor_llm_api_key` (seeded empty, set
  on the settings page, never in code). They are read straight from `settings`, never through `ai_config`'s model,
  which fills an empty row from the shared (Claude) model: the prompts and formats were measured on GPT-6 Luna only.
- **Prompts and formats:** seeded from `prompts.py` and `schemas.py` (the handoff's text, verbatim), read through
  `ai_config("resume_tailor")`, so a Super Admin can replace them without a release and the AI presets take them over
  later. A broken one fails every tailoring, so a save is checked (`setting_problems`, called from
  backend/seed.py `invalid_setting_values`) and so is every run (`read_setup`).

Each rule was measured as written (the handoff, section 9): a change to a prompt or a format needs re-testing.
"""
import json
from dataclasses import dataclass

from backend.resume_tailor import prompts, schemas

PROVIDER_ROW, MODEL_ROW, KEY_ROW = "resume_tailor_llm_provider", "resume_tailor_llm_model", "resume_tailor_llm_api_key"
PROVIDER, DEFAULT_MODEL = "openrouter", "openai/gpt-6-luna"

# The text the pipeline fills in, by its name in ai_config, with the row that holds it.
PROMPT_ROWS = {
    "system": "resume_tailor_system_prompt",
    "review_system": "resume_tailor_review_system_prompt",
    "writing_style": "resume_tailor_writing_style",
    "cv_rules": "resume_tailor_cv_rules",
    "analyse": "resume_tailor_analyse_prompt",
    "draft": "resume_tailor_draft_prompt",
    "review": "resume_tailor_review_prompt",
    "revise": "resume_tailor_revise_prompt",
    "verify": "resume_tailor_verify_prompt",
}
# The four strict formats (revise answers in the draft's). Stored whole, as the parser stores its own: the json_schema
# wrapper with its name, strict: true and the schema.
FORMAT_ROWS = {
    "analyse": "resume_tailor_analyse_format",
    "draft": "resume_tailor_draft_format",
    "review": "resume_tailor_review_format",
    "verify": "resume_tailor_verify_format",
}
# The placeholders each step's template must keep: without one, part of what the model needs never reaches it.
PLACEHOLDERS = {
    "analyse": ("{resume}", "{posting}"),
    "draft": ("{writing_style}", "{cv_rules}", "{analysis}", "{resume}", "{posting}"),
    "review": ("{writing_style}", "{draft}", "{analysis}", "{resume}", "{posting}"),
    "revise": ("{writing_style}", "{cv_rules}", "{part_b}", "{draft}", "{resume}", "{posting}"),
    "verify": ("{analysis}", "{resume}", "{posting}", "{draft}"),
}
# The fields the code reads from each reply: a format that stops requiring one breaks the run.
READ_FIELDS = {
    "analyse": ("title", "requirements"),
    "draft": ("header", "headline", "profile_statement", "core_competencies", "experience", "projects",
              "certifications", "awards", "gaps", "stretch_flags"),
    "review": ("edits", "missed_requirements", "reframing", "tone_and_style"),
    "verify": ("keyword_coverage", "checklist", "edits"),
}
_SCHEMAS = {"analyse": schemas.ANALYSIS_SCHEMA, "draft": schemas.DRAFT_SCHEMA, "review": schemas.REVIEW_SCHEMA,
            "verify": schemas.VERIFY_SCHEMA}
_DEFAULT_PROMPTS = {
    "system": prompts.SYSTEM_PROMPT, "review_system": prompts.REVIEW_SYSTEM_PROMPT,
    "writing_style": prompts.WRITING_STYLE, "cv_rules": prompts.CV_RULES, "analyse": prompts.ANALYSE_PROMPT,
    "draft": prompts.DRAFT_PROMPT, "review": prompts.REVIEW_PROMPT, "revise": prompts.REVISE_PROMPT,
    "verify": prompts.VERIFY_PROMPT,
}
_PROMPT_DESCRIPTIONS = {
    "system": "system prompt of every step but the review",
    "review_system": "system prompt of the review step",
    "writing_style": "writing-style rules, filled into {writing_style}",
    "cv_rules": "CV rules, filled into {cv_rules}",
    "analyse": "step 1 (analyse) prompt",
    "draft": "step 2 (draft) prompt",
    "review": "step 3 (review) prompt",
    "revise": "step 4 (revise) prompt",
    "verify": "step 5 (verify) prompt",
}


def response_format(step: str, schema: dict | None = None) -> dict:
    """A step's strict format as the request sends it."""
    return {"type": "json_schema",
            "json_schema": {"name": f"mads_{step}", "strict": True, "schema": schema or _SCHEMAS[step]}}


def _described(name: str) -> str:
    needed = PLACEHOLDERS.get(name)
    return (f"Résumé tailor: {_PROMPT_DESCRIPTIONS[name]}."
            + (f" Must keep {', '.join(needed)}." if needed else "")
            + " Measured as written: a change needs re-testing.")


# The rows backend/seed.py seeds (DEFAULT_SETTINGS). The key is seeded empty: until it is set, every tailoring fails
# naming the row.
DEFAULT_SETTINGS = {
    PROVIDER_ROW: (PROVIDER, "Résumé tailor provider (required; openrouter only)"),
    MODEL_ROW: (DEFAULT_MODEL, "Résumé tailor model (required)"),
    KEY_ROW: ("", "OpenRouter API key for the résumé tailor (required; until set, every tailoring fails naming this "
                  "row)"),
    **{row: (_DEFAULT_PROMPTS[name], _described(name)) for name, row in PROMPT_ROWS.items()},
    **{row: (json.dumps(response_format(step), indent=2, ensure_ascii=False),
             f"Résumé tailor: the strict response format of the {step} step"
             + (" (and of revise, under the name mads_revise)" if step == "draft" else "")
             + f" (json_schema, strict: true). Its schema must require {', '.join(READ_FIELDS[step])}.")
       for step, row in FORMAT_ROWS.items()},
}


# ── Checks ───────────────────────────────────────────────────────────────────────────────────────────────────────────

def format_problem(step: str, value) -> str | None:
    """Why `value` can't be this step's response format, or None. A dict is accepted too: the settings page gets JSON
    values back parsed and may send them so."""
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            return "is not valid JSON"
    if not isinstance(value, dict) or value.get("type") != "json_schema":
        return 'needs "type": "json_schema"'
    spec = value.get("json_schema") if isinstance(value.get("json_schema"), dict) else {}
    if spec.get("strict") is not True:
        return 'needs "json_schema.strict": true'
    if not isinstance(spec.get("name"), str) or not spec["name"].strip():
        return 'needs a "json_schema.name"'
    schema = spec.get("schema") if isinstance(spec.get("schema"), dict) else {}
    if schema.get("type") != "object":
        return 'needs "json_schema.schema.type": "object"'
    missing = [key for key in READ_FIELDS[step] if key not in (schema.get("required") or [])]
    if missing:
        return "has a schema that doesn't require " + ", ".join(missing)
    return None


def prompt_problem(name: str, value) -> str | None:
    """Why `value` can't be this prompt, or None."""
    if not isinstance(value, str) or not value.strip():
        return "is empty"
    missing = [p for p in PLACEHOLDERS.get(name, ()) if p not in value]
    return "needs the " + ", ".join(missing) + " placeholder" + ("s" if len(missing) > 1 else "") if missing else None


def setting_problems(updates: dict) -> list[str]:
    """The save check for the tailor's prompt and format rows (backend/seed.py invalid_setting_values)."""
    problems = []
    for name, row in PROMPT_ROWS.items():
        if row in updates and (why := prompt_problem(name, updates[row])):
            problems.append(f"{row}: {why}")
    for step, row in FORMAT_ROWS.items():
        if row in updates and (why := format_problem(step, updates[row])):
            problems.append(f"{row}: {why}")
    return problems


# ── Reading it ───────────────────────────────────────────────────────────────────────────────────────────────────────

class TailorSetupError(RuntimeError):
    """The tailor isn't set up: a model row is empty, or a prompt or format is broken. Names the row, never a value."""


@dataclass(frozen=True)
class Setup:
    """What one tailoring runs with: the model, the nine prompts by name and the four formats by step."""
    model: str
    api_key: str
    prompts: dict
    formats: dict

    def format(self, step: str) -> dict:
        """The request's format for a step; revise answers in the draft's, under its own name."""
        stored = self.formats["draft" if step == "revise" else step]
        if step == "revise":
            stored = {**stored, "json_schema": {**stored["json_schema"], "name": "mads_revise"}}
        return stored


def default_setup(model: str = DEFAULT_MODEL, api_key: str = "") -> Setup:
    """The seeded prompts and formats, without reading `settings` (the tests and the replay)."""
    return Setup(model=model, api_key=api_key, prompts=dict(_DEFAULT_PROMPTS),
                 formats={step: response_format(step) for step in FORMAT_ROWS})


def read_setup(db) -> Setup:
    """The tailor's setup from `settings`; TailorSetupError naming the row when one is missing or broken, so no other
    model is ever called and no run starts with a prompt that can't work."""
    from backend.ai.config import ai_config
    from backend.models.db import Setting

    rows = {row.key: (row.value or "").strip()
            for row in db.query(Setting).filter(Setting.key.in_((PROVIDER_ROW, MODEL_ROW, KEY_ROW)))}
    if rows.get(PROVIDER_ROW) != PROVIDER:
        raise TailorSetupError(f"{PROVIDER_ROW} must be {PROVIDER}")
    for row in (MODEL_ROW, KEY_ROW):
        if not rows.get(row):
            raise TailorSetupError(f"{row} is not set")

    stored = ai_config("resume_tailor", db=db).prompts
    for name, row in PROMPT_ROWS.items():
        if why := prompt_problem(name, stored.get(name, "")):
            raise TailorSetupError(f"{row} {why}")
    for step, row in FORMAT_ROWS.items():
        if why := format_problem(step, stored.get(f"{step}_format", "")):
            raise TailorSetupError(f"{row} {why}")
    return Setup(model=rows[MODEL_ROW], api_key=rows[KEY_ROW],
                 prompts={name: stored[name] for name in PROMPT_ROWS},
                 formats={step: json.loads(stored[f"{step}_format"]) for step in FORMAT_ROWS})
