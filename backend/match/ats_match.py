"""The ATS match: how well one résumé matches one job posting, 0-100, in plain code. No model; about 5 ms a job.

It scores what an applicant tracking system and a recruiter's search can see: the posting's technologies named in
the résumé (and whether a role used them or only the skills list names them), the job title, the posting's
requirement lines covered, the years asked against the years the roles' dates add up to, the level, the degree, the
certifications, the soft skills and the industry. Every part is shown with its points and its reason, and the
matched and missing keywords are listed, so a score can be argued with line by line.

The rules come from the ATS scoring rules file (sections 1, 7, 10): a skill used in a role counts in full and one
only listed 0.4 (rule 1.4); a list of alternatives is one requirement met by any one of them (1.8); penalties, never
knockouts (1.7): the total is scaled by the share of the job's main skills the résumé has used, keeping no less than
40%, and capped at CAP when the title does not fit, the job is another kind of role, it asks far more years than the
candidate has, or its level is two rungs away. A part the posting says nothing about (no degree asked, no years) is
left out and its points shared among the others. Keyword matching is literal with the safe folds only (10.4): the
skills dictionary's other spellings of the same tool, plurals, case; a narrower name never counts for a broader one.

Built 2026-11-11 for BenchQ's bench-sales search, where every one of a candidate's hundred jobs needs a score at
once. Its imports are plain-code modules with no imports beyond each other, the skills dictionary and the posting
clean-up, so the whole closure can be copied to another project file by file.
"""
import re
from datetime import date
from types import SimpleNamespace

from backend.match import ats_match_terms as terms
from backend.analyzer.job_requirements import clean_job_text
from backend.match.keyword_match import OTHER_KEYWORD, SOFT_SKILL, skills_in
from backend.match.match_words import DEGREE_LEVELS, _contains, _credit, _degree_levels_in, folded_words
from backend.match import clearance, seniority, work_auth
from backend.match.job_quality import is_junk_poster, other_role, outside_country
from backend.match.main_skills import (LABELLED_OPTIONAL, NEVER_MAIN, OPTIONAL_HEADING, REQUIRED_HEADING,
                                            SENTENCE, SENTENCE_WEIGHT, _alternatives, job_weights, technologies)
from backend.match.title_fit import title_variants
from backend.match.title_fit import (EXPERIENCE_GAP_SHARE, EXPERIENCE_GAP_YEARS, PREFERRED, TITLE_GATE,
                                          experience_asked, title_fit)

# The lab's v18 ("match-1.6-lab", 2026-11-13) with BenchQ's changes (backend/UPSTREAM.md). A stored score
# whose version differs is worked out again (decided 2026-11-14, Q49).
VERSION = "match-1.6+benchq.1"
# What each part is worth when the posting states all of them; a part it does not state is left out.
WEIGHTS = {"hard_skills": 35, "title": 20, "requirement_lines": 10, "experience": 10, "seniority": 5,
           "education": 5, "certifications": 5, "soft_skills": 5, "industry": 5}
LABELS = {"hard_skills": "Technologies the job asks for", "title": "Job title", "requirement_lines": "Requirement lines covered",
          "experience": "Years of experience", "seniority": "Level", "education": "Degree",
          "certifications": "Certifications", "soft_skills": "Soft skills and other keywords", "industry": "Industry"}
LISTED_CREDIT = 0.4                 # a technology only the skills list names (ATS rules 1.4)
REQUIRED_LINE_WEIGHT, PREFERRED_LINE_WEIGHT = 2, 1
NICE_TO_HAVE_WEIGHT = 0.5           # a technology only a preferred line names, against 1 for a required sentence
# How much of the total is kept by the share of the job's main skills the résumé has used (the rubric scorer's steps).
KEPT_BY_MAIN_SKILLS = ((0.25, 0.4), (0.5, 0.6), (0.75, 0.85), (1.01, 1.0))
CAP = 40                            # the most a job scores when a cap applies: under the page's low-score line
SLIGHTLY_UNDER = 0.8                # years held at least this share of the years asked: "slightly below"
FAR_OVER_QUALIFIED = 2.0            # held more than this many times the years asked, when 3+ are asked
MOST_LISTED = 12
# Words that name a kind of job or its level, never its subject (lab v17): a title made only of these names no subject.
_GENERIC_TITLE = frozenset("""member of technical staff software systems system engineer engineering developer development
    programmer application applications app web full stack fullstack back end backend front frontend senior sr junior jr
    lead principal associate mid level consultant specialist analyst support services service team remote hybrid onsite
    contract the and a an with for in to or i ii iii iv v vi""".split())
