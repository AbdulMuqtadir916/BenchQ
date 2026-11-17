"""The extra titles a job search asks for besides the target role (decided 2026-11-17, Q131–Q144).

When a candidate is added, one small AI call takes their target role(s) and suggests 2 related titles employers often
post for the same specialty (live 2026-11-17: "Business Analyst, Business Systems Analyst" for a Senior Business
Analyst; "Machine Learning Engineer, AI Engineer" for a GenAI / LLM Engineer: good fits Match scores 70+ roughly
doubled). They are stored on the candidate's active base's version 1 (`resumes.search_titles`), shown and edited by
hand only on the "Additional candidate details" tab (up to 4; no AI call there), and taken over by a new active base.

The search asks for the target role's own titles and these, 5 at most (`for_search`); the Match counts them as wanted
titles. None made (an older candidate, or a failed call): the target role alone (Q135).

The call: the parser's OpenRouter key (`resume_parse_llm_api_key`), this module's own model and prompt rows
(`search_titles_llm_model`, `search_titles_prompt`, `search_titles_response_format`), thinking off, a strict reply.
Guards on what the AI says: no seniority words, nothing a title the candidate already has, and never a generic title
(Match's `names_no_subject`: "Software Engineer", "Developer" alone). A failure never fails anything: it logs a code.
Logs carry ids, codes and timings, never a title.
"""
import asyncio
import json
import logging
import re

logger = logging.getLogger("benchq.job_search")

MODEL_ROW, PROMPT_ROW, FORMAT_ROW = "search_titles_llm_model", "search_titles_prompt", "search_titles_response_format"
KEY_ROW = "resume_parse_llm_api_key"
MOST_KEPT = 4                   # on the résumé (the BDE may add up to 4)
MOST_SEARCHED = 5               # in one search, the target role's titles first (freehire.me takes 5 alternatives)
AI_TITLES = 2
ROLE = "{target_role}"

DEFAULT_PROMPT = (
    "A recruiter searches job boards for this target role: " + ROLE + "\n"
    "Give the 2 other job titles US employers most often post for the same specialty. They should be common and a "
    "little broader than the target role, never a generic title on its own (not just Software Engineer, Developer, "
    "Engineer, Analyst or Consultant). Leave out seniority words (Senior, Sr, Junior, Jr, Lead, Principal, Staff).")
DEFAULT_FORMAT = json.dumps({"type": "json_schema", "json_schema": {"name": "search_titles", "strict": True, "schema": {
    "type": "object", "additionalProperties": False, "required": ["titles"],
    "properties": {"titles": {"type": "array", "items": {"type": "string"}, "minItems": AI_TITLES,
                              "maxItems": AI_TITLES}}}}})
DEFAULT_MODEL = "openai/gpt-6-luna"

_LEVEL = re.compile(r"\b(senior|sr\.?|junior|jr\.?|lead|principal|staff)\b\s*", re.I)
_SPACES = re.compile(r"\s+")


def plain(title: str) -> str:
    """A title without seniority words or stray punctuation."""
    return _SPACES.sub(" ", _LEVEL.sub("", str(title or "")).replace(",", " ")).strip(" -/|")[:100]


def keep(suggested, target_titles) -> list[str]:
    """The AI's titles that pass the guards: plain, not generic, not one the candidate already has; at most 2."""
    from backend.match.ats_match import names_no_subject
    have = {t.lower() for t in target_titles}
    out: list[str] = []
    for title in suggested or ():
        title = plain(title)
        if title and not names_no_subject(title) and title.lower() not in have and title.lower() not in \
                {o.lower() for o in out}:
            out.append(title)
    return out[:AI_TITLES]


def clean_typed(titles) -> list[str]:
    """What the BDE typed (the details tab): kept as typed, blanks and repeats out, at most 4."""
    out: list[str] = []
    for title in titles or ():
        title = _SPACES.sub(" ", str(title)).strip()[:100]
        if title and title.lower() not in {o.lower() for o in out}:
            out.append(title)
    return out[:MOST_KEPT]


