"""The résumé tailor's steps: Mads Lorentzen's /apply CV workflow ("Updated_focused" in JobNavigator) on GPT-6 Luna
through OpenRouter (docs/team/tailoring.md; the tailoring handoff, Part 2 §5).

  1. analyse  the posting against the parsed résumé: requirements (skills and duties) matched, adjacent or gap
  2. draft    the CV by his rules
  3. review   a hiring-manager proxy: grounding audit, Part A exact edits, Part B notes
  4. revise   Part A applied as exact replacements (his Edit tool), then one call for Part B
  5. verify   keyword coverage and his checklist; their edits applied as exact replacements
  6. gate     in code: every bullet checked against its own role's lines (fact_gate.py)

The model writes the copy; code only checks each bullet against its own role, then puts the copy together from the
final draft with the résumé's own facts (titles, employers, dates, education, contact items).

Copied from JobNavigator backend/analyzer/mads_tailor/pipeline.py. BenchQ's changes: the prompts and formats come from
the tailor's settings (`Setup`, settings.py) instead of the code; every call goes through BenchQ's `call_llm` with the
request the handoff's §1 sets, and is logged to llm_call_log under the firm (`call_model`); the settings for other
models and for thinking are gone, since BenchQ runs Luna without thinking only.
"""
import json
import re
import logging
import time

from backend.analyzer.llm_client import call_llm
from backend.analyzer.llm_logger import track_llm_call
from backend.analyzer.model_json import parse_model_json
from backend.analyzer.prompt_fence import fence
from backend.resume_tailor import copy_builder as cb
from backend.resume_tailor import fact_gate
from backend.resume_tailor import resume_bits as rs
from backend.resume_tailor.settings import PROVIDER, Setup

logger = logging.getLogger(__name__)

MAX_TOKENS = 12000
REPORT_KEY = cb.REPORT_KEY
# The purpose the five calls are logged under in llm_call_log (AI spend per firm).
PURPOSE = "resume_tailor"


async def tailor(base: dict, jd_text: str, title_of_the_job: str = "", *, setup: Setup, firm_id=None) -> dict:
    """The tailored copy (our résumé JSON) with the workflow's record kept in its report: each step's result,
    seconds and token usage. `base` is `build_base_resume` of the stored résumé; `jd_text` the posting without fake
    markers, cut to its first 20,000 characters (`stored.prepared_posting`)."""
    base = base or {}
    resume = with_the_skills_list_labelled(cb._resume_as_numbered_text(base))
    posting = fence(jd_text, "JOB POSTING")
    steps, seconds, usage = {}, {}, {}

    async def step(name: str, prompt: str, system_name: str = "system") -> dict:
        started = time.monotonic()
        reply, response = await _ask(setup, prompt, setup.prompts[system_name], name, firm_id)
        seconds[name] = round(time.monotonic() - started, 1)
        usage[name] = response.get("usage")
        steps[name] = reply
        return reply

    text = setup.prompts
    fill = {"{resume}": resume, "{posting}": posting, "{writing_style}": text["writing_style"],
            "{cv_rules}": text["cv_rules"]}
    analysis = await step("analyse", _filled(text["analyse"], fill))
    fill["{analysis}"] = json.dumps(analysis, ensure_ascii=False)
    draft = await step("draft", _filled(text["draft"], fill))

    review = await step("review", _filled(text["review"], {**fill, "{draft}": cv_as_text(draft, base)}),
                        "review_system")
    draft, applied, review_missed = with_the_edits(draft, review.get("edits"), resume)
    part_b = {key: review.get(key) for key in ("missed_requirements", "reframing", "tone_and_style")}
    revised = await step("revise", _filled(text["revise"], {**fill, "{draft}": json.dumps(draft, ensure_ascii=False),
                                                            "{part_b}": json.dumps(part_b, ensure_ascii=False)}))
    draft = _kept_where_missing(revised, draft)

    verification = await step("verify", _filled(text["verify"],
                                                {**fill, "{draft}": cv_as_text(draft, base, with_counts=True)}))
    draft, verified, verify_missed = with_the_edits(draft, verification.get("edits"), resume)
    for name, missed in (("review", review_missed), ("verify", verify_missed)):
        if missed:
            logger.warning(f"Mads tailor: {len(missed)} {name} edit(s) could not be applied: "
                           + "; ".join(sorted({entry['why'] for entry in missed})))
    draft, gated = fact_gate.checked_against_each_role(draft, base)
    if gated:
        logger.warning(f"Mads tailor: {len(gated)} bullet(s) named what their role does not state: "
                       + "; ".join(sorted({entry['action'] for entry in gated})))

    copy = cb.assemble_v2_resume(as_v2_reply(draft, analysis), base, jd_text, title_of_the_job)
    copy[REPORT_KEY].update({
        "checked_by": "reviewer",
        "workflow": "mads",
        "gaps": draft.get("gaps") or [],
        "stretch_flags": draft.get("stretch_flags") or [],
        "review_edits_applied": applied, "verify_edits_applied": verified,
        "review_edits_missed": review_missed, "verify_edits_missed": verify_missed,
        "fact_gate_changes": gated,
        "keyword_coverage": verification.get("keyword_coverage") or [],
        "checklist": verification.get("checklist") or [],
        "steps": steps, "seconds": seconds, "usage": usage,
    })
    return copy


