"""How well a job title fits a title the candidate wants, and how many years of experience a posting requires.

Plain code shared by the job search's ranking (rank.py) and the ATS match (backend/analyzer/ats_match.py). Its only
import is job_quality.role_kinds, so a copy needs job_quality.py beside it and nothing else.
"""
import re

from backend.match.job_quality import role_kinds

# The title is a gate: a job whose title fits the candidate's less than this is capped under the shown line, so
# technologies can only lift a job whose title already fits (the 2026-11-09 Reach Media cloud job: title 11%, 43 points).
TITLE_GATE = 0.4
# A job asking this much more experience than the candidate has is capped under the low-score line: more than
# EXPERIENCE_GAP_YEARS over, and more than EXPERIENCE_GAP_SHARE of the candidate's years over (16 asked of 8.4 held,
# 7 of 3.4, 3 of 0.8). The 2026-11-08 fit test showed 11 such jobs scoring 55-70 with only the penalty.
EXPERIENCE_GAP_YEARS, EXPERIENCE_GAP_SHARE = 2, 0.4
# Words that open a title without naming its subject: "Big" in "Big Data Engineer" must not match "Big Spring, TX".
# They count as shared only when the wanted title has no other subject word ("Cloud Engineer" keeps "Cloud").
WEAK_WORDS = frozenset({"big", "cloud", "applied", "digital", "global", "advanced", "new", "next", "smart"})
_FILLER = {"senior", "sr", "junior", "jr", "lead", "staff", "principal", "and", "of", "the", "for",
           "i", "ii", "iii", "iv", "with", "&", "-", "/"}
# Years tied to experience ("5+ years of experience", "experience: 8-10 years", "Need 12+ years"), not a company's age.
# A range is read as its lower end, whatever dash or word joins it ("2-4", "2–4", "2 to 4 years").
_TO = r"(?:-|–|—|to)"
_EXPERIENCE_YEARS_RE = re.compile(
    rf"(?:(\d{{1,2}})\s*(?:\+|plus)?\s*(?:{_TO}\s*\d{{1,2}}\s*)?(?:years|yrs)\b[^.\n]{{0,60}}?\b(?:experience\w*|exp)\b)"
    rf"|(?:\b(?:experience\w*|exp)\b[^.\n]{{0,30}}?(\d{{1,2}})\s*(?:\+|plus)?\s*(?:{_TO}\s*\d{{1,2}}\s*)?(?:years|yrs)\b)"
    r"|(?:(\d{1,2})\s*(?:\+|plus)\s*(?:years|yrs)\s+(?:of|in)\b)"
    r"|(?:\bneed\s+(\d{1,2})\s*\+?\s*(?:years|yrs)\b)"
    r"|(?:(\d{1,2})\s*\+?\s*(?:years|yrs)\s*(?:are\s*|is\s*)?(?:required|minimum|min\b|must))"
    r"|(?:\bminimum\s+(?:of\s+)?(\d{1,2})\s*\+?\s*(?:years|yrs)\b)", re.I)
# A line that offers rather than requires: "preferred", "a plus", "a strong plus", "valued", "an advantage".
PREFERRED = re.compile(r"prefer|nice to have|\b(?:a|strong|big|huge|great)\s+plus\b|bonus|ideally|desired|desirable"
                       r"|optional|\bvalued\b|advantage(?:ous)?\b|\bbeneficial\b|\bhelpful\b", re.I)


def experience_asked(title: str, description: str) -> int | None:
    """The most years of experience a posting requires (preferred lines left out); None when it states none."""
    asked = []
    for line in [title or "", *re.split(r"\n+|(?<=[.;])\s+", description or "")]:
        if PREFERRED.search(line):
            continue
        asked += [int(n) for groups in _EXPERIENCE_YEARS_RE.findall(line) for n in groups if n]
    asked = [n for n in asked if n <= 30]
    return max(asked) if asked else None


# Spellings of one title read alike: "Fullstack Java Developer" is "Full Stack Java Developer", "ML" is machine learning.
_SPELLINGS = ((re.compile(r"\bfull[- ]?stack\b"), "full stack"), (re.compile(r"\bback[- ]?end\b"), "backend"),
              (re.compile(r"\bfront[- ]?end\b"), "frontend"), (re.compile(r"\bml\b"), "machine learning"),
              (re.compile(r"\bgen[- ]?ai\b"), "generative ai"), (re.compile(r"\bsr\.?(?=\s)"), "senior"),
              (re.compile(r"\bswe\b"), "software engineer"))


