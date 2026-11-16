"""freehire.me (https://freehire.me): a job source the BDE can pick for a search, beside Indeed (decided 2026-11-16,
Q53–Q55). It was the first source (2026-11-09), stopped searching on 2026-11-14 when Indeed replaced it, and is back
through freehire.me's agent search, which sends the whole posting.

One search (Q55), the same inputs as Indeed's:
- `q` the target role, matched on job titles only (`q_fields=title`);
- the place: a city's metro area as freehire.me names it ("Dallas (US)", from its facets list, kept for six hours),
  else the country: on freehire.me the geography is one "or" group (countries, metros and cities widen each other),
  so a metro is sent alone. A Remote search sends the country and `work_mode=remote`. A city with no metro there
  searches the whole country (freehire.me has no mile radius);
- `posted_within_days=14`, a hint: the pipeline checks each job's posted date itself;
- 100 jobs a page, continuing from the last offset (`cursor` is the offset as text);
- `description_format=text`: the whole posting as plain text, so the Match reads all of it (the old search cut it at
  about 1,000 characters, in HTML);
- `source_exclude=adzuna` (decided 2026-11-16, Q64): freehire.me passes on Adzuna's listings as Adzuna's preview
  (often 500 characters), so they are left out of the search. freehire.me ignores a parameter it doesn't read rather
  than refusing it, and names it in `meta.ignored_params`: that is logged (a code), and any Adzuna job that still
  comes back is dropped here and counted (`SearchResult.metadata["skipped_adzuna"]`).

freehire.me's terms allow the API without a key for personal, non-commercial use only; showing its jobs in a product
offered to others needs an API plan (freehire.me/terms#data-licence). `FREEHIRE_API_KEY` (backend/.env) is sent as a
bearer token when set (Q54); the licence must be settled before production (docs/team/cross-area-changes.md).

A stored job is freehire.me's object as it sent it: the employer's apply link, the description (plain text, marked
`_description_format: "text"`; a job saved by the old search has an HTML description and no mark), location,
countries, skills, `work_mode`, `closed_at` and an `enrichment` object. Logs carry codes, counts and timings, never the
query, the place or the key.
"""
import logging
import os
import re
import time

from backend.job_search.providers.base import REMOTE, JobFields, ProviderError, SearchResult
from backend.job_search.text import clean_str, html_to_text, safe_url

logger = logging.getLogger("benchq.job_search")

SEARCH_URL = "https://freehire.me/api/v1/agent/jobs/search"
FACETS_URL = "https://freehire.me/api/v1/jobs/facets"
MOST_PER_PAGE = 100                     # the API's page limit
METROS_KEPT_FOR_SECONDS = 6 * 3600      # how long a fetched list of metro names is reused
FACETS_TIMEOUT_SECONDS = 10.0           # the metro list's call; failing it searches the country instead
TEXT = "text"                           # `_description_format` of a job saved by the agent search
LEFT_OUT_ORIGINS = ("adzuna",)          # freehire.me's `source` values the search leaves out (Q64)
_CONTROL = re.compile(r"[\x00-\x1f\x7f]+")
_SPACES = re.compile(r"\s+")

_metros: dict = {"names": (), "at": 0.0}


def _line(value: str, most: int) -> str:
    return _SPACES.sub(" ", _CONTROL.sub(" ", value or "")).strip()[:most]


def _strings(value) -> tuple[str, ...]:
    if not isinstance(value, list):
        return ()
    return tuple(s for s in (clean_str(v) for v in value) if s)


def _headers() -> dict:
    key = (os.environ.get("FREEHIRE_API_KEY") or "").strip()
    return {"Authorization": f"Bearer {key}"} if key else {}


async def _metro_names() -> tuple[str, ...]:
    """freehire.me's metro names ("Dallas (US)"), fetched now and then; the last list (or none) when it can't be
    read."""
    if _metros["names"] and time.monotonic() - _metros["at"] < METROS_KEPT_FOR_SECONDS:
        return _metros["names"]
    from backend.job_search.http import get_json        # here: http imports the providers package
    try:
        payload = await get_json(FACETS_URL, {}, headers=_headers(), source="freehire-facets",
                                 timeout=FACETS_TIMEOUT_SECONDS, attempts=1)
    except ProviderError:
        return _metros["names"]
    facets = (payload.get("data") or {}).get("facets") if isinstance(payload.get("data"), dict) else None
    metros = facets.get("metros") if isinstance(facets, dict) else None
    names = tuple(name for name in (metros or {}) if isinstance(name, str)) if isinstance(metros, dict) else ()
    if names:
        _metros["names"], _metros["at"] = names, time.monotonic()
    return _metros["names"]


