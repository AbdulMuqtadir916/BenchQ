"""Seniority, plain code: the level a job is at, the level a candidate is looking for, and how far apart they are.

One ladder for both sides: 0 intern, 1 entry, 2 mid, 3 senior, 4 lead, 5 principal, with management as its own track.
A level is a range (lo, hi), since a board's "Mid-Senior level" or a job asking for "8+ years" covers more than one.

A job's level comes from the first of: a level word in its title, the board's own seniority label, the years its
description asks for. A job with none of them is at an unknown level, and an unknown level is never held against it:
plenty of senior jobs are titled just "Java Developer". A candidate's level comes from the level words in the target
titles the record names, then the most recent role's title, then the record's years of experience.

The words carry the meaning only where they name a level: "Staff Software Engineer" is a level, "Staff Accountant" is
a job; "Associate Engineer" is entry level, "Associate Director" is management; "Engineer III" is senior.
"""
import re
from dataclasses import dataclass

INTERN, ENTRY, MID, SENIOR, LEAD, PRINCIPAL = range(6)
NAMES = {INTERN: "intern", ENTRY: "entry", MID: "mid", SENIOR: "senior", LEAD: "lead", PRINCIPAL: "principal"}

# A job one level above the candidate is a stretch role, shown a little lower; one below costs a little more, since a
# step down is rarely what a candidate wants. Two levels or more either way, or a management job for someone who
# is not looking for one, is capped under the page's low-score line: hidden by default, shown on request.
STRETCH_UP_PENALTY = 5
STEP_DOWN_PENALTY = 8
FAR_APART = 2

_ROLE = r"(?:engineer|developer|programmer|analyst|scientist|administrator|architect|consultant|specialist|designer|sre|devops)"
_NUMBER = {"i": ENTRY, "1": ENTRY, "ii": MID, "2": MID, "iii": SENIOR, "3": SENIOR, "iv": LEAD, "4": LEAD,
           "v": PRINCIPAL, "5": PRINCIPAL}
# Checked in this order; a title's level is the highest any of them finds ("Senior Lead" is lead).
_TITLE_WORDS = (
    (re.compile(r"\b(intern|internship|co-?op|trainee|apprentice)\b"), (INTERN, INTERN)),
    (re.compile(r"\b(junior|jr\.?|entry[\s-]?level|graduate|new[\s-]grad|early[\s-]career)\b"), (ENTRY, ENTRY)),
    (re.compile(rf"\bassociate\s+(?:software\s+|data\s+|cloud\s+|\w+\s+)?{_ROLE}"), (ENTRY, MID)),
    (re.compile(r"\b(mid[\s-]?level|intermediate)\b"), (MID, MID)),
    (re.compile(r"\b(senior|sr\.?|snr)\b"), (SENIOR, SENIOR)),
    (re.compile(rf"\b(lead(?!\s+gen)|staff\s+(?:\w+\s+)?{_ROLE}|tech(?:nical)?\s+lead|team\s+lead)\b"), (LEAD, LEAD)),
    (re.compile(r"\bsenior\s+staff\b"), (LEAD, PRINCIPAL)),
    (re.compile(r"\barchitect\b"), (LEAD, PRINCIPAL)),
    (re.compile(r"\b(principal|distinguished|fellow)\b"), (PRINCIPAL, PRINCIPAL)),
)
_TITLE_NUMBER = re.compile(rf"\b{_ROLE}s?\s*,?\s*(?:level\s+)?(i{{1,3}}|iv|v|[1-5])\b")
# A people-management title. "Product Manager", "Project Manager" and the like name a kind of job, not a rung, so
# those phrases are taken out before the management words are looked for.
_MANAGEMENT = re.compile(r"\b(manager|director|head\s+of|vp|vice\s+president|chief|cto|cio|ciso)\b")
_KIND_OF_JOB = re.compile(r"\b(product|project|program|account|delivery|release|scrum|office|case|community)\s+manager\b")

# Board labels ("Mid-Senior level", "Entry Level", "6+ years", ["Senior", "Manager"]).
_LABEL_WORDS = (
    (re.compile(r"intern"), (INTERN, INTERN)),
    (re.compile(r"no prior experience|entry|junior|graduate|new grad"), (ENTRY, ENTRY)),
    (re.compile(r"^associate$"), (ENTRY, MID)),
    (re.compile(r"mid[\s-]*senior"), (MID, LEAD)),
    (re.compile(r"\bmid\b|intermediate"), (MID, MID)),
    (re.compile(r"senior"), (SENIOR, SENIOR)),
    (re.compile(r"\b(lead|staff)\b"), (LEAD, LEAD)),
    (re.compile(r"principal"), (PRINCIPAL, PRINCIPAL)),
)
_LABEL_MANAGEMENT = re.compile(r"director|executive|manager|\bvp\b|head")
_YEARS = re.compile(r"(\d{1,2})\s*\+?\s*(?:years|yrs)", re.I)
# Years a description asks for, a range read as its lower end ("2–4 years" is 2).
_YEARS_ASKED = re.compile(r"(\d{1,2})\s*(?:(?:-|–|—|to)\s*\d{1,2}\s*)?\+?\s*(?:years|yrs)", re.I)


@dataclass(frozen=True)
class Level:
    lo: int
    hi: int
    management: bool = False
    source: str = ""          # where it was read: "title", "board", "years", "target titles", "latest role"

    def text(self) -> str:
        if self.management and self.lo > SENIOR:
            return "management"
        span = NAMES[self.lo] if self.lo == self.hi else f"{NAMES[self.lo]}–{NAMES[self.hi]}"
        return f"{span} (management)" if self.management else span


