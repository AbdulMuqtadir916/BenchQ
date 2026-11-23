"""freehire.me (https://freehire.me): a job source the BDE can pick for a search, beside Indeed (decided 2026-11-16,
Q53–Q55). It was the first source (2026-11-09), stopped searching on 2026-11-14 when Indeed replaced it, and is back
through freehire.me's agent search, which sends the whole posting.

One search (Q55), the same inputs as Indeed's:
- `q` the target role, matched on job titles only (`q_fields=title`); a role of several titles searches them all as
  alternatives (`title:"A" OR title:"B"`, decided 2026-11-16, Q69). Level words go to `seniority`, a Developer title
  also searches Engineer, and six technologies get a check of each job's title (`freehire_titles`, 2026-11-21);
- `seniority`: the level the titles name, else the candidate's. Jobs tagged with it come first; only when they run
  out does the same search add the jobs that state no level (`cursor` is then "tagged:40" or "all:20");
- `experience_years_max` with `experience_include_unspecified` (Q74): only jobs asking no more years than the
  candidate can take (Match's rule, `score.most_years_asked`), and those that state none; not sent when the
  candidate's years aren't known;
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

from backend.job_search import freehire_titles
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
MOST_REQUESTS = 4                       # one search, both stages and the title check's extra pages included
TAGGED, ALL = "tagged", "all"           # jobs tagged with the level; then those too that state none
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


def title_query(query: str, titles=()) -> str:
    """freehire.me's words: every title as an alternative matched in the job title (`title:"A" OR title:"B"`, at most 5:
    its limit), without its level words (`freehire_titles`)."""
    return freehire_titles.plan(titles or (_line(query, 200),)).query


def _read_cursor(cursor: str | None, staged: bool) -> tuple[str, int]:
    """Where a search continues. A cursor from before the two stages (a bare offset) reads as the first stage."""
    stage, _, number = (cursor or "").rpartition(":")
    offset = int(number) if number.isdigit() else 0
    if not staged:
        return ALL, offset
    return (stage, offset) if stage in (TAGGED, ALL) else (TAGGED, offset)


class Freehire:
    name = "freehire"
    label = "freehire.me"

    async def search(self, query: str, country: str, limit: int, cursor: str | None = None, *,
                     place: str | None = None, posted_within_days: int | None = None, titles=(), years=None,
                     level=None, search_level=None, firm_id=None) -> SearchResult:
        asked = freehire_titles.plan(titles or (_line(query, 200),))
        seniority = asked.seniority(search_level or level)
        stage, offset = _read_cursor(cursor, bool(seniority))
        wanted = max(1, min(limit, MOST_PER_PAGE))
        params: dict = {"q": asked.query, "q_fields": "title", "description_format": TEXT,
                        "source_exclude": list(LEFT_OUT_ORIGINS)}
        if years is not None:
            # Only jobs the candidate's years can take, and those that state none (decided 2026-11-16, Q74).
            params["experience_years_max"] = int(years)
            params["experience_include_unspecified"] = "true"
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

        def place_in(at_stage: str, at: int) -> str:
            return f"{at_stage}:{at}" if seniority else str(at)

        jobs: list[dict] = []
        seen: set = set()
        skipped = other_title = 0
        first_total = None
        next_cursor = None
        for request_number in range(MOST_REQUESTS):
            # The title check and the second stage drop jobs after they arrive, so they ask for a whole page.
            size = MOST_PER_PAGE if asked.checked or (seniority and stage == ALL) else wanted - len(jobs)
            page_params = {**params, "limit": size, "offset": offset}
            if seniority:
                page_params["seniority"] = list(seniority)
                if stage == ALL:
                    page_params["seniority_include_unspecified"] = "true"
            try:
                payload = await get_json(SEARCH_URL, page_params, headers=_headers(), source="freehire")
                data = payload.get("data")
                if not isinstance(data, list):
                    raise ProviderError("bad_response")
            except ProviderError:
                if not jobs:
                    raise
                next_cursor = place_in(stage, offset)   # keep what came; the next search asks this page again
                break
            meta = payload.get("meta") if isinstance(payload.get("meta"), dict) else {}
            total = meta.get("total") if isinstance(meta.get("total"), int) else None
            if request_number == 0:
                first_total = total
            ignored = meta.get("ignored_params")
            if isinstance(ignored, (list, dict)) and "source_exclude" in ignored:
                logger.warning("job search source=freehire code=source_exclude_ignored")
            read, full = 0, False
            for job in data:
                read += 1
                if not isinstance(job, dict):
                    continue
                if str(job.get("source") or "").lower() in LEFT_OUT_ORIGINS:
                    skipped += 1
                    continue
                if not asked.keeps(str(job.get("title") or "")):
                    other_title += 1
                    continue
                key = job.get("id") or job.get("url") or id(job)
                if key in seen:                         # the second stage brings the first stage's jobs again
                    continue
                seen.add(key)
                jobs.append({**job, "_description_format": TEXT})
                if len(jobs) >= wanted:
                    full = True
                    break
            page_has_more = len(data) >= size and (total is None or offset + len(data) < total)
            if full:
                if read < len(data) or page_has_more:
                    next_cursor = place_in(stage, offset + read)
                elif seniority and stage == TAGGED:
                    next_cursor = place_in(ALL, 0)
                else:
                    next_cursor = None
                break
            if page_has_more:
                offset += len(data)
            elif seniority and stage == TAGGED:
                stage, offset = ALL, 0
            else:
                next_cursor = None
                break
            next_cursor = place_in(stage, offset)
        metadata = {"total": first_total, "by_metro": bool(metro), "skipped_adzuna": skipped}
        if asked.checked:
            metadata["skipped_other_title"] = other_title
        logger.info("job search source=freehire jobs=%d skipped_adzuna=%d skipped_other_title=%d by_metro=%s more=%s",
                    len(jobs), skipped, other_title, bool(metro), next_cursor is not None)
        return SearchResult(jobs=jobs, metadata=metadata, next_cursor=next_cursor)

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
            # freehire.me's own `work_mode` (Q121): its hybrid jobs showed as on-site before.
            work_mode=work_mode.upper() if work_mode in ("remote", "hybrid", "onsite") else None,
        )