async def metro_for(place: str | None, country: str) -> str | None:
    """freehire.me's metro for "City, ST" in `country` ("Austin, TX" → "Austin (US)"), or None: Remote, no place, or a
    city it has no metro for."""
    if not place or place == REMOTE:
        return None
    city = place.split(",")[0].strip().lower()
    if not city:
        return None
    suffix = f" ({country.upper()})"
    return next((name for name in await _metro_names()
                 if name.endswith(suffix) and name[:-len(suffix)].strip().lower() == city), None)


class Freehire:
    name = "freehire"
    label = "freehire.me"

    async def search(self, query: str, country: str, limit: int, cursor: str | None = None, *,
                     place: str | None = None, posted_within_days: int | None = None) -> SearchResult:
        offset = int(cursor) if cursor and cursor.isdigit() else 0
        size = max(1, min(limit, MOST_PER_PAGE))
        params: dict = {"q": _line(query, 200), "q_fields": "title", "limit": size, "offset": offset,
                        "description_format": TEXT, "source_exclude": list(LEFT_OUT_ORIGINS)}
        metro = await metro_for(_line(place, 100) if place != REMOTE else place, country)
        if metro:
            params["metros"] = metro                # alone: a country beside it would widen the search
        else:
            params["countries"] = country
        if place == REMOTE:
            params["work_mode"] = "remote"
        if posted_within_days:
            params["posted_within_days"] = posted_within_days
        from backend.job_search.http import get_json
        payload = await get_json(SEARCH_URL, params, headers=_headers(), source="freehire")
        data = payload.get("data")
        if not isinstance(data, list):
            raise ProviderError("bad_response")
        meta = payload.get("meta") if isinstance(payload.get("meta"), dict) else {}
        total = meta.get("total") if isinstance(meta.get("total"), int) else None
        ignored = meta.get("ignored_params")
        if isinstance(ignored, (list, dict)) and "source_exclude" in ignored:
            logger.warning("job search source=freehire code=source_exclude_ignored")
        jobs = [{**job, "_description_format": TEXT} for job in data if isinstance(job, dict)
                and str(job.get("source") or "").lower() not in LEFT_OUT_ORIGINS]
        skipped = sum(1 for job in data if isinstance(job, dict)) - len(jobs)
        following = offset + len(data)
        more = len(data) >= size and (total is None or following < total)
        logger.info("job search source=freehire jobs=%d skipped_adzuna=%d by_metro=%s more=%s", len(jobs), skipped,
                    bool(metro), more)
        return SearchResult(jobs=jobs, metadata={"total": total, "by_metro": bool(metro), "skipped_adzuna": skipped},
                            next_cursor=str(following) if more else None)

    def read(self, content: dict) -> JobFields:
        enrichment = content.get("enrichment") if isinstance(content.get("enrichment"), dict) else {}
        location = clean_str(content.get("location"))
        description = content.get("description")
        if content.get("_description_format") == TEXT:
            text = clean_str(description) or ""     # plain text already: no HTML reading (a "<" stays a "<")
        else:
            text = html_to_text(description)        # a job saved by the old search
        work_mode = (clean_str(content.get("work_mode")) or "").lower()
        return JobFields(
            title=clean_str(content.get("title")) or "",
            company=clean_str(content.get("company")) or "",
            description=text,
            apply_url=safe_url(content.get("url")),
            location=location,
            countries=tuple(c.lower() for c in _strings(content.get("countries"))),
            posted_at=clean_str(content.get("posted_at")),
            employment_type=clean_str(enrichment.get("employment_type")),
            skills=_strings(content.get("skills")),
            is_closed=bool(content.get("closed_at")),
            # freehire.me tags employers it knows sponsor H-1B (`collections`; job search PR 3, decided 2026-11-11).
            h1b_sponsor="us-h1b-sponsor" in _strings(content.get("collections")),
            is_remote=work_mode == "remote" or (bool(location) and location.lower().startswith("remote")),
        )