_LANGUAGES = ("korean|japanese|mandarin|chinese|cantonese|spanish|french|german|portuguese|vietnamese|arabic|russian|"
              "italian|hindi|telugu|tamil|urdu|punjabi|bengali|gujarati|marathi|polish|dutch|turkish|hebrew|thai|tagalog")
_LANGUAGE_NEEDED = re.compile(
    rf"\b(?:bilingual|fluent|fluency|native|speak(?:s|ing)?|speaker)\b[^.\n]{{0,50}}?\b({_LANGUAGES})\b"
    rf"|\b({_LANGUAGES})\b[^.\n]{{0,25}}?\b(?:bilingual|fluent|fluency|speaking|speaker|required|mandatory)\b", re.I)


def names_no_subject(title: str) -> bool:
    words = [w for w in re.findall(r"[a-z]+", (title or "").lower())]
    return bool(words) and all(w in _GENERIC_TITLE for w in words)


def other_subject(title: str, wanted: list) -> bool:
    """Whether the title names a subject of its own that shares no word with any wanted title."""
    words = {w for w in re.findall(r"[a-z0-9+#]+", (title or "").lower()) if w not in _GENERIC_TITLE and not w.isdigit()}
    wanted_words = {w for t in wanted for w in re.findall(r"[a-z0-9+#]+", (t or "").lower())}
    return bool(words) and not words & wanted_words


def languages_needed(title: str, description: str) -> set:
    found = set()
    for line in re.split(r"\n+|(?<=[.!?])\s+", f"{title}\n{description}"):
        if PREFERRED.search(line):
            continue
        for m in _LANGUAGE_NEEDED.finditer(line):
            found.add((m.group(1) or m.group(2)).lower())
    return found
# Years asked without the word "experience": "2+ years building production software", "5 years designing APIs".
_YEARS_DOING = re.compile(r"(\d{1,2})\s*(?:(?:-|–|—|to)\s*\d{1,2}\s*)?\+?\s*(?:years|yrs)\s+(?:of\s+)?(?:building|developing|designing|writing|"
                          r"delivering|working|leading|managing|hands-on|in\s+(?:a|an|the)\b)", re.I)
# A degree line that accepts experience instead: no knockout.
_OR_EQUIVALENT = re.compile(r"(?:or|/)\s*(?:an?\s+)?(?:equivalent|relevant|comparable|related)\b", re.I)
MASTERS_LEVEL = 3                   # DEGREE_LEVELS' position of a Master's; only this level or above knocks out
LOWER_DEGREE_SHARE = 0.5            # a lower degree than asked, or none where the posting accepts experience instead


# ── The posting, read once per job ──────────────────────────────────────────────

def posting_lines(description: str) -> list:
    """[(sentence, preferred)] for the sentences of the posting, each marked as from a required or a preferred part."""
    lines, preferred = [], False
    for line in (description or "").splitlines():
        if OPTIONAL_HEADING.match(line):
            preferred = True
            continue
        if REQUIRED_HEADING.match(line):
            preferred = False
        for sentence in SENTENCE.split(line):
            sentence = sentence.strip(" \t•*-–·")
            if sentence:
                lines.append((sentence, preferred or bool(LABELLED_OPTIONAL.match(sentence))
                              or bool(PREFERRED.search(sentence))))
    return lines