def _join(found: list) -> tuple | None:
    if not found:
        return None
    return min(lo for lo, _ in found), max(hi for _, hi in found)


_ALTERNATIVES = re.compile(r"\s*/\s*|\s+or\s+")


def from_title(title: str) -> Level | None:
    """The level a title's own words name, or None when it names none. A title offering two roles ("Software
    Engineer / Principal Software Engineer") is at the span of both, and at no stated level when one of them names
    none; a slash inside one role ("Sr. Java/GCP Developer") is not two roles."""
    parts = _ALTERNATIVES.split((title or "").lower())
    roles = [part for part in parts if re.search(_ROLE, part)]
    if len(roles) >= 2:
        levels = [_one_title(part) for part in roles]
        if any(level is None for level in levels):
            return None
        return Level(min(level.lo for level in levels), max(level.hi for level in levels),
                     management=all(level.management for level in levels), source="title")
    return _one_title(title)


def _one_title(title: str) -> Level | None:
    text = (title or "").lower()
    management = bool(_MANAGEMENT.search(_KIND_OF_JOB.sub(" ", text)))
    found = [span for pattern, span in _TITLE_WORDS if pattern.search(text)]
    number = _TITLE_NUMBER.search(text)
    if number:
        found.append((_NUMBER[number.group(1)],) * 2)
    if "associate" in text and management:
        found = [span for span in found if span != (ENTRY, MID)]   # "Associate Director" is not entry level
    span = (max(lo for lo, _ in found), max(hi for _, hi in found)) if found else None
    if span is None and not management:
        return None
    if span is None:
        span = (LEAD, PRINCIPAL)   # a manager or director with no level word sits above the senior rung
    return Level(*span, management=management, source="title")


def from_years(years: float | None) -> Level | None:
    """The level a number of years asked for (or held) usually means."""
    if years is None:
        return None
    if years < 2:
        return Level(ENTRY, ENTRY, source="years")
    if years < 3:
        return Level(ENTRY, MID, source="years")
    if years < 5:
        return Level(MID, SENIOR, source="years")
    if years < 8:
        return Level(SENIOR, LEAD, source="years")
    if years < 12:
        return Level(SENIOR, PRINCIPAL, source="years")
    return Level(LEAD, PRINCIPAL, source="years")


def from_board_label(label: str) -> Level | None:
    """A board's own seniority label ("Mid-Senior level", "Entry Level", "Senior, Manager", "6+ years"), or None."""
    text = (label or "").lower().strip()
    if not text or text in ("not applicable", "n/a", "any", "any (new grads ok)"):
        return Level(ENTRY, ENTRY, source="board") if "new grads" in text else None
    years = _YEARS.search(text)
    if years:
        level = from_years(float(years.group(1)))
        return Level(level.lo, level.hi, source="board")
    found = [span for part in re.split(r"[,/;]", text) for pattern, span in _LABEL_WORDS if pattern.search(part.strip())]
    management = bool(_LABEL_MANAGEMENT.search(text))
    span = _join(found) or ((LEAD, PRINCIPAL) if management else None)
    return Level(*span, management=management, source="board") if span else None


def of_job(title: str, board_label: str = "", description: str = "") -> Level | None:
    """A job's level: its title's words, else the board's label, else the fewest years its description asks for."""
    level = from_title(title)
    if level is not None:
        return level
    level = from_board_label(board_label)
    if level is not None:
        return level
    asked = [int(n) for n in _YEARS_ASKED.findall(description or "")]
    years = from_years(min(asked)) if asked else None
    return Level(years.lo, years.hi, source="years asked") if years else None


def of_candidate(target_titles, latest_role_title: str = "", years_experience: float | None = None) -> Level | None:
    """The level a candidate is looking for: the target titles' level words, else the most recent role's, else
    their years. None when nothing says, and then no job is held to a level."""
    levels = [level for level in (from_title(t) for t in target_titles or []) if level is not None]
    if levels:
        return Level(*_join([(level.lo, level.hi) for level in levels]),
                     management=any(level.management for level in levels), source="target titles")
    latest = from_title(latest_role_title)
    if latest is not None:
        return Level(latest.lo, latest.hi, management=latest.management, source="latest role")
    if years_experience is None:
        return None
    # A candidate is one rung, not the span a posting's years cover.
    rung = ENTRY if years_experience < 2 else MID if years_experience < 5 else SENIOR if years_experience < 10 else LEAD
    return Level(rung, rung, source="years of experience")


def gap(job: Level | None, candidate: Level | None) -> tuple:
    """(steps, reason): steps > 0 when the job is above the candidate's level, < 0 below, 0 when they meet or either
    is unknown; None when the job is on the management track and the candidate is not looking for it."""
    if job is None or candidate is None:
        return 0, ""
    if job.management and not candidate.management:
        return None, f"management role; the candidate looks for {candidate.text()} roles"
    if job.hi < candidate.lo:
        steps = -(candidate.lo - job.hi)
    elif job.lo > candidate.hi:
        steps = job.lo - candidate.hi
    else:
        return 0, f"{job.text()} level fits"
    direction = "above" if steps > 0 else "below"
    return steps, (f"{job.text()} level, {abs(steps)} step{'s' if abs(steps) > 1 else ''} {direction} the "
                   f"candidate's {candidate.text()}")
