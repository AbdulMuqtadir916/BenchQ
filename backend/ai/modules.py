"""The AI use cases a Super Admin runs through presets, with each one's default model, prompts and prompt rules (08 Q18).
The output formats the code parses are not here: they stay in code beside their parsers (08 Q2, Q12)."""
from dataclasses import dataclass, field

from backend.candidates.parse_defaults import DEFAULT_PROMPT, DEFAULT_SYSTEM_PROMPT
from backend.job_search.search_titles import DEFAULT_MODEL as TITLES_MODEL, DEFAULT_PROMPT as TITLES_PROMPT, ROLE
from backend.resume_tailor import settings as tailor

DECIDER_MODEL = "perplexity/pplx-decider-v1.2"
PARSER_MODEL = "openai/gpt-6-luna"


@dataclass(frozen=True)
class PresetModule:
    key: str
    label: str
    default_model: str
    prompts: dict[str, str]
    prompt_labels: dict[str, str]
    placeholders: dict[str, tuple[str, ...]] = field(default_factory=dict)
    optional_prompts: frozenset[str] = frozenset()
    takes_effort: bool = True
    request: str = "strict_json"            # "strict_json" (chat) or "decision" (OpenRouter Decisions)


PRESET_MODULES: dict[str, PresetModule] = {
    "resume_parse": PresetModule(
        "resume_parse", "Résumé parser", PARSER_MODEL,
        {"system": DEFAULT_SYSTEM_PROMPT, "parse": DEFAULT_PROMPT},
        {"system": "System prompt", "parse": "Parse prompt"},
        {"parse": ("{resume}",)}),
    "resume_tailor": PresetModule(
        "resume_tailor", "Résumé tailoring", tailor.DEFAULT_MODEL, dict(tailor.DEFAULT_PROMPTS),
        {"system": "System prompt", "review_system": "Review system prompt", "writing_style": "Writing style",
         "cv_rules": "CV rules", "analyse": "Step 1: analyse", "draft": "Step 2: draft", "review": "Step 3: review",
         "revise": "Step 4: revise", "verify": "Step 5: verify"},
        dict(tailor.PLACEHOLDERS)),
    "search_titles": PresetModule(
        "search_titles", "Search titles", TITLES_MODEL, {"prompt": TITLES_PROMPT}, {"prompt": "Prompt"},
        {"prompt": (ROLE,)}),
    "email_classification": PresetModule(
        "email_classification", "Email classification", DECIDER_MODEL, {"instructions": ""},
        {"instructions": "Extra instructions (optional)"}, optional_prompts=frozenset({"instructions"}),
        takes_effort=False, request="decision"),
}


def prompt_problems(module: PresetModule, prompts: dict) -> list[str]:
    """Why these prompts can't be saved for this use case (08 Q18). Names the prompt, never its text."""
    problems = []
    unknown = sorted(set(prompts) - set(module.prompts))
    if unknown:
        problems.append("Unknown prompt: " + ", ".join(unknown))
    for name, label in module.prompt_labels.items():
        value = prompts.get(name, "")
        if not isinstance(value, str):
            problems.append(f"{label} must be text.")
        elif not value.strip() and name not in module.optional_prompts:
            problems.append(f"{label} is empty.")
        else:
            missing = [p for p in module.placeholders.get(name, ()) if p not in value]
            if missing:
                problems.append(f"{label} needs {', '.join(missing)}.")
    return problems