SKILLS_HEADING = "SKILLS"
SKILLS_LIST_HEADING = "SKILLS LIST (tool names only: not evidence of work in any role)"


def with_the_skills_list_labelled(resume: str) -> str:
    """The numbered résumé with its skills heading saying the list is names, not work: a tool found only there
    belongs in the competencies, never in a role's bullets."""
    return "\n".join(SKILLS_LIST_HEADING if line == SKILLS_HEADING else line for line in resume.split("\n"))


def _filled(template: str, fill: dict) -> str:
    for placeholder, text in fill.items():
        template = template.replace(placeholder, text)
    return template


async def call_model(setup: Setup, prompt: str, system: str, step: str, firm_id=None) -> dict:
    """One step's call, as the handoff's §1 sets it: the strict format (sent with provider.require_parameters),
    reasoning off, no temperature, no fallback model; 4 attempts for a timeout, a 429 or 5xx, or a reply cut off at
    MAX_TOKENS (call_llm). Logged to llm_call_log under the firm. Returns {"text", "usage"}."""
    async with track_llm_call(PURPOSE, PROVIDER, setup.model, firm_id=firm_id) as tracker:
        response = await call_llm(prompt=prompt, system=system, max_tokens=MAX_TOKENS, provider=PROVIDER,
                                  model=setup.model, api_key=setup.api_key, effort="",
                                  response_format=setup.format(step), reasoning_off=True, use_fallback=False,
                                  retry_cut_off=True)
        tracker.record(response)
    return response


class TailorFailed(RuntimeError):
    """A step failed, so the whole tailoring did (no partial copy). `code` is what the BDE's message names (decided
    2026-11-12, Q8): never the model's text or the résumé's."""

    def __init__(self, code: str, step: str):
        super().__init__(f"the {step} step failed ({code})")
        self.code, self.step = code, step


# The reasons a tailoring fails, as TailorFailed.code.
PROVIDER_FAILED, UNREADABLE_REPLY = "provider_failed", "unreadable_reply"


async def _ask(setup: Setup, prompt: str, system: str, name: str, firm_id=None) -> tuple:
    """One step's reply, asking once more for JSON only when the first reply cannot be read."""
    for attempt in (1, 2):
        asked = prompt if attempt == 1 else prompt + "\n\nReply with the JSON object only, nothing before or after it."
        try:
            response = await call_model(setup, asked, system, name, firm_id)
        except Exception as e:
            # Every attempt call_llm makes has failed. Its type only: the provider's message is not ours to log.
            logger.warning(f"Mads tailor: the {name} step's model call failed ({type(e).__name__})")
            raise TailorFailed(PROVIDER_FAILED, name) from e
        try:
            return parse_model_json(response["text"]), response
        except json.JSONDecodeError as e:
            logger.warning(f"Mads tailor: the {name} reply was not JSON (attempt {attempt}/2)")
            if attempt == 2:
                raise TailorFailed(UNREADABLE_REPLY, name) from e


# ── The draft as text, and the reviewer's edits ─────────────────────────────────

