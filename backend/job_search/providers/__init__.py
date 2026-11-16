"""The job search providers by name (decided 2026-11-10). The BDE picks one for each search, from `REGISTRY` in its
order (decided 2026-11-16, Q53: beside the place picker, Indeed first); a search that names none uses the global
setting `job_search_provider` (the `settings` table), `indeed` when unset or no longer registered. Adding a source is
a class with `name`, `label`, `search` and `read` (providers/base.py) and a line in `REGISTRY`. Removing one moves it
to `RETIRED` (only its `read` is used), so the jobs it saved still read (`reader_for(job_postings.source)`).

- `indeed`: Indeed through python-jobspy, the source since 2026-11-14.
- `freehire`: freehire.me's agent search (the first source, 2026-11-09; stopped 2026-11-14; back 2026-11-16, Q55).
- `linkedin`: LinkedIn's public job search through python-jobspy, at one pace for the whole backend (2026-11-16, Q75–Q86).
"""
from backend.job_search.providers.base import REMOTE, JobFields, Provider, ProviderError, SearchResult  # noqa: F401
from backend.job_search.providers.capture import CAPTURE_SOURCES, Capture
from backend.job_search.providers.freehire import Freehire
from backend.job_search.providers.indeed import Indeed
from backend.job_search.providers.linkedin import LinkedIn

DEFAULT_PROVIDER = "indeed"
SETTING_KEY = "job_search_provider"

# The sources a search can use, in the picker's order.
REGISTRY: dict[str, Provider] = {p.name: p for p in (Indeed(), Freehire(), LinkedIn())}
# Sources that no longer search; kept for the jobs they saved (none today).
RETIRED: dict = {}
# Everything that can have written a posting: search providers, retired ones and captures, by `job_postings.source`.
READERS = {**RETIRED, **REGISTRY, **{name: Capture(name) for name in CAPTURE_SOURCES}}


def active(db) -> Provider:
    """The provider new searches use. An unknown name in the setting (a typo, a retired source) falls back to the
    default, so it can't stop every search."""
    from backend.models.db import Setting
    row = db.query(Setting).filter(Setting.key == SETTING_KEY).first()
    name = (row.value or "").strip() if row else ""
    return REGISTRY.get(name) or REGISTRY[DEFAULT_PROVIDER]


def choices() -> list[dict]:
    """The sources the BDE picks from, in order: `{value, label}`."""
    return [{"value": p.name, "label": p.label} for p in REGISTRY.values()]


def reader_for(source: str):
    """Whatever reads a posting written by `source` (a search provider, a retired one or a capture), or None."""
    return READERS.get(source) or REGISTRY.get(source)
