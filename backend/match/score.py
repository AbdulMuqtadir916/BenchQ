"""BenchQ's Match score (decided 2026-11-14, Q30–Q49): how well a candidate's résumé fits one job, 0–100, in plain code.

The calculator is the ATS lab's v18 of 2026-11-13 (this package: JobNavigator's match-1.1 with the lab's patches and
BenchQ's changes, backend/UPSTREAM.md). No model, nothing leaves the server, about 10 ms a job. This module is the
only door into it:

- `read_resume(content)`: a version's content (`versions.content_of`) read once, the way tailoring reads it, for every
  job it is scored against.
- `who(candidate, country)`: the candidate as the calculator reads them: the titles they want (the target roles and
  "Marketed as"), their years, their work authorization and engagement types, and the country (the search's).
- `score(resume, fields, candidate)`: the `Match` of one job (`JobFields`, any source): its score, the first reason
  it is held at 40 (`note`), and the calculator's version.
- `ruled_out(fields, candidate)`: whether the job's text rules the candidate out on work authorization, which a
  search leaves out (Q32): the posting states it, and the candidate's status is one it excludes.
- `Match.wrong_level`: held at 40 for the candidate's level (far more years asked, or a level two rungs away), which
  a search also leaves out (decided 2026-11-16, Q70).
- `most_years_asked(resume, candidate)`: the most years a job may ask before Match holds it at 40 for them, for a
  source that filters on it (freehire.me, Q74); None when the candidate's years aren't known.

A job held at 40 for another reason (no C2C, a title for another subject, a language the résumé lacks) is kept: its
score says so.
"""
import math
from dataclasses import dataclass

from backend.match.ats_match import CAP, VERSION, ats_match, eligibility_flags
from backend.match.title_fit import EXPERIENCE_GAP_SHARE, EXPERIENCE_GAP_YEARS
from backend.match.ats_match_terms import ResumeFacts

# The eligibility flags that rule the candidate out, when capped: a search leaves such a job out (Q32).
RULED_OUT = ("clearance", "citizens only", "citizens or green card only", "statuses listed", "status excluded",
             "no sponsorship", "no visa transfers")
NOTE_MOST = 200


@dataclass(frozen=True)
class Who:
    """The candidate as the calculator reads them."""
    wanted: tuple[str, ...]
    years: float | None
    country: str | None               # ISO alpha-2, upper case; None: not known (never assumed)
    work_auth: str | None
    needs_sponsorship: bool
    needs_transfer: bool
    employment_types: tuple[str, ...]
    target_titles: tuple[str, ...] = ()   # the target roles alone, for the job search's level (`search_level_of`)
    marketed_as: str = ""

    def fields(self) -> dict:
        return {"country": self.country, "work_auth": self.work_auth, "needs_sponsorship": self.needs_sponsorship,
                "needs_transfer": self.needs_transfer, "employment_types": list(self.employment_types)}


@dataclass(frozen=True)
class Match:
    score: int
    note: str | None                  # the first reason the score is held at 40, or None
    version: str = VERSION
    wrong_level: bool = False         # held at 40 for far more years asked, or a level two rungs away (Q70)


def who(candidate, country: str | None) -> Who:
    """`candidate` is a `Candidate` (or anything with its fields); `country` the search's code (`us`) or None."""
    wanted = [*(candidate.target_roles or []), *([candidate.primary_role] if candidate.primary_role else []),
              # The job search's extra titles count as wanted (decided 2026-11-17, Q133).
              *(getattr(candidate, "search_titles", None) or [])]
    years = candidate.years_experience
    return Who(wanted=tuple(t for t in (str(t).strip() for t in wanted) if t),
               years=float(years) if years is not None else None,
               country=country.upper() if country else None, work_auth=candidate.work_auth,
               needs_sponsorship=bool(candidate.needs_sponsorship), needs_transfer=bool(candidate.needs_transfer),
               employment_types=tuple(candidate.employment_types or ()),
               target_titles=tuple(t for t in (str(t).strip() for t in candidate.target_roles or []) if t),
               marketed_as=str(candidate.primary_role or "").strip())


def read_resume(content: dict) -> ResumeFacts:
    """A version's content read once (the lab read the same: the tailor's input of the version)."""
    from backend.resume_tailor.stored import tailor_input
    return ResumeFacts.read(tailor_input(content or {}).base)


def _job(fields) -> dict:
    return {"title": fields.title or "", "description": fields.description or "", "company": fields.company or "",
            "location": fields.location or ""}


def score(resume: ResumeFacts, fields, candidate: Who) -> Match:
    """The Match of one job for this résumé and candidate."""
    found = ats_match(resume, _job(fields), wanted_titles=candidate.wanted, years_held=candidate.years,
                      candidate=candidate.fields())
    caps = found["caps"]
    note = str(caps[0])[:NOTE_MOST] if caps and found["score"] <= CAP else None
    return Match(score=found["score"], note=note, version=found["version"], wrong_level=bool(found.get("wrong_level")))


def level_of(resume: ResumeFacts | None, candidate: Who) -> str | None:
    """The candidate's level as a search asks for it (decided 2026-11-17, Q96, Q99): "entry", "mid" or "senior", from
    Match's own reading (the target titles' level words, else the latest role's, else the years); None when unknown."""
    from backend.match import seniority
    years = candidate.years if candidate.years is not None else (resume.years if resume is not None else None)
    level = seniority.of_candidate(candidate.wanted, resume.latest_role if resume is not None else "", years)
    if level is None:
        return None
    return "entry" if level.lo <= seniority.ENTRY else "mid" if level.lo == seniority.MID else "senior"


def search_level_of(resume: ResumeFacts | None, candidate: Who) -> str | None:
    """The level freehire.me's search asks for: "intern", "entry", "mid", "senior", "lead" or "principal"; None when
    nothing says (`seniority.for_job_search`)."""
    from backend.match import seniority
    level = seniority.for_job_search(candidate.target_titles, candidate.marketed_as, candidate.years,
                                     resume.latest_role if resume is not None else "",
                                     resume.years if resume is not None else None)
    return seniority.NAMES[level.lo] if level is not None else None


def most_years_asked(resume: ResumeFacts | None, candidate: Who) -> int | None:
    """The most years a job may ask before Match calls it far more than the candidate has (ats_match `_experience`:
    held + max(EXPERIENCE_GAP_YEARS, EXPERIENCE_GAP_SHARE × held)). The candidate's recorded years, else the résumé's;
    None when neither is known."""
    held = candidate.years if candidate.years is not None else (resume.years if resume is not None else None)
    if held is None:
        return None
    return math.floor(held + max(EXPERIENCE_GAP_YEARS, EXPERIENCE_GAP_SHARE * held))


def ruled_out(fields, candidate: Who) -> str | None:
    """The flag that rules the candidate out ("no sponsorship", "citizens only", …), or None. A posting that says
    nothing, or a candidate whose side isn't known, is never ruled out."""
    flags = eligibility_flags(fields.title or "", fields.description or "", candidate.fields(), fields.location or "")
    return next((flag["flag"] for flag in flags if flag["capped"] and flag["flag"] in RULED_OUT), None)