def technology_weights(title: str, description: str, company: str, lines: list, named: dict) -> dict:
    """How much each technology the posting names weighs: the job search's weights for the title and the required
    part (title 5, a required sentence 1, +3 with years), plus NICE_TO_HAVE_WEIGHT for one only a preferred line names."""
    weights = dict(job_weights(title, description, company))
    for text, preferred in lines:
        if preferred:
            for name in named[text]:
                weights.setdefault(name, NICE_TO_HAVE_WEIGHT)
    return weights


def main_skills_used(weights: dict, groups: list, used: frozenset) -> tuple:
    """(share of the job's main-skill weight the résumé's roles have used, the main skills they have not), by the
    job search's rule: a main skill weighs at least half the heaviest; (1.0, []) when nothing stands out."""
    main = {name: w for name, w in weights.items() if name not in NEVER_MAIN}
    top = max(main.values(), default=0)
    if top <= SENTENCE_WEIGHT:
        return 1.0, []
    main = {name: w for name, w in main.items() if w >= top / 2}
    held = {name for name in main if name in used or terms.family_members_held(name, used)}
    for group in groups:
        if group & used:
            held |= group & main.keys()
    return sum(main[n] for n in held) / sum(main.values()), [n for n in main if n not in held]


# ── The parts ───────────────────────────────────────────────────────────────────

def _hard_skills(facts: terms.ResumeFacts, weights: dict, groups: list) -> dict:
    if not weights:
        return {"share": None, "detail": "the posting names no technology", "used": [], "listed": [], "missing": []}
    held = {name: 1.0 for name in weights if name in facts.used or terms.family_members_held(name, facts.used)}
    held.update({name: LISTED_CREDIT for name in weights if name not in held
                 and (name in facts.listed or terms.family_members_held(name, facts.listed))})
    for group in groups:                                # one of a list of alternatives counts for all of them
        best = max((held.get(name, 0.0) for name in group), default=0.0)
        for name in group & weights.keys():
            held[name] = max(held.get(name, 0.0), best)
    total = sum(weights.values())
    share = sum(weights[name] * credit for name, credit in held.items()) / total
    heaviest_first = sorted(weights, key=lambda n: (-weights[n], n))
    used = [n for n in heaviest_first if held.get(n) == 1.0]
    listed = [n for n in heaviest_first if 0 < held.get(n, 0) < 1.0]
    missing = [n for n in heaviest_first if n not in held]
    detail = (f"{len(used)} used in a role, {len(listed)} only listed, {len(missing)} missing of {len(weights)}"
              + (f"; missing: {', '.join(missing[:6])}" if missing else ""))
    return {"share": share, "detail": detail, "used": used, "listed": listed, "missing": missing}


def _title(facts: terms.ResumeFacts, title: str, wanted: list) -> dict:
    fits = [(title_fit(title, t), t) for t in wanted if t]
    fit, best = max(fits, default=(0.0, ""))
    return {"share": fit, "detail": f"'{title}' fits '{best}' {fit:.0%}" if best else "no title to compare",
            "fit": fit}


def _requirement_lines(facts: terms.ResumeFacts, lines: list, groups: list, named: dict) -> dict:
    rows = []
    for text, preferred in lines:
        if not named[text]:
            continue
        credit = 0.0
        for name in named[text]:
            if name in facts.used or any(name in g and g & facts.used for g in groups):
                credit = 1.0
                break
            if name in facts.listed or any(name in g and g & facts.listed for g in groups):
                credit = max(credit, LISTED_CREDIT)
        rows.append({"line": text[:160], "preferred": preferred, "credit": credit,
                     "weight": PREFERRED_LINE_WEIGHT if preferred else REQUIRED_LINE_WEIGHT})
    if not rows:
        return {"share": None, "detail": "no requirement line names a technology", "lines": []}
    share = sum(r["credit"] * r["weight"] for r in rows) / sum(r["weight"] for r in rows)
    met = sum(1 for r in rows if r["credit"] == 1.0)
    return {"share": share, "detail": f"{met} of {len(rows)} lines shown in a role", "lines": rows}


