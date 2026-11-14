"""What a job is mainly about, and whether the candidate has done it: job_listing_api's main-skill check.

A job's main skills are the technologies it weighs most: one its title names weighs TITLE_WEIGHT, and each sentence
of its required part naming one adds SENTENCE_WEIGHT, plus YEARS_WEIGHT when that sentence states years. Every
technology weighing at least half the heaviest is a main skill, so a "Java/Python Developer" has two. The candidate
has used a skill when a role or project of the résumé names it; the skills list alone does not count. A job whose
main-skill weight the candidate has used less than half of is about work they have not done.
"""
import re
from collections import Counter
from functools import lru_cache

from backend.match.keyword_match import HARD_SKILL, _lookup, skills_in

TITLE_WEIGHT, SENTENCE_WEIGHT, YEARS_WEIGHT = 5, 1, 3
USED_ENOUGH = 0.5
# Ways of working and everyday tools: they are never what a job is mainly about.
NEVER_MAIN = frozenset({"Agile", "Scrum", "Jira", "Confluence", "Excel", "Git", "GitHub", "Bitbucket", "SQL", "REST APIs",
                        "Microservices", "CI/CD"})
SENTENCE = re.compile(r"\n+|(?<=[.!?;])\s+")
YEARS = re.compile(r"\d{1,2}\s*\+?\s*(?:years|yrs)", re.I)
# A heading that starts an optional part, and one that ends it.
OPTIONAL_HEADING = re.compile(
    r"(?im)^[\s*#•\-]*(?:nice[- ]to[- ]haves?|preferred(?: qualifications| skills| experience)?|bonus(?: points)?"
    r"|good[- ]to[- ]have|pluses|a plus|desired(?: skills| qualifications)?|what would be (?:great|nice))\b[^\n]{0,40}$")
REQUIRED_HEADING = re.compile(
    r"(?im)^[\s*#•\-]*(?:requirements|required(?: skills| qualifications)?|qualifications|must[- ]haves?"
    r"|what you(?:'ll)? (?:need|bring)|basic qualifications|minimum qualifications|skills|responsibilities"
    r"|about you)\b[^\n]{0,40}$")
# A line opening with an optional label: "Nice-to-have skills: AWS, Kafka".
LABELLED_OPTIONAL = re.compile(
    r"^[\s•*\-]*(secondary|preferred|optional|desirable|bonus|good[- ]to[- ]have|nice[- ]to[- ]have)"
    r"(\s+(skills?|skill ?sets?|qualifications?|requirements?|experience))?\s*[:\-–]", re.I)
# A list offering alternatives: "C++, C#, Java, or Python", "Flask (Python) or .NET (C#)".
_LIST_WORD = r"[\w.#+/-]+(?:\s*\([^()\n]{1,30}\))?"
_LIST_ITEM = rf"{_LIST_WORD}(?:[ \t]{_LIST_WORD}){{0,3}}"
OR_LIST = re.compile(rf"(?:{_LIST_ITEM}\s*,\s*)*{_LIST_ITEM},?\s+(?:and/)?or\s+{_LIST_ITEM}", re.I)
_HAS_OR = re.compile(r"\s(?:and/)?or\s", re.I)


def technologies(text: str) -> set:
    """The dictionary's technologies (hard skills) the text names, by standard name.

    Only the dictionary's hand-written names count (they carry a capital: "Java", "SAP", "Large Language Models").
    Its Stack Overflow tags are lower case and many are everyday words ("del", "calc", "oop"); a tag that extends a
    hand-written name counts as that name ("java-server" and "java-8" are Java), and any other tag is left out.
    A posting's sentences are read several times (its weights, its requirement lines, its lists of alternatives), so
    each text's answer is kept; a new set is returned each time, so a caller can change it freely.
    """
    return set(_technologies((text or "").strip(" \t•*-–·")))     # a bullet mark is no part of a name


@lru_cache(maxsize=50_000)
def _technologies(text: str) -> frozenset:
    out = set()
    for name, found in skills_in(text).items():
        if found["type"] != HARD_SKILL:
            continue
        if name != name.lower():
            out.add(name)
            continue
        entry = _lookup([name.split("-")[0]]) if "-" in name else None
        if entry and entry[0] != entry[0].lower():
            out.add(entry[0])
    return frozenset(out)


