"""The default strict response formats of the résumé tailor's five calls (seeded into settings as response formats,
read through ai_config; docs/team/tailoring.md).

Every object requires all its fields and allows no others; fixed values are enums; every field carries a description,
so what goes in a field is said once, here, and the prompts keep only the rules for writing it. A format's lists stay
lists of objects (never one field per role): on OpenRouter a strict format guides the model rather than locking it,
and list-shaped formats came back intact where per-role fields broke.
"""


def _text(description: str) -> dict:
    return {"type": "string", "description": description}


def _flag(description: str) -> dict:
    return {"type": "boolean", "description": description}


def _number(description: str) -> dict:
    return {"type": "integer", "description": description}


def _texts(description: str, item: str) -> dict:
    return {"type": "array", "description": description, "items": _text(item)}


def _choice(description: str, values: list) -> dict:
    return {"type": "string", "enum": values, "description": description}


def _object(description: str, properties: dict) -> dict:
    return {"type": "object", "description": description, "properties": properties,
            "required": list(properties), "additionalProperties": False}


def _list(description: str, properties: dict, item: str = "") -> dict:
    return {"type": "array", "description": description, "items": _object(item or description, properties)}


PRIORITIES = ["required", "preferred", "duty"]
STATUSES = ["matched", "adjacent", "gap"]
ROLE_TYPES = ["technical", "domain", "consulting", "leadership"]
REVIEW_REASONS = ["keyword", "reframing", "style", "grounding"]
COVERAGE = ["covered", "synonym-only", "missing (have it)", "missing (gap)"]
VERIFY_REASONS = ["keyword", "grounding", "bullet count", "repetition", "verb", "length", "style"]

_EDITS = lambda reasons, where: _list(  # noqa: E731
    f"Exact text replacements to apply to {where}; empty when nothing needs changing.",
    {"old_string": _text(f"Text copied character for character from {where}, long enough to occur exactly once; "
                         "no list marker in front of it."),
     "new_string": _text("The replacement: final CV text only, never a note, an instruction or a bracketed comment. "
                         "Empty to remove a bullet."),
     "reason": _choice("Why the edit is made.", reasons)},
    "One exact replacement.")

ANALYSIS_SCHEMA = _object("The posting evaluated against the resume.", {
    "title": _text("The posting's job title as the posting states it."),
    "role_type": _choice("The posting's main register.", ROLE_TYPES),
    "outside_home_domain": _flag("True when the role sits outside the candidate's home domain."),
    "requirements": _list(
        "Every requirement the posting states, one per entry: each required skill, each preferred (nice-to-have) "
        "skill and each responsibility it lists.",
        {"requirement": _text("The requirement in the posting's own words."),
         "priority": _choice("required, preferred (nice-to-have) or duty (a responsibility the role carries).",
                             PRIORITIES),
         "status": _choice("matched: the resume shows it; adjacent: the resume shows something that does the same job "
                           "or a close relative; gap: the resume has nothing.", STATUSES),
         "evidence": _text("The resume's role and bullet number(s) that show it, or the adjacent thing; \"\" for a "
                           "gap.")},
        "One requirement."),
    "keywords": _list(
        "The posting's required and preferred keywords: tools, technologies, methods and qualifications.",
        {"keyword": _text("The keyword exactly as the posting spells it."),
         "priority": _choice("required or preferred.", ["required", "preferred"])},
        "One keyword."),
    "headline_keyword": _text("The most relevant keyword from the posting for the headline."),
})

DRAFT_SCHEMA = _object("The CV drafted for this posting.", {
    "header": _object("The two contact-line fields a parse does not split out.", {
        "location": _text("The candidate's location exactly as the resume's contact line prints it, or \"\"."),
        "work_authorization": _text("The work authorization exactly as the resume's contact line prints it, or \"\"."),
    }),
    "headline": _text("The title line under the candidate's name, by the headline formula."),
    "profile_statement": _text("The elevator pitch, as prose: 3-4 lines, at most about 80 words, no pronouns, total "
                               "years only and no dates; about the candidate, never about what the resume lists or "
                               "lacks."),
    "core_competencies": _list(
        "5-7 competencies tailored to this posting, the ones the posting stresses first.",
        {"label": _text("The bold category label, in the posting's own term where it truthfully applies; plain text, "
                        "no ** or other markup."),
         "text": _text("One short line (at most about 20 words) of noun phrases naming the candidate's real tools "
                       "and areas, never a claim of work done; never commentary about the resume (\"is listed\", "
                       "\"is not listed\").")},
        "One competency."),
    "experience": _list(
        "One entry per resume role, in the resume's order; every role stays.",
        {"role_number": _number("The role's number as the resume numbers it (ROLE 1 is the most recent)."),
         "bullets": _texts("The role's bullets, most relevant to this posting first: 4-6 for the most recent role, "
                           "3-4 for the previous one, 2-3 for older roles.",
                           "One bullet as plain text: no list marker, at most about 30 words, no pronouns.")},
        "One role."),
    "projects": _list(
        "Only the resume projects worth keeping for this posting; empty when none.",
        {"project_number": _number("The project's number as the resume numbers it."),
         "bullets": _texts("The project's bullets.", "One bullet as plain text, no list marker.")},
        "One project."),
    "certifications": _texts("The resume's certifications relevant to this posting, named as the resume names them.",
                             "One certification."),
    "awards": {"type": "array", "description": "The numbers of the resume's awards to keep; empty when it has none.",
               "items": _number("An award's number as the resume numbers it.")},
    "gaps": _texts("The requirements the candidate genuinely lacks; reported beside the CV, never printed in it.",
                   "One requirement in the posting's words."),
    "stretch_flags": _list(
        "Each bullet in the \"flag it\" zone of the interview backtrack test; empty when none.",
        {"bullet": _text("The bullet, quoted."), "why": _text("Why it is a stretch.")},
        "One stretch."),
})

REVIEW_SCHEMA = _object("The reviewer's feedback on the CV draft.", {
    "edits": _EDITS(REVIEW_REASONS, "the CV DRAFT"),
    "missed_requirements": _text("Part B: missed keywords or requirements (skills and responsibilities) the resume "
                                 "supports, what to add and where: a role's bullet only when that role's own lines "
                                 "state it, otherwise a core competency; \"no issues\" when there are none."),
    "reframing": _text("Part B: passive, generic or low-energy statements and action-oriented rewrites, including "
                       "structural weakness; \"no issues\" when there are none."),
    "tone_and_style": _text("Part B: tone, formality or voice issues (cliches, hedging, over-humility, pronouns, "
                            "inconsistent register); \"no issues\" when there are none."),
})

VERIFY_SCHEMA = _object("The verification of the tailored CV.", {
    "keyword_coverage": _list(
        "One row for each keyword of step 1.",
        {"keyword": _text("The keyword as the posting spells it."),
         "priority": _choice("required or preferred.", ["required", "preferred"]),
         "status": _choice("covered, synonym-only, missing (have it) or missing (gap).", COVERAGE),
         "note": _text("Where it appears, or why it is absent.")},
        "One keyword's coverage."),
    "checklist": _list(
        "One row for each checklist item, in the order given.",
        {"item": _text("The checklist item."), "passed": _flag("True when the CV meets it."),
         "note": _text("What fails and where; \"\" when it passes.")},
        "One checklist item."),
    "edits": _EDITS(VERIFY_REASONS, "THE TAILORED CV"),
})
