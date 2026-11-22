"""The résumé tailor's setup: the active AI preset's model and prompts, with its response formats in code
(docs/integration/08-ai-presets.md; docs/team/tailoring.md §3).

- **Model and key:** the use case's active preset and the one shared key, through `ai_config("resume_tailor")`.
- **Prompts:** seeded from `prompts.py` (the handoff's text, verbatim). A broken one fails every tailoring, so a save is
  checked (`backend/ai/modules.py`) and so is every run (`read_setup`).
- **Formats:** `schemas.py`, in code beside the parser of each reply: a preset never changes the shape the code reads.

Each rule was measured as written (the handoff, section 9): a change to a prompt needs re-testing.
"""
from dataclasses import dataclass

from backend.resume_tailor import prompts, schemas

PROVIDER, DEFAULT_MODEL = "openrouter", "openai/gpt-6-luna"
# The four strict formats (revise answers in the draft's).
FORMAT_STEPS = ("analyse", "draft", "review", "verify")
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
DEFAULT_PROMPTS = {
    "system": prompts.SYSTEM_PROMPT, "review_system": prompts.REVIEW_SYSTEM_PROMPT,
    "writing_style": prompts.WRITING_STYLE, "cv_rules": prompts.CV_RULES, "analyse": prompts.ANALYSE_PROMPT,
    "draft": prompts.DRAFT_PROMPT, "review": prompts.REVIEW_PROMPT, "revise": prompts.REVISE_PROMPT,
    "verify": prompts.VERIFY_PROMPT,
}

def response_format(step: str, schema: dict | None = None) -> dict:
    """A step's strict format as the request sends it."""
    return {"type": "json_schema",
            "json_schema": {"name": f"mads_{step}", "strict": True, "schema": schema or _SCHEMAS[step]}}


# ── Earlier defaults ─────────────────────────────────────────────────────────────────────────────────────────────────

# Wording the defaults changed, (old, new). Migration 0032 brings a prompt still holding an earlier default up to date
# when it copies it into Preset 1; an edited prompt is left alone. 2026-11-17 (Zuhair): bullets 6, 4, then 3 a role.
DEFAULT_CHANGES = (
    ("- 4-6 bullets for the most recent role, 3-4 for the previous one, 2-3 for older roles: count them before you "
     "finish; never more.",
     "- Exactly 6 bullets for the most recent role, 4 for the previous one and 3 for each older role (fewer only when "
     "the role's resume lines hold fewer): count them before you finish; never more, never fewer."),
    ("(4-6, 3-4, then 2-3 a role:", "(exactly 6, 4, then 3 a role:"),
    ("- Bullet counts: at most 6 for the most recent role, 4 for the previous one, 3 for each older role (the CV shows "
     "each role's count).",
     "- Bullet counts: exactly 6 for the most recent role, 4 for the previous one, 3 for each older role, fewer only "
     "when the resume's role holds fewer (the CV shows each role's count)."),
    ("4-6 for the most recent role, 3-4 for the previous one, 2-3 for older roles.",
     "exactly 6 for the most recent role, 4 for the previous one, 3 for each older role (fewer only when the resume "
     "role holds fewer)."),
)


def as_before(value: str) -> str:
    for old, new in DEFAULT_CHANGES:
        value = value.replace(new, old)
    return value


def upgraded_prompt(name: str, value: str) -> str:
    """Today's default when `value` is still an earlier default of this prompt; otherwise `value`."""
    default = DEFAULT_PROMPTS.get(name, "")
    before = as_before(default)
    return default if before != default and (value or "").strip() == before.strip() else value


# ── Checks ───────────────────────────────────────────────────────────────────────────────────────────────────────────

def prompt_problem(name: str, value) -> str | None:
    """Why `value` can't be this prompt, or None."""
    if not isinstance(value, str) or not value.strip():
        return "is empty"
    missing = [p for p in PLACEHOLDERS.get(name, ()) if p not in value]
    return "needs the " + ", ".join(missing) + " placeholder" + ("s" if len(missing) > 1 else "") if missing else None


# ── Reading it ───────────────────────────────────────────────────────────────────────────────────────────────────────

class TailorSetupError(RuntimeError):
    """The tailor isn't set up: no key, no active preset, or a broken prompt. Names what's missing, never a value."""


@dataclass(frozen=True)
class Setup:
    """What one tailoring runs with: the model, its nine prompts by name and the four formats by step. A run keeps the
    preset version it started with (08 Q14)."""
    model: str
    api_key: str
    prompts: dict
    formats: dict
    effort: str = ""
    preset_id: object = None
    preset_version: int | None = None

    def format(self, step: str) -> dict:
        """The request's format for a step; revise answers in the draft's, under its own name."""
        stored = self.formats["draft" if step == "revise" else step]
        if step == "revise":
            stored = {**stored, "json_schema": {**stored["json_schema"], "name": "mads_revise"}}
        return stored


def default_setup(model: str = DEFAULT_MODEL, api_key: str = "") -> Setup:
    """The default prompts and formats, without reading the database (the tests and the replay)."""
    return Setup(model=model, api_key=api_key, prompts=dict(DEFAULT_PROMPTS),
                 formats={step: response_format(step) for step in FORMAT_STEPS})


def read_setup(db) -> Setup:
    """The active preset as one tailoring's setup; TailorSetupError naming what's missing, so no other model is ever
    called and no run starts with a prompt that can't work."""
    from backend.ai.config import ai_config

    cfg = ai_config("resume_tailor", db=db)
    if cfg.provider != PROVIDER:
        raise TailorSetupError(f"the AI provider must be {PROVIDER}")
    if not cfg.model:
        raise TailorSetupError("no active AI preset")
    if not cfg.api_key:
        raise TailorSetupError("the AI API key is not set")
    for name in DEFAULT_PROMPTS:
        if why := prompt_problem(name, cfg.prompts.get(name, "")):
            raise TailorSetupError(f"the {name} prompt {why}")
    return Setup(model=cfg.model, api_key=cfg.api_key, prompts={name: cfg.prompts[name] for name in DEFAULT_PROMPTS},
                 formats={step: response_format(step) for step in FORMAT_STEPS}, effort=cfg.effort,
                 preset_id=cfg.preset_id, preset_version=cfg.preset_version)
