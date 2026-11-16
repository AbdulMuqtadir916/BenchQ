"""The job search providers by name (decided 2026-11-10). The active one is the global setting `job_search_provider`
(the `settings` table), `freehire` when unset; every firm uses the same one. Adding a source is a class with `name`,
`search` and `read` (providers/base.py) and a line here. A provider stays registered after it stops being active, so
its old rows still read (`reader_for(job_postings.source)`)."""
from backend.applications.postings import LEGACY
from backend.job_search.providers.base import JobFields, Provider, ProviderError, SearchResult  # noqa: F401
from backend.job_search.providers.capture import CAPTURE_SOURCES, Capture
from backend.job_search.providers.freehire import Freehire

DEFAULT_PROVIDER = "freehire"
SETTING_KEY = "job_search_provider"

REGISTRY: dict[str, Provider] = {p.name: p for p in (Freehire(),)}
# Everything that can have written a posting, by `job_postings.source`: search providers, captures, and the jobs a
# developer's database moved from the old `jobs` pool (`legacy`, backend/scripts/move_local_jobs_to_postings.py), read
# as a job added by hand is. Without it they read blank and couldn't be tailored (the PR 129 review, finding 6).
READERS = {**REGISTRY, **{name: Capture(name) for name in (*CAPTURE_SOURCES, LEGACY)}}


def active(db) -> Provider:
    """The provider new searches use. An unknown name in the setting falls back to the default, so a typo can't stop
    every search."""
    from backend.models.db import Setting
    row = db.query(Setting).filter(Setting.key == SETTING_KEY).first()
    name = (row.value or "").strip() if row else ""
    return REGISTRY.get(name) or REGISTRY[DEFAULT_PROVIDER]


def reader_for(source: str):
    """Whatever reads a posting written by `source` (a search provider or a capture), or None."""
    return READERS.get(source) or REGISTRY.get(source)