def _plain(title: str) -> str:
    text = (title or "").lower()
    for pattern, spelled in _SPELLINGS:
        text = pattern.sub(spelled, text)
    return text


def _words(text: str) -> set:
    return {w for w in re.findall(r"[a-z0-9+#.]+", _plain(text)) if w not in _FILLER and len(w) > 1}


# Words that name a kind of job, not what it is about: matching only "developer" is not a match for "Python Developer".
_GENERIC = {"developer", "engineer", "engineering", "software", "programmer", "full", "stack", "fullstack"}
GENERIC_WORD_WEIGHT = 0.3
# A title that names a different KIND of role than the wanted one ("Business Development Representative" for "Business
# Analyst", "Cloud Architect" for "Cloud Data Engineer") keeps this share of the words it shares.
OTHER_KIND_SHARE = 0.35
# A job title holding the wanted title's subject ("Java" in "Java Full Stack Developer") and naming the same kind of
# role ("Developer", "Engineer") is a title the candidate would take, whatever else it says or leaves out.
SUBJECT_AND_KIND_FIT = 0.85


# Where a title's parts divide: "Sr. Mechanical Design Engineer, Data Center Design Engineering". Not a slash (one role's
# alternatives) and not brackets ("Software Engineer (Python)" names the role's subject).
_SEGMENT = re.compile(r"\s*(?:,|;|\||:|\s[-–—]\s)\s*")
_ROLE_WORDS = {"engineer", "developer", "programmer", "analyst", "architect", "scientist", "administrator", "consultant",
               "specialist", "designer", "manager", "lead", "director"}


def _subject(words: set) -> set:
    return words - _GENERIC - WEAK_WORDS - _ROLE_WORDS


def _role_part(title: str, want: set) -> str:
    """The part of the title that names the role, when it has a subject of its own that is not the wanted one; else the
    whole title. "Sr. Mechanical Design Engineer, Data Center Design Engineering" is a mechanical engineer, whatever
    the rest says, so "Data" there does not make it a "Data Engineer"; "Senior Software Engineer, Python" has no subject
    before its comma, so "Python" counts."""
    parts = [p for p in _SEGMENT.split(title or "") if p.strip()]
    head = next((p for p in parts if role_kinds(p)), None)
    if len(parts) < 2 or head is None:
        return title
    own = _subject(_words(head))
    return head if own and not own & _subject(want) else title


def title_variants(title: str) -> list:
    """The titles one written title stands for: "A | B" is two, "AI/LLM Engineer" is "AI Engineer" or "LLM
    Engineer", and "GenAI" is an AI title too."""
    out = []
    for part in re.split(r"\s*[|;]\s*", title or ""):
        part = part.strip()
        if not part:
            continue
        out.append(part)
        m = re.search(r"([\w.+#-]+)\s*/\s*([\w.+#-]+)", part)
        if m and m.group(0).lower().replace(" ", "") not in ("ci/cd", "ui/ux", "tcp/ip"):
            out += [(part[:m.start()] + side + part[m.end():]).strip() for side in (m.group(1), m.group(2))]
    out += [re.sub(r"\bgen\s*ai\b", "AI", t, flags=re.I) for t in out if re.search(r"\bgen\s*ai\b", t, re.I)]
    return list(dict.fromkeys(t for t in out if t))


def title_fit(title: str, wanted: str) -> float:
    """0-1: how well the job title fits one title the candidate wants."""
    if _plain(wanted) in _plain(title):
        return 1.0
    want = _words(wanted)
    if not want:
        return 0.0
    title = _role_part(title, want)
    # A title made only of generic words ("Software Engineer") weighs them fully.
    weight = {w: (GENERIC_WORD_WEIGHT if w in _GENERIC and not want <= _GENERIC else 1.0) for w in want}
    shared = want & _words(title)
    if WEAK_WORDS and want - _GENERIC - WEAK_WORDS:        # the title has a subject of its own: weak words do not count
        shared -= WEAK_WORDS
    fit = sum(weight[w] for w in shared) / sum(weight.values())
    wanted_kinds, job_kinds = role_kinds(wanted), role_kinds(title)
    if wanted_kinds and job_kinds and not wanted_kinds & job_kinds:
        fit *= OTHER_KIND_SHARE
    elif wanted_kinds & job_kinds:
        subject = want - _GENERIC - WEAK_WORDS
        if subject and subject <= _words(title):
            fit = max(fit, SUBJECT_AND_KIND_FIT)
    return fit
