"""The contract every job source implements (job search PR 1, decided 2026-11-10).

A provider does two things:
- `search(query, country, limit)`: ask the source for jobs, return them as it sent them (`SearchResult.jobs`, each a
  JSON object) with the rest of its response (`SearchResult.metadata`), or raise `ProviderError` with a fixed code.
- `read(content)`: one stored job (`job_postings.content`, the object exactly as `search` returned it) into the
  common fields everything else reads (`JobFields`). Pure: no I/O.

`job_postings.content` holds the source's own object, so a new source needs no migration and an old row keeps reading
through its own provider's `read()`, picked by `job_postings.source`. Nothing outside a provider looks inside
`content`.
"""
from dataclasses import dataclass, field
from typing import Protocol

# The failure codes a search can end with (`scrape_jobs.error` starts with one). Never the source's body or URL.
ERROR_MESSAGES = {
    "timeout": "The job source didn't answer in time.",
    "provider_unavailable": "The job source is unavailable right now.",
    "provider_rejected": "The job source refused the search.",
    "bad_response": "The job source sent a reply we couldn't read.",
    "too_large": "The job source sent too much at once.",
    "internal": "Something went wrong running the search.",
}


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


@dataclass
class SearchResult:
    jobs: list[dict]
    metadata: dict = field(default_factory=dict)


class Provider(Protocol):
    name: str           # stored in job_postings.source; never renamed once rows carry it

    async def search(self, query: str, country: str, limit: int) -> SearchResult: ...

    def read(self, content: dict) -> JobFields: ...