def _experience(facts: terms.ResumeFacts, title: str, description: str, years_held: float | None) -> dict:
    doing = [int(n) for line in description.splitlines() if not PREFERRED.search(line)
             for n in _YEARS_DOING.findall(line) if int(n) <= 30]
    asked = max([n for n in (experience_asked(title, description), *doing) if n is not None], default=None)
    held = years_held
    if asked is None:
        return {"share": None, "detail": "the posting states no years", "asked": None, "held": held, "far_over": False}
    if held is None:
        return {"share": None, "detail": f"asks {asked}+ years; the résumé's roles carry no dates", "asked": asked,
                "held": None, "far_over": False}
    far_over = asked > held + max(EXPERIENCE_GAP_YEARS, EXPERIENCE_GAP_SHARE * held)
    if held >= asked:
        share = 0.7 if asked >= 3 and held > FAR_OVER_QUALIFIED * asked else 1.0
        why = f"asks {asked}+ years; the résumé covers {held:g}" + (" (far over)" if share < 1 else "")
    elif held >= SLIGHTLY_UNDER * asked:
        share, why = 0.6, f"asks {asked}+ years; the résumé covers {held:g}, slightly under"
    else:
        share, why = 0.0, f"asks {asked}+ years; the résumé covers {held:g}"
    return {"share": share, "detail": why, "asked": asked, "held": held, "far_over": far_over}


def _seniority(facts: terms.ResumeFacts, title: str, label: str, description: str, wanted: list,
               years_held: float | None) -> dict:
    job = seniority.of_job(title, label, description)
    candidate = seniority.of_candidate(wanted, facts.latest_role, years_held)
    if job is None or candidate is None:
        return {"share": None, "detail": "level not stated", "steps": 0, "capped": False}
    steps, why = seniority.gap(job, candidate)
    if steps is None:
        return {"share": 0.0, "detail": why, "steps": None, "capped": True}
    share = 1.0 if steps == 0 else 0.5 if abs(steps) == 1 else 0.0
    return {"share": share, "detail": why, "steps": steps, "capped": abs(steps) >= seniority.FAR_APART}


def _education(facts: terms.ResumeFacts, lines: list) -> dict:
    """The degree the posting's lines ask for against the highest one the résumé's education names. A line naming two
    levels ("BS/MS", "Bachelor's or Master's") asks for the lower; a Master's or doctorate that a required line asks
    for outright (no "or equivalent experience") and the résumé does not show is a knockout for a recruiter's screen."""
    required = [(min(levels), text) for text, preferred in lines if not preferred and (levels := _degree_levels_in(text))]
    offered = [(min(levels), text) for text, preferred in lines if preferred and (levels := _degree_levels_in(text))]
    if not required and not offered:
        return {"share": None, "detail": "the posting asks for no degree", "asked": None, "held": None, "knockout": ""}
    asked = max(level for level, _ in required or offered)
    held = facts.degree
    name = lambda level: DEGREE_LEVELS[level - 1][0] if level else "no degree"
    instead = any(_OR_EQUIVALENT.search(text) for _, text in required or offered)
    if held >= asked:
        share = 1.0
    elif held or instead:
        share = LOWER_DEGREE_SHARE
    else:
        share = 0.0
    outright = [level for level, text in required if level >= MASTERS_LEVEL and not _OR_EQUIVALENT.search(text)]
    knockout = f"requires {name(max(outright))}; the résumé shows {name(held)}" if outright and max(outright) > held else ""
    return {"share": share, "detail": f"asks for {name(asked)}" + (" (preferred)" if not required else "")
            + f"; the résumé shows {name(held)}", "asked": name(asked), "held": name(held), "knockout": knockout}


def _certifications(facts: terms.ResumeFacts, title: str, lines: list) -> dict:
    asked = terms.certifications_asked([(title, False), *lines])     # one named in the title is required
    if not asked:
        return {"share": None, "detail": "the posting names no certification", "found": [], "missing": [], "knockout": ""}
    found, missing, earned, total, required_missing, required = [], [], 0.0, 0.0, [], 0
    for name, preferred in asked:
        weight = PREFERRED_LINE_WEIGHT if preferred else REQUIRED_LINE_WEIGHT
        total += weight
        required += not preferred
        if _contains(facts.words, folded_words(name)) or re.search(re.escape(name), facts.text, re.I):
            found.append(name)
            earned += weight
        else:
            missing.append(name + (" (preferred)" if preferred else ""))
            if not preferred:
                required_missing.append(name)
    knockout = f"requires {', '.join(required_missing[:3])}, not in the résumé" \
        if required and len(required_missing) == required else ""
    return {"share": earned / total, "detail": f"{len(found)} of {len(asked)} named in the résumé"
            + (f"; missing: {', '.join(missing[:4])}" if missing else ""), "found": found, "missing": missing,
            "knockout": knockout}