def for_search(target_titles, extra) -> list[str]:
    """The titles one search asks for: the target role's, then the extra ones, 5 at most."""
    out: list[str] = []
    for title in [*(target_titles or ()), *(extra or ())]:
        if title and title.lower() not in {o.lower() for o in out}:
            out.append(title)
    return out[:MOST_SEARCHED]


def _settings(db) -> dict:
    from backend.models.db import Setting
    rows = {row.key: (row.value or "").strip() for row in
            db.query(Setting).filter(Setting.key.in_((MODEL_ROW, PROMPT_ROW, FORMAT_ROW, KEY_ROW)))}
    return {"model": rows.get(MODEL_ROW) or DEFAULT_MODEL, "prompt": rows.get(PROMPT_ROW) or DEFAULT_PROMPT,
            "format": rows.get(FORMAT_ROW) or DEFAULT_FORMAT, "key": rows.get(KEY_ROW) or ""}


async def suggest(roles: list[str], setup: dict, firm_id=None) -> list[str]:
    """The AI's 2 titles for the target role(s), guarded; [] when it can't (no key, a failed call, a bad reply)."""
    from backend.analyzer.llm_client import call_llm
    from backend.analyzer.llm_logger import track_llm_call
    if not roles or not setup.get("key"):
        return []
    prompt = setup["prompt"].replace(ROLE, " | ".join(roles))
    try:
        async with track_llm_call("search_titles", "openrouter", setup["model"], firm_id=firm_id) as tracker:
            reply = await call_llm(prompt=prompt, system="You name job titles. Reply in JSON.", max_tokens=200,
                                   provider="openrouter", model=setup["model"], api_key=setup["key"], effort="",
                                   response_format=json.loads(setup["format"]), reasoning_off=True,
                                   use_fallback=False, attempt_timeout=30)
            tracker.record(reply)
        titles = json.loads(reply.get("text") or "{}").get("titles")
    except Exception as error:      # never fails the caller; the provider's error names a status, not the role
        logger.warning("search titles failed %s", type(error).__name__)
        return []
    return titles if isinstance(titles, list) else []


def active_v1(db, candidate):
    """The candidate's active base's version 1, or None."""
    from backend.auth.scoping import scoped
    from backend.models.candidates import BaseResume
    from backend.models.db import Resume
    return (scoped(db, Resume, candidate.firm_id).join(BaseResume, BaseResume.id == Resume.base_resume_id)
            .filter(Resume.candidate_id == candidate.id, BaseResume.is_active, BaseResume.deleted_at.is_(None),
                    Resume.category == "BASE", Resume.version == 1, Resume.deleted_at.is_(None)).first())


def store(db, candidate, titles) -> bool:
    """`titles` on the active base's v1 (the caller commits). False when the candidate has no active base."""
    from backend.candidates import profile
    row = active_v1(db, candidate)
    if row is None:
        return False
    row.search_titles = list(titles)
    profile.refresh(candidate)
    return True


def generate(firm_id, candidate_id) -> None:
    """The background task after a candidate is added: 2 titles for the target role, stored unless some are already
    there. Never raises."""
    from backend.auth.scoping import scoped
    from backend.job_search import places
    from backend.models.candidates import Candidate
    from backend.models.db import SessionLocal
    try:
        with SessionLocal() as db:
            candidate = scoped(db, Candidate, firm_id).filter(Candidate.id == candidate_id).first()
            if candidate is None or candidate.search_titles is not None or not places.search_role(candidate):
                return
            roles, own, setup = list(candidate.target_roles or []), places.search_titles(candidate), _settings(db)
            db.commit()                     # no connection held during the call
        titles = keep(asyncio.run(suggest(roles, setup, firm_id)), own)
        if not titles:
            return
        with SessionLocal() as db:
            candidate = scoped(db, Candidate, firm_id).filter(Candidate.id == candidate_id).with_for_update().first()
            if candidate is not None and candidate.search_titles is None and store(db, candidate, titles):
                db.commit()
                logger.info("search titles made candidate=%s count=%d", candidate_id, len(titles))
    except Exception as error:
        logger.warning("search titles not made candidate=%s %s", candidate_id, type(error).__name__)
