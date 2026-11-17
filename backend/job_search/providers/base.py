"""The contract every job source implements (job search PR 1, decided 2026-11-10).

A provider does two things:
- `search(query, country, limit, cursor, *, place, posted_within_days)`: ask the source for jobs, return them as it
  sent them (`SearchResult.jobs`, each a JSON object) with the rest of its response (`SearchResult.metadata`), or raise
  `ProviderError` with a fixed code. `cursor` is where to continue (None: from the top); `SearchResult.next_cursor` is
  where the next search of the same role continues, None when the source has no more (job search PR 2: a repeated
  search brings the next page). `place` is one "City, ST", `REMOTE` (remote jobs anywhere in the country) or None (the
  whole country); `posted_within_days` asks the source for recent jobs only, when it can (decided 2026-11-14). A
  source's own date filter is a hint, never trusted: the pipeline checks each job's posted date itself.
- `read(content)`: one stored job (`job_postings.content`, the object exactly as `search` returned it) into the
  common fields everything else reads (`JobFields`). Pure: no I/O.

`job_postings.content` holds the source's own object, so a new source needs no migration and an old row keeps reading
through its own provider's `read()`, picked by `job_postings.source`. Nothing outside a provider looks inside
`content`.

`quoted_or(titles)`: several titles as one search's words, each in quotes, joined by OR (decided 2026-11-16, Q69; live
on Indeed: 15 of 20 jobs with a wanted title, against 7 unquoted).
"""
import threading
from dataclasses import dataclass, field
from typing import Protocol

# The place that asks for remote jobs anywhere in the search country (decided 2026-11-14, Q12).
REMOTE = "remote"

# The failure codes a search can end with (`scrape_jobs.error` starts with one). Never the source's body or URL.
ERROR_MESSAGES = {
    "timeout": "The job source didn't answer in time.",
    "provider_unavailable": "The job source is unavailable right now.",
    "provider_rejected": "The job source refused the search.",
    "bad_response": "The job source sent a reply we couldn't read.",
    "too_large": "The job source sent too much at once.",
    "internal": "Something went wrong running the search.",
}


def quoted_or(titles, most: int = 400) -> str | None:
    """`"A" OR "B" OR "C"` for two titles or more; None for fewer (the query is then searched as it is)."""
    clean = [t for t in (" ".join(str(t).replace('"', " ").split())[:100] for t in titles or ()) if t]
    return " OR ".join(f'"{t}"' for t in clean)[:most] if len(clean) > 1 else None


class ProviderError(Exception):
    """A search that failed, as one of `ERROR_MESSAGES`' codes. `str()` is the safe message, never the cause."""

    def __init__(self, code: str):
        if code not in ERROR_MESSAGES:
            raise ValueError(f"unknown job search error code {code!r}")
        self.code = code
        super().__init__(ERROR_MESSAGES[code])


@dataclass(frozen=True)
class JobFields:
    """The common fields of one job, whatever the source. `description` is plain text (never HTML); `apply_url` is an
    http(s) link or None. `title`, `company` and `description` make the job's identity (`job_id`)."""
    title: str
    company: str
    description: str
    apply_url: str | None = None
    location: str | None = None
    countries: tuple[str, ...] = ()
    posted_at: str | None = None          # ISO 8601, as the source gave it
    employment_type: str | None = None
    skills: tuple[str, ...] = ()
    is_closed: bool = False
    # The source marks the employer a known H-1B sponsor. False means not known, never "doesn't sponsor".
    h1b_sponsor: bool = False
    # The source labels the job remote (its own label or location, never a word in the description). False: not known.
    is_remote: bool = False
    # The source's own id for a job that comes without its text ("linkedin:<id>"): its identity (`job_id`) then, since
    # title and company alone don't tell two jobs apart. None for a source that sends the whole posting.
    source_id: str | None = None
    # The work mode the source states: "REMOTE", "HYBRID" or "ONSITE"; None when it doesn't say (decided 2026-11-17, Q121).
    work_mode: str | None = None


@dataclass
class SearchResult:
    jobs: list[dict]
    metadata: dict = field(default_factory=dict)
    next_cursor: str | None = None      # JSON-safe; stored in the batch's metadata


class Provider(Protocol):
    name: str           # stored in job_postings.source; never renamed once rows carry it
    label: str          # how the search-source picker names it ("Indeed", "freehire.me", "LinkedIn")

    # `titles`: the role split into its titles (decided 2026-11-16, Q69: "A | B", "A / B Engineer"), searched together;
    # `years`: the most years asked the candidate can take (Q74), for a source that filters on it; `level`: "entry",
    # "mid" or "senior" (2026-11-17, Q96, Q99), for a source that can leave other levels out; `firm_id`: whose search
    # it is, for a source that paces requests across firms (LinkedIn, Q81).
    async def search(self, query: str, country: str, limit: int, cursor: str | None = None, *,
                     place: str | None = None, posted_within_days: int | None = None, titles=(), years=None,
                     level=None, firm_id=None) -> SearchResult: ...

    def read(self, content: dict) -> JobFields: ...


_JOBSPY_LOCK = threading.Lock()


def load_jobspy() -> None:
    """Load python-jobspy once, whole, under a lock (found 2026-11-17). Its package imports every board's scraper, and
    two threads loading it at once fail ("partially initialized module", KeyError 'jobspy'): the first click after a
    start asks LinkedIn and Indeed together, so both city searches failed. Every source's first use comes through
    here, and the app calls it at startup. Cheap once loaded."""
    with _JOBSPY_LOCK:
        import jobspy  # noqa: F401