def eligibility_flags(title: str, description: str, candidate: dict, location: str = "") -> list:
    """What a recruiter screens out before reading: a job outside the candidate's country, a clearance they do not
    hold, citizens or green-card holders only, no sponsorship, no H-1B transfers, no C2C. Each flag says whether it
    caps the score (a known conflict) or only warns (the candidate's side is not recorded).

    `candidate` may carry "country" (ISO alpha-2, default US), "clearance" (the one held, "" for none; left out when
    not recorded), "work_auth", "needs_sponsorship", "needs_transfer" and "employment_types"."""
    text, flags = f"{title}\n{description}", []
    # BenchQ: a country that isn't known (None) is never assumed to be the US, so no job reads as abroad (no default
    # country, PR 7); left out of `candidate`, it is the US, as upstream.
    country = str(candidate.get("country", "US") or "").upper()
    abroad = country and outside_country(SimpleNamespace(title=title, location=location, description=description), country)
    if abroad:
        flags.append({"flag": "outside the country", "capped": True,
                      "detail": f"in or paid for {abroad}, outside {country}"})
    auth = str(candidate.get("work_auth") or "")
    needed = clearance.required(title, description)
    if needed:
        name = clearance.NAMES[needed]
        held = candidate.get("clearance")
        if held is not None:                       # recorded: "" is none
            if clearance.rank(str(held)) < clearance.rank(needed):
                flags.append({"flag": "clearance", "capped": True, "detail": f"needs an active {name} clearance; the "
                              f"candidate holds {clearance.NAMES.get(str(held), str(held)).lower() if held else 'none'}"})
        elif auth and not work_auth.is_citizen(auth):   # only a US citizen can hold one
            flags.append({"flag": "clearance", "capped": True,
                          "detail": f"needs an active {name} clearance, which only a US citizen holds; the "
                                    f"candidate's status is {auth}"})
        else:
            flags.append({"flag": "clearance", "capped": False,
                          "detail": f"needs an active {name} clearance; whether the candidate holds one is not recorded"})
    elif work_auth.CITIZENS_ONLY.search(text):     # a clearance already says citizens only: one flag for one fact
        flags.append({"flag": "citizens only", "capped": bool(auth) and not work_auth.is_citizen(auth),
                      "detail": "US citizens only" + (f"; the candidate's status is {auth}" if auth else "")})
    elif work_auth.GREEN_CARD_ONLY.search(text):
        flags.append({"flag": "citizens or green card only",
                      "capped": bool(auth) and not (work_auth.is_citizen(auth) or work_auth.is_green_card(auth)),
                      "detail": "US citizens or permanent residents only" + (f"; the candidate's status is {auth}" if auth else "")})
    if auth and not any(f["capped"] for f in flags if f["flag"] in ("clearance", "citizens only", "citizens or green card only")):
        accepted, excluded = work_auth.status_lists(text)
        if accepted and not work_auth.accepts(accepted, auth):
            flags.append({"flag": "statuses listed", "capped": True,
                          "detail": f"takes only {', '.join(sorted(accepted))}; the candidate's status is {auth}"})
        elif work_auth.status_code(auth) in excluded:
            flags.append({"flag": "status excluded", "capped": True,
                          "detail": f"rules out {', '.join(sorted(excluded))}; the candidate's status is {auth}"})
    if work_auth.NO_SPONSORSHIP.search(text) and candidate.get("needs_transfer") and work_auth.TRANSFER_WELCOME.search(text):
        flags.append({"flag": "no new sponsorship", "capped": False,
                      "detail": "no new visa petitions; H-1B transfers are taken, and the candidate needs a transfer"})
    elif work_auth.NO_SPONSORSHIP.search(text):
        needs = candidate.get("needs_sponsorship")
        flags.append({"flag": "no sponsorship", "capped": bool(needs),
                      "detail": "no visa sponsorship" + ("; the candidate needs it" if needs else "")})
    if candidate.get("needs_transfer") and work_auth.NO_TRANSFER.search(text):
        flags.append({"flag": "no visa transfers", "capped": True,
                      "detail": "takes no H-1B transfers; the candidate needs one"})
    if work_auth.corp_to_corp_only(candidate.get("employment_types")) and work_auth.NO_C2C.search(text):
        flags.append({"flag": "no C2C", "capped": True,
                      "detail": "no C2C or third-party candidates; the candidate works only C2C or 1099"})
    return flags