def cv_as_text(draft: dict, base: dict, with_counts: bool = False) -> str:
    """The draft as the reviewer reads it: headline, profile, competencies, then each role with its facts. The verify
    step also sees each role's bullet count; the reviewer does not, as it quoted those labels in edits that could
    never apply."""
    roles = cb._roles(base)
    lines = [f"Headline: {rs._text(draft.get('headline'))}", "", "PROFILE", rs._text(draft.get("profile_statement")),
             "", "CORE COMPETENCIES"]
    lines += [f"- {rs._text(c.get('label'))}: {rs._text(c.get('text'))}" for c in draft.get("core_competencies") or []
              if isinstance(c, dict)]
    lines += ["", "PROFESSIONAL EXPERIENCE"]
    for entry in draft.get("experience") or []:
        number = entry.get("role_number") if isinstance(entry, dict) else None
        if not isinstance(number, int) or not 1 <= number <= len(roles):
            continue
        role = roles[number - 1]
        facts = " | ".join(rs._text(role.get(key)) for key in ("title", "company") if role.get(key))
        bullets = [_without_the_marker(rs._text(bullet)) for bullet in entry.get("bullets") or []
                   if _without_the_marker(rs._text(bullet))]
        count = f" ({len(bullets)} bullets)" if with_counts else ""
        lines += [f"{facts} | {rs._role_dates(role) or rs._text(role.get('date'))}{count}"]
        lines += [f"  - {bullet}" for bullet in bullets]
    for entry in draft.get("projects") or []:
        if isinstance(entry, dict):
            lines += [f"PROJECT {entry.get('project_number')}"] + [f"  - {rs._text(b)}" for b in entry.get("bullets") or []]
    return "\n".join(lines)


def with_the_edits(draft: dict, edits, resume_text: str = "") -> tuple:
    """The draft with each exact edit applied where its old text occurs once, as his drafter applies the reviewer's
    Part A with the Edit tool. Returns (draft, applied, missed): an edit that cannot be applied is never dropped in
    silence; it is listed in missed with why (its text is the original résumé's, is not in the CV, or is in it twice)."""
    draft = json.loads(json.dumps(draft or {}))
    applied, missed = 0, []
    for edit in edits or []:
        if not isinstance(edit, dict):
            continue
        old, new = rs._text(edit.get("old_string")), rs._text(edit.get("new_string"))
        if not old or old == new:
            continue
        # Quoted with the list marker or indent the reader saw in front of the bullet.
        old = _without_the_marker(old.strip())
        note = _note_in(new, old)
        if note:
            missed.append({"old_string": old[:200], "why": f"the replacement is not CV text ({note})"})
            continue
        if "\n" not in old:
            new = _without_the_marker(new)
        if "\n" in old and _replaced_the_block(draft, old, new):
            applied += 1
            continue
        if _replaced_a_competency_line(draft, old, new):
            applied += 1
            continue
        places = [place for place in _text_places(draft) if old in place[0][place[1]]]
        if len(places) != 1 or places[0][0][places[0][1]].count(old) != 1:
            why = ("found more than once in the CV" if places else
                   "quotes the original résumé, not the CV" if old in resume_text else "not in the CV")
            missed.append({"old_string": old[:200], "why": why})
            continue
        holder, key = places[0]
        holder[key] = holder[key].replace(old, new)
        applied += 1
    return draft, applied, missed


_NOTE = re.compile(r"\[[^\]]{8,}\]|\b(?:TODO|FIXME|placeholder)\b", re.IGNORECASE)


def _note_in(new: str, old: str) -> str:
    """Why a replacement is not text for the CV, or "": an editor's note in brackets ("[Reduce this role to 6
    bullets…]") or a placeholder the old text did not have, or one bullet replaced by several lines."""
    note = _NOTE.search(new)
    if note and not _NOTE.search(old):
        return "an editor's note"
    if "\n" in new.strip() and "\n" not in old:
        return "one line replaced by several"
    return ""


def _without_the_marker(text: str) -> str:
    """A bullet without the list marker a model sometimes writes into it ("- Built…", "• Built…")."""
    text = text.strip()
    while text[:2] in ("- ", "• ", "* "):
        text = text[2:].strip()
    return "" if text in ("-", "•", "*") else text


def _bullet_lines(block: str) -> list:
    """The bullets of a quoted block of the CV text, without the role lines cv_as_text writes above them."""
    return [_without_the_marker(line) for line in block.split("\n") if line.strip().startswith(("- ", "• ", "* "))]


