"""The job search providers by name (decided 2026-11-10). The active one is the global setting `job_search_provider`
(the `settings` table), `indeed` when unset or no longer registered; every firm uses the same one. Adding a source is a
class with `name`, `search` and `read` (providers/base.py) and a line in `REGISTRY`. Removing one moves it to
`RETIRED` (only its `read` is used), so the jobs it saved still read (`reader_for(job_postings.source)`).

- `indeed`: Indeed through python-jobspy, the source since 2026-11-14.
- `freehire` (retired 2026-11-14): freehire.me, the first source; its saved jobs still read.
"""
from backend.job_search.providers.base import REMOTE, JobFields, Provider, ProviderError, SearchResult  # noqa: F401
from backend.job_search.providers.capture import CAPTURE_SOURCES, Capture
from backend.job_search.providers.freehire import Freehire
from backend.job_search.providers.indeed import Indeed

DEFAULT_PROVIDER = "indeed"
SETTING_KEY = "job_search_provider"

# The sources a search can use.
REGISTRY: dict[str, Provider] = {p.name: p for p in (Indeed(),)}
# Sources that no longer search; kept for the jobs they saved.
RETIRED = {p.name: p for p in (Freehire(),)}
# Everything that can have written a posting: search providers, retired ones and captures, by `job_postings.source`.
READERS = {**RETIRED, **REGISTRY, **{name: Capture(name) for name in CAPTURE_SOURCES}}


def active(db) -> Provider:
    """The provider new searches use. An unknown name in the setting (a typo, a retired source) falls back to the
    default, so it can't stop every search."""
    from backend.models.db import Setting
    row = db.query(Setting).filter(Setting.key == SETTING_KEY).first()
    name = (row.value or "").strip() if row else ""
    return REGISTRY.get(name) or REGISTRY[DEFAULT_PROVIDER]


def reader_for(source: str):
    """Whatever reads a posting written by `source` (a search provider, a retired one or a capture), or None."""
    return READERS.get(source) or REGISTRY.get(source)