def _soft_skills(facts: terms.ResumeFacts, posting: str) -> dict:
    wanted = {n: m for n, m in skills_in(posting).items() if m["type"] in (SOFT_SKILL, OTHER_KEYWORD)}
    if not wanted:
        return {"share": None, "detail": "the posting names no soft skill", "found": [], "missing": []}
    shown = facts.mentions
    credits = {m["as_written"]: _credit(m["count"], shown.get(n, {}).get("count", 0)) for n, m in wanted.items()}
    found = [n for n, c in credits.items() if c > 0]
    missing = [n for n, c in credits.items() if c == 0]
    return {"share": sum(credits.values()) / len(credits), "detail": f"{len(found)} of {len(credits)} in the résumé"
            + (f"; missing: {', '.join(missing[:5])}" if missing else ""), "found": found, "missing": missing}


def _industry(facts: terms.ResumeFacts, title: str, description: str) -> dict:
    asked = terms.industries_in(f"{title}\n{description}")
    if not asked:
        return {"share": None, "detail": "the posting names no industry", "found": [], "missing": []}
    held = facts.industries
    found = [i for i in asked if i in held]
    return {"share": len(found) / len(asked), "detail": f"{', '.join(found) or 'none'} of {', '.join(asked)}",
            "found": found, "missing": [i for i in asked if i not in held]}


# ── Putting the parts together ──────────────────────────────────────────────────

def points_of(shares: dict) -> tuple:
    """({part: points earned}, {part: points available}): the parts the posting lacks left out, the rest scaled to 100."""
    present = {part: share for part, share in shares.items() if share is not None}
    total = sum(WEIGHTS[part] for part in present)
    if not total:
        return {}, {}
    available = {part: round(100 * WEIGHTS[part] / total, 1) for part in present}
    earned = {part: round(100 * WEIGHTS[part] * share / total, 1) for part, share in present.items()}
    return earned, available


def kept_share(main_share: float) -> float:
    return next(kept for at_most, kept in KEPT_BY_MAIN_SKILLS if main_share < at_most)