def used_in_roles(resume: dict) -> frozenset:
    """The technologies a role or project of the résumé names: its title, description or bullets."""
    entries = [*((resume or {}).get("experience") or []), *((resume or {}).get("projects") or [])]
    text = "\n".join(" ".join([str(e.get("title") or e.get("name") or ""), str(e.get("description") or ""),
                               str(e.get("technologies") or ""), *map(str, e.get("bullets") or [])])
                     for e in entries if isinstance(e, dict))
    return frozenset(technologies(text))


def required_part(description: str) -> str:
    """The description without its optional sections."""
    if not OPTIONAL_HEADING.search(description):
        return description
    kept, skipping = [], False
    for line in description.splitlines():
        if OPTIONAL_HEADING.match(line):
            skipping = True
            continue
        if REQUIRED_HEADING.match(line):
            skipping = False
        if not skipping:
            kept.append(line)
    return "\n".join(kept)


def _named(text: str, extra_names) -> set:
    """The dictionary's technologies in the text, plus each extra name the text writes (any case, as a whole word)."""
    lowered = text.lower()
    return technologies(text) | {n for n in extra_names
                                 if re.search(rf"(?<![a-z0-9]){re.escape(n.lower())}(?![a-z0-9])", lowered)}


def job_weights(title: str, description: str, company: str = "", extra_names=()) -> Counter:
    """How much each technology the job asks for weighs: the title's TITLE_WEIGHT, each required sentence's
    SENTENCE_WEIGHT plus YEARS_WEIGHT when it states years. extra_names are technologies outside the dictionary
    (the candidate's own) that are looked for too. Optional sections and the employer's own name are left out."""
    weights = Counter(dict.fromkeys(_named(title, extra_names), TITLE_WEIGHT))
    for sentence in SENTENCE.split(required_part(description)):
        if LABELLED_OPTIONAL.match(sentence):
            continue
        extra = YEARS_WEIGHT if YEARS.search(sentence) else 0
        for name in _named(sentence, extra_names):
            weights[name] += SENTENCE_WEIGHT + extra
    # The employer's own name is not the job's skill ("MongoDB" at MongoDB), unless the title names it too.
    for name in _named(company, extra_names) - _named(title, extra_names):
        weights.pop(name, None)
    return weights


def coverage_detail(title: str, description: str, company: str, has: frozenset, extra_names=()) -> tuple:
    """(share of the job's technology weight the candidate has, the missing technologies heaviest first, how many
    technologies the job names); (None, [], 0) when the posting names no technology."""
    weights = job_weights(title, description, company, extra_names)
    total = sum(weights.values())
    if not total:
        return None, [], 0
    share = sum(w for name, w in weights.items() if name in has) / total
    missing = [name for name, _ in sorted(weights.items(), key=lambda item: (-item[1], item[0])) if name not in has]
    return share, missing, len(weights)


def coverage(title: str, description: str, company: str, has: frozenset, extra_names=()) -> tuple:
    """(share of the job's technology weight the candidate has, the missing technologies heaviest first), or
    (None, []) when the posting names no technology."""
    share, missing, _ = coverage_detail(title, description, company, has, extra_names)
    return share, missing


def main_skills(title: str, description: str, company: str = "") -> dict:
    """{technology: weight} for the job's main skills, heaviest first; empty when nothing stands out."""
    weights = job_weights(title, description, company)
    for name in NEVER_MAIN:
        weights.pop(name, None)
    top = max(weights.values(), default=0)
    if top <= SENTENCE_WEIGHT:
        return {}
    return {name: w for name, w in sorted(weights.items(), key=lambda item: (-item[1], item[0])) if w >= top / 2}


def _alternatives(description: str) -> list:
    """Technologies a sentence offers as alternatives; an "and" ends the list."""
    groups = []
    for sentence in SENTENCE.split(required_part(description)):
        if not _HAS_OR.search(sentence):        # OR_LIST backtracks heavily; most sentences offer no alternative
            continue
        for match in OR_LIST.finditer(sentence):
            found = technologies(re.split(r"\band\b(?!/or)", match.group())[-1])
            if len(found) >= 2:
                groups.append(found)
    return groups


def main_skills_used(title: str, description: str, company: str, used: frozenset) -> tuple:
    """(share of the main-skill weight the candidate has used, main skills they have not), or (1.0, []) when the job
    has no main skills. One of a list of alternatives counts for every main skill in it."""
    weights = main_skills(title, description, company)
    if not weights:
        return 1.0, []
    held = {name for name in weights if name in used}
    for group in _alternatives(description):
        if group & used:
            held |= group & weights.keys()
    share = sum(weights[name] for name in held) / sum(weights.values())
    return share, [name for name in weights if name not in held]