def _replaced_the_block(draft: dict, old: str, new: str) -> bool:
    """A quoted run of one role's bullets (often under its role line) replaced by the new run: how the verifier
    trims or merges a role's bullets. Applied only when the run is consecutive bullets of exactly one role."""
    old_bullets, new_bullets = _bullet_lines(old), _bullet_lines(new)
    if not old_bullets:
        return False
    matches = []
    for section in ("experience", "projects"):
        for entry in draft.get(section) or []:
            bullets = entry.get("bullets") if isinstance(entry, dict) else None
            if not isinstance(bullets, list):
                continue
            cleaned = [_without_the_marker(rs._text(bullet)) for bullet in bullets]
            for start in range(len(cleaned) - len(old_bullets) + 1):
                if all(quoted in cleaned[start + n] for n, quoted in enumerate(old_bullets)):
                    matches.append((entry, start))
    if len(matches) != 1:
        return False
    entry, start = matches[0]
    entry["bullets"][start:start + len(old_bullets)] = new_bullets
    return True


def _replaced_a_competency_line(draft: dict, old: str, new: str) -> bool:
    """An edit quoting a competency as the reader saw it ("Label: text") applied to its two fields."""
    for competency in draft.get("core_competencies") or []:
        if not isinstance(competency, dict):
            continue
        label, text = rs._text(competency.get("label")).strip("* "), rs._text(competency.get("text"))
        if _without_the_bold(old) != f"{label}: {text}":
            continue
        new_label, _, new_text = _without_the_bold(_without_the_marker(new)).partition(": ")
        competency["label"], competency["text"] = (new_label, new_text) if new_text else (label, new_label)
        return True
    return False


def _without_the_bold(text: str) -> str:
    return text.replace("**", "").strip()


def _text_places(draft: dict) -> list:
    """Every (holder, key) of the draft whose text the reader sees, so an edit can be found and applied in place."""
    places = [(draft, key) for key in ("headline", "profile_statement") if isinstance(draft.get(key), str)]
    for competency in draft.get("core_competencies") or []:
        if isinstance(competency, dict):
            places += [(competency, key) for key in ("label", "text") if isinstance(competency.get(key), str)]
    for section in ("experience", "projects"):
        for entry in draft.get(section) or []:
            bullets = entry.get("bullets") if isinstance(entry, dict) else None
            if isinstance(bullets, list):
                places += [(bullets, index) for index, bullet in enumerate(bullets) if isinstance(bullet, str)]
    return places


def _kept_where_missing(revised: dict, draft: dict) -> dict:
    """The revised CV, with any part the revision left empty taken from the draft it revised."""
    merged = dict(revised or {})
    for key, value in (draft or {}).items():
        if not merged.get(key):
            merged[key] = value
    return merged


# ── Into our résumé format ──────────────────────────────────────────────────────

_KIND = {"required": "must", "preferred": "nice", "duty": "duty"}


def as_v2_reply(draft: dict, analysis: dict) -> dict:
    """The final CV in the shape focused_v2's assembler reads: profile statement as the summary, competencies as the
    skills (label: value), bullets per role, and the requirement list for the report."""
    requirements = [{"name": rs._text(r.get("requirement")), "kind": _KIND.get(str(r.get("priority")).lower(), "duty"),
                     "has": r.get("status") in ("matched", "adjacent")}
                    for r in (analysis or {}).get("requirements") or [] if isinstance(r, dict)]
    return {
        "header": draft.get("header") if isinstance(draft.get("header"), dict) else {},
        "target_job_title": rs._text((analysis or {}).get("title")),
        "headline": rs._text(draft.get("headline")),
        "professional_summary": rs._text(draft.get("profile_statement")),
        # His labels are bold in LaTeX; the model sometimes writes that as **markdown**, which would print as is.
        "technical_skills": [{"category": rs._text(c.get("label")).strip("* "), "skills": rs._text(c.get("text"))}
                             for c in draft.get("core_competencies") or [] if isinstance(c, dict)],
        "work_experience": [{"role_number": e.get("role_number"),
                             "bullets": [{"text": _without_the_marker(rs._text(b)), "from_bullets": []}
                                         for b in e.get("bullets") or [] if _without_the_marker(rs._text(b))]}
                            for e in draft.get("experience") or [] if isinstance(e, dict)],
        "projects": [{"project_number": p.get("project_number"),
                      "bullets": [{"text": _without_the_marker(rs._text(b)), "from_bullets": []}
                                  for b in p.get("bullets") or [] if _without_the_marker(rs._text(b))]}
                     for p in draft.get("projects") or [] if isinstance(p, dict)],
        "certifications": draft.get("certifications") or [],
        "awards": draft.get("awards") or [],
        "posting_asks_for_a_language": False,
        "requirements": requirements,
        "requirements_met": [],
    }