def ats_match(resume, job: dict, wanted_titles=(), years_held: float | None = None,
              today: date | None = None, candidate: dict | None = None) -> dict:
    """The match of one résumé (its json_data, or ResumeFacts read once for many jobs) to one job.

    `job` carries "title" and "description" (plain text), and may carry "company", "location" and "seniority" (a
    board's own label). `wanted_titles` are the candidate's target roles; the résumé's own headline and latest role
    title count too. `years_held` overrides the years counted from the roles' dates. `candidate` may carry
    the eligibility flags' fields (see eligibility_flags); left out, those flags warn but never cap.
    """
    facts = resume if isinstance(resume, terms.ResumeFacts) else terms.ResumeFacts.read(resume or {}, today)
    title = str(job.get("title") or "")
    description = clean_job_text(str(job.get("description") or ""))
    company = str(job.get("company") or "")
    wanted = list(dict.fromkeys(v for t in [*(t for t in wanted_titles or () if t), *facts.titles] for v in title_variants(t)))
    years = facts.years if years_held is None else years_held
    lines = posting_lines(description)
    plain_part = terms.without_boilerplate(description)          # benefits and notices name no soft skill or industry
    named = {text: technologies(text) for text, _ in lines}      # each line read once for both parts below
    groups = _alternatives(description)                 # lists of alternatives, read once: the regex is the slow part
    weights = technology_weights(title, description, company, lines, named)

    parts = {
        "hard_skills": _hard_skills(facts, weights, groups),
        "title": _title(facts, title, wanted),
        "requirement_lines": _requirement_lines(facts, lines, groups, named),
        "experience": _experience(facts, title, description, years),
        "seniority": _seniority(facts, title, str(job.get("seniority") or ""), description, wanted, years),
        "education": _education(facts, lines),
        "certifications": _certifications(facts, title, lines),
        "soft_skills": _soft_skills(facts, plain_part),
        "industry": _industry(facts, title, plain_part),
    }
    earned, available = points_of({name: part["share"] for name, part in parts.items()})
    summed = sum(earned.values())

    main_share, main_missing = main_skills_used(weights, groups, facts.used)
    kept = kept_share(main_share)
    caps = []
    if parts["title"]["fit"] < TITLE_GATE and other_subject(title, wanted):   # lab v18: only another subject caps
        caps.append(f"the title fits the candidate's titles only {parts['title']['fit']:.0%}")
    role = other_role(title, wanted)
    if role:
        caps.append(f"{'an' if role[0].lower() in 'aeiou' else 'a'} {role} role, which the candidate's titles are not")
    if parts["experience"]["far_over"]:
        caps.append("asks far more years than the résumé covers")
    if parts["seniority"]["capped"]:
        caps.append(parts["seniority"]["detail"])
    for part in ("education", "certifications"):
        if parts[part]["knockout"]:
            caps.append(parts[part]["knockout"])
    # BenchQ: the résumé's languages also when `resume` is its ResumeFacts (the lab read none then, so any required
    # language capped).
    spoken = {str(x).lower() for x in (facts.resume or {}).get("languages") or []}
    for language in sorted(languages_needed(title, description)):
        if not any(language in s for s in spoken):
            caps.append(f"requires {language.title()}; the résumé lists no {language.title()}")
    if is_junk_poster(company):
        caps.append(f"{company} posts bait or duplicate listings, not jobs")
    flags = eligibility_flags(title, description, candidate or {}, str(job.get("location") or ""))
    caps += [flag["detail"] for flag in flags if flag["capped"]]
    scaled = summed * kept
    score = min(scaled, CAP) if caps else scaled

    hard = parts["hard_skills"]
    return {
        "score": int(round(max(0.0, min(100.0, score)))),
        "score_exact": round(max(0.0, min(100.0, score)), 3),
        "before_scaling": round(summed, 1),
        "kept_share": kept,
        "main_skills_used": round(main_share, 2),
        "main_skills_missing": main_missing[:6],
        "caps": caps,
        "flags": flags,
        "parts": [{"part": name, "label": LABELS[name], "share": None if part["share"] is None else round(part["share"], 3),
                   "points": earned.get(name), "out_of": available.get(name), "detail": part["detail"]}
                  for name, part in parts.items()],
        "keywords": {"used": hard["used"], "listed": hard["listed"][:MOST_LISTED], "missing": hard["missing"]},
        "requirement_lines": {"met": [r["line"] for r in parts["requirement_lines"].get("lines", []) if r["credit"] == 1.0],
                              "missing": [r["line"] for r in parts["requirement_lines"].get("lines", []) if r["credit"] < 1.0]},
        "certifications": {"found": parts["certifications"]["found"], "missing": parts["certifications"]["missing"]},
        "experience": {"asked": parts["experience"]["asked"], "held": parts["experience"]["held"]},
        "version": VERSION,
    }


def ats_match_many(resume: dict, jobs: list, wanted_titles=(), years_held: float | None = None,
                   today: date | None = None, candidate: dict | None = None) -> list:
    """The match of one résumé to each job, the résumé read once."""
    facts = terms.ResumeFacts.read(resume or {}, today)
    return [ats_match(facts, job, wanted_titles, years_held, today, candidate) for job in jobs]
