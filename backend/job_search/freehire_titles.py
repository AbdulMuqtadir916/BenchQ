"""What a freehire.me search asks for, from the candidate's titles (decided by Zuhair 2026-11-21, after Abdul's report
that "Sr Full Stack Developer" brought no Senior jobs).

freehire.me matches every word of a title and has no synonyms, so "Sr" never finds "Senior". It tags each job's
seniority itself, so a level goes in its `seniority` filter and not in the title:

- Senior, Sr, Snr, Mid-Level, Middle, Intermediate, Junior, Jr, Intern and Internship leave the title for `seniority`;
- a title with Lead, Staff or Principal stays exactly as typed ("Technical Lead" is a job, "Technical" is not);
- a Developer title also searches Engineer. Never the other way around;
- real titles come first in the 5 alternatives freehire.me takes, then the added Engineer ones.

freehire.me also drops symbols, so "C++ Developer", "C# Developer" and "C Developer" are one search there (live: 2 of 20
jobs for "C++ Developer" were C++). For C#, C++, C, F#, R and Go, `TitleSearch.keeps` reads each job's own title.
Pure: no I/O.
"""
import re
from dataclasses import dataclass

MOST_ALTERNATIVES = 5

_LEVEL_WORDS = tuple(
    (value, re.compile(rf"(?<![\w])(?:{words})(?![\w])(?:\.(?=\s|$))?", re.I))
    for value, words in (("senior", r"senior|sr|snr"), ("junior", r"junior|jr"),
                         ("middle", r"mid[\s-]?level|middle|intermediate"), ("intern", r"internship|interns?")))
_STAYS_AS_TYPED = re.compile(r"(?<![\w])(?:lead|staff|principal)(?![\w])", re.I)
_DEVELOPER = re.compile(r"\bdeveloper\b", re.I)
_LONE_MARK = re.compile(r"(?<!\S)[-–—/|,]+(?!\S)")
# The technologies freehire.me can't tell apart: how a typed title names one, and how a job's title must. A job's title
# is read by case, so "who can go onsite" isn't Go. "C-BRAIN", "P&C", "D.C.", "R&D", "HVAC/R" and "Go-To-Market" are none.
_SYMBOL_TECH = (
    (re.compile(r"(?<![\w])c#(?![\w])", re.I), re.compile(r"(?<![\w])c#(?![\w])", re.I)),
    (re.compile(r"(?<![\w])c\+\+(?![\w])", re.I), re.compile(r"(?<![\w])c\+\+(?![\w])", re.I)),
    (re.compile(r"(?<![\w])f#(?![\w])", re.I), re.compile(r"(?<![\w])f#(?![\w])", re.I)),
    (re.compile(r"(?<![\w-])c(?![\w#+&-])", re.I), re.compile(r"(?<![\w&.*-])C(?![\w#+&.-]|\s*&)")),
    (re.compile(r"(?<![\w&-])r(?![\w&-])", re.I), re.compile(r"(?<![\w&.*-])(?<!HVAC/)R(?![\w&.-]|\s*&)")),
    (re.compile(r"(?<![\w-])(?:go|golang)(?![\w-])", re.I),
     re.compile(r"(?<![\w-])(?:Go|GO|Golang|golang|GoLang)(?![\w-])")),
)
# freehire.me's seniority values for the candidate's level, when no title names one. Its "staff" is BenchQ's Lead rung.
CANDIDATE_LEVELS = {
    "intern": ("intern",),
    "entry": ("intern", "junior"),
    "mid": ("junior", "middle"),
    "senior": ("senior",),
    "lead": ("senior", "lead", "staff"),
    "principal": ("lead", "staff", "principal"),
}


def _unique(items) -> list[str]:
    out: list[str] = []
    for item in items:
        if item and item.casefold() not in {o.casefold() for o in out}:
            out.append(item)
    return out


def _stem(word: str) -> str:
    return word[:-1] if len(word) > 3 and word.endswith("s") else word


def _words(text: str) -> set[str]:
    text = text.lower().replace("full-stack", "full stack").replace("fullstack", "full stack")
    return {_stem(word) for word in re.findall(r"[a-z0-9]+", text)}


def _without_level(title: str) -> tuple[str, list[str]]:
    """The title without its level words, and the seniority values they name. Nothing left: the title as it was."""
    named, rest = [], title
    for value, pattern in _LEVEL_WORDS:
        if pattern.search(rest):
            named.append(value)
            rest = pattern.sub(" ", rest)
    rest = re.sub(r"\(\s*\)", " ", rest)
    rest = " ".join(_LONE_MARK.sub(" ", rest).split()).strip(" -–—/|,()")
    return (rest, named) if rest else (title, [])


@dataclass(frozen=True)
class TitleSearch:
    alternatives: tuple[str, ...]
    levels: tuple[str, ...]             # the seniority values the titles' own words name
    has_title_as_typed: bool            # a title kept its Lead, Staff or Principal
    checked: bool                       # a title names a technology freehire.me can't tell apart

    @property
    def query(self) -> str:
        return " OR ".join(f'title:"{title}"' for title in self.alternatives)

    def seniority(self, candidate_level: str | None) -> list[str]:
        """The `seniority` values to ask for: the titles' own, and the candidate's level when a title didn't say."""
        from_candidate = CANDIDATE_LEVELS.get(candidate_level or "", ())
        if not self.levels:
            return list(from_candidate)
        return _unique([*self.levels, *(from_candidate if self.has_title_as_typed else ())])

    def keeps(self, job_title: str) -> bool:
        """For a technology freehire.me can't tell apart: the job's own title names it, with the alternative's words."""
        if not self.checked:
            return True
        job_title = job_title or ""
        have = _words(job_title)
        for title in self.alternatives:
            techs = [(typed, in_job) for typed, in_job in _SYMBOL_TECH if typed.search(title)]
            rest = title
            for typed, _ in techs:
                rest = typed.sub(" ", rest)
            if _words(rest) <= have and (not techs or any(in_job.search(job_title) for _, in_job in techs)):
                return True
        return False


def plan(titles) -> TitleSearch:
    """One search's titles, read into what freehire.me is asked."""
    cores: list[str] = []
    added: list[str] = []
    levels: list[str] = []
    as_typed = False
    for title in titles or ():
        title = " ".join(str(title).replace('"', " ").split())[:100]
        if not title:
            continue
        if _STAYS_AS_TYPED.search(title):
            as_typed = True
            cores.append(title)
            continue
        core, named = _without_level(title)
        cores.append(core)
        levels.extend(named)
        if _DEVELOPER.search(core):
            added.append(_DEVELOPER.sub("Engineer", core))
    alternatives = tuple(_unique([*cores, *added])[:MOST_ALTERNATIVES])
    return TitleSearch(alternatives=alternatives, levels=tuple(_unique(levels)), has_title_as_typed=as_typed,
                       checked=any(typed.search(title) for title in alternatives for typed, _ in _SYMBOL_TECH))
