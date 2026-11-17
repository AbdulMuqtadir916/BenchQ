"""Indeed through python-jobspy (decided 2026-11-14): the job search's source since freehire.me stopped searching.

Indeed has no public read API; jobspy speaks to the GraphQL API Indeed's own app uses. A search here is a small
subclass of jobspy's Indeed scraper (Q9), not `scrape_jobs()`, because jobspy, measured live on 2026-11-14:
- reports Indeed's refusal (an HTTP 400 or 403) as "0 jobs" and logs it at INFO, so a block looks like an empty result;
- continues a search by downloading again from the top (offset 200 = 300 fetched), never Indeed's own next-page cursor;
- turns the HTTPS certificate check off (`verify=False`) and puts the place into the query unescaped.
jobspy still gives Indeed's query, its headers, the country table, the date filter and the reading of each job
(`_process_job`).

One search: up to `limit` jobs, asking for the next page until it has them or Indeed has no more, at most
`MOST_PAGES` requests, all inside `TIME_LIMIT_SECONDS`, never retried (a retry straight after a refusal invites a
block). Any failed reply fails the whole search (Q3); the cursor then stays, so the next search asks the same page.
`cursor` is Indeed's own `nextCursor`. A page can hold more than the search still wants: the rest are dropped and the
next search continues after them.

Indeed takes one filter type per search (it refused the date with any other, live 2026-11-14), so only the date goes
to Indeed, and it means "listed on Indeed in the last N days": it also lets through jobs first published long before
(31 of 73 in one Austin search). The pipeline checks each job's posted date (decided 2026-11-14, Q7).

A stored job (`job_postings.content`) is jobspy's `JobPost` as JSON (description in HTML), with its job types as plain
names, Indeed's attribute labels (`attributes`: "Remote", "Hybrid work", ...) and its formatted location
(`location_text`: "Remote in Austin, TX"). Logs carry pages, status codes, counts and timings, never the query or the
place.
"""
import asyncio
import functools
import json
import logging
import re
import time

from backend.job_search.providers.base import REMOTE, JobFields, ProviderError, SearchResult, quoted_or
from backend.job_search.text import clean_str, html_to_text, safe_url

logger = logging.getLogger("benchq.job_search")

RADIUS_MILES = 50                       # around the place's city (decided 2026-11-14, Q4)
MOST_PAGES = 3                          # Indeed requests in one search (Q9)
TIME_LIMIT_SECONDS = 60.0               # the whole search, every page included; no retry (8b)
MAX_BYTES = 5 * 1024 * 1024             # one page's body, the cap the shared HTTP call uses
# The search country (backend/job_search/country.py) → jobspy's country name.
COUNTRIES = {"us": "usa", "ca": "canada", "in": "india"}
# Indeed's attribute labels that say a job is remote (its "Hybrid work" isn't).
_REMOTE_LABELS = {"remote", "fully remote", "work from home"}
_CONTROL = re.compile(r"[\x00-\x1f\x7f]+")
_SPACES = re.compile(r"\s+")


def _text(value: str, most: int) -> str:
    """One line for Indeed's query: control characters out, spaces collapsed, cut to `most`. Quoting is `json.dumps`'s
    (a GraphQL string is a JSON string), so a quote or backslash in a place can't break the query."""
    return _SPACES.sub(" ", _CONTROL.sub(" ", value or "")).strip()[:most]


def _strings(value) -> tuple[str, ...]:
    if not isinstance(value, list):
        return ()
    return tuple(s for s in (clean_str(v) for v in value) if s)


@functools.cache
def _pages_class():
    """jobspy's Indeed scraper with one page at a time in place of its own loop. Built on first use: importing jobspy
    loads pandas and every board's scraper, which the app doesn't need until a search runs."""
    from jobspy.indeed import Indeed as JobspyIndeed
    from jobspy.indeed.constant import api_headers, job_search_query

    class Pages(JobspyIndeed):
        def page(self, query: str, place: str | None, cursor: str | None, deadline: float) -> tuple[list[dict], str | None]:
            """One page of jobs as stored contents, and Indeed's cursor for the next (None: no more). Raises
            `ProviderError` for every failure; nothing about the request reaches the error."""
            import requests

            # Indeed requires the radius with every place, "Remote" too (live 2026-11-14: without it, a 400; with it,
            # 100 jobs, all labelled remote).
            where = "Remote" if place == REMOTE else place
            location = (f"location: {{where: {json.dumps(where)}, radius: {RADIUS_MILES}, radiusUnit: MILES}}"
                        if where else "")
            body = {"query": job_search_query.format(
                what=f"what: {json.dumps(query)}", location=location,
                cursor=f"cursor: {json.dumps(cursor)}" if cursor else "", filters=self._build_filters())}
            headers = {**api_headers, "indeed-co": self.api_country_code}
            raw = bytearray()
            try:
                with self.session.post(self.api_url, headers=headers, json=body, verify=True, stream=True,
                                       allow_redirects=False, timeout=max(deadline - time.monotonic(), 0.001)) as resp:
                    self.last_status = resp.status_code
                    if resp.status_code == 429 or resp.status_code >= 500:
                        raise ProviderError("provider_unavailable")
                    if resp.status_code >= 300:          # a refusal (400, 403) or a redirect, which isn't followed
                        raise ProviderError("provider_rejected")
                    for chunk in resp.iter_content(64 * 1024):
                        raw.extend(chunk)
                        if len(raw) > MAX_BYTES:
                            raise ProviderError("too_large")
                        if time.monotonic() > deadline:
                            raise ProviderError("timeout")
            except requests.Timeout:
                raise ProviderError("timeout") from None
            except requests.RequestException:
                raise ProviderError("provider_unavailable") from None
            try:
                payload = json.loads(bytes(raw))
            except (ValueError, UnicodeDecodeError):
                raise ProviderError("bad_response") from None
            found = ((payload.get("data") or {}).get("jobSearch") if isinstance(payload, dict) else None)
            if not isinstance(found, dict):
                # GraphQL answers a refused query with 200 and `errors` (live 2026-11-14: two filter types).
                rejected = isinstance(payload, dict) and payload.get("errors")
                raise ProviderError("provider_rejected" if rejected else "bad_response")
            results = found.get("results")
            if not isinstance(results, list):
                raise ProviderError("bad_response")
            page_info = found.get("pageInfo") if isinstance(found.get("pageInfo"), dict) else {}
            next_cursor = page_info.get("nextCursor") if isinstance(page_info.get("nextCursor"), str) else None
            jobs = []
            for item in results:
                job = item.get("job") if isinstance(item, dict) else None
                if not isinstance(job, dict):
                    self.unreadable += 1
                    continue
                try:
                    post = self._process_job(job)       # None: the same job already on an earlier page
                except Exception:
                    self.unreadable += 1
                    continue
                if post is not None:
                    jobs.append(_content(post, job))
            return jobs, next_cursor

    return Pages


def _content(post, job: dict) -> dict:
    """What a job stores: jobspy's fields, its job types by their plain names (jobspy's own value lists every
    language's word for them), Indeed's attribute labels and its formatted location."""
    content = post.model_dump(mode="json", exclude_none=True)
    content["job_type"] = [kind.value[0] for kind in post.job_type or []]
    labels = [a.get("label") for a in job.get("attributes") or [] if isinstance(a, dict)]
    content["attributes"] = [label for label in (clean_str(v) for v in labels) if label]
    location = job.get("location") if isinstance(job.get("location"), dict) else {}
    formatted = location.get("formatted") if isinstance(location.get("formatted"), dict) else {}
    if clean_str(formatted.get("long")):
        content["location_text"] = clean_str(formatted.get("long"))
    return content


def _search(query: str, country: str, limit: int, cursor: str | None, place: str | None,
            posted_within_days: int | None, deadline: float) -> SearchResult:
    """The search, page by page, in a worker thread (jobspy is synchronous)."""
    from jobspy.model import Country, DescriptionFormat, ScraperInput, Site

    started = time.monotonic()
    scraper = _pages_class()()
    scraper.unreadable, scraper.last_status = 0, None
    scraper.scraper_input = ScraperInput(
        site_type=[Site.INDEED], search_term=query, location=place if place != REMOTE else None,
        distance=RADIUS_MILES, country=Country.from_string(COUNTRIES[country]), results_wanted=limit,
        hours_old=posted_within_days * 24 if posted_within_days else None, description_format=DescriptionFormat.HTML)
    domain, scraper.api_country_code = scraper.scraper_input.country.indeed_domain_value
    scraper.base_url = f"https://{domain}.indeed.com"
    jobs: list[dict] = []
    pages = 0
    while pages < MOST_PAGES and len(jobs) < limit:
        if pages and time.monotonic() >= deadline:
            break                               # out of time after a page: keep what came, continue from here next
        try:
            page, next_cursor = scraper.page(query, place, cursor, deadline)
        except ProviderError as error:
            logger.warning("job search source=indeed page=%d status=%s code=%s ms=%d", pages + 1,
                           scraper.last_status, error.code, (time.monotonic() - started) * 1000)
            raise
        pages += 1
        jobs.extend(page)
        cursor = next_cursor
        logger.info("job search source=indeed page=%d status=%s jobs=%d ms=%d", pages, scraper.last_status, len(page),
                    (time.monotonic() - started) * 1000)
        if cursor is None:
            break
    return SearchResult(jobs=jobs[:limit], metadata={"pages": pages, "unreadable": scraper.unreadable},
                        next_cursor=cursor)


class Indeed:
    name = "indeed"
    label = "Indeed"

    async def search(self, query: str, country: str, limit: int, cursor: str | None = None, *,
                     place: str | None = None, posted_within_days: int | None = None, titles=(), years=None,
                     level=None, firm_id=None) -> SearchResult:
        # `years` and `level` aren't sent: Indeed takes one filter type per search (the date), and words left out in the
        # query apply to the whole posting (live 2026-11-17: 3 jobs instead of ~35). The level check at save covers it.
        if country not in COUNTRIES:
            raise ProviderError("internal")     # the route admits us, ca and in only
        # Several titles: one search for all of them, each in quotes (decided 2026-11-16, Q69; Indeed takes OR).
        query = quoted_or(titles) or _text(next(iter(titles or ()), query), 200)
        place = place if place == REMOTE else _text(place, 100) or None
        deadline = time.monotonic() + TIME_LIMIT_SECONDS
        try:
            # The thread keeps to the deadline itself; this is only the backstop (a thread can't be cancelled).
            return await asyncio.wait_for(asyncio.to_thread(_search, query, country, limit, cursor, place,
                                                            posted_within_days, deadline),
                                          timeout=TIME_LIMIT_SECONDS + 5)
        except asyncio.TimeoutError:
            raise ProviderError("timeout") from None

    def read(self, content: dict) -> JobFields:
        place = content.get("location") if isinstance(content.get("location"), dict) else {}
        city_state = ", ".join(p for p in (clean_str(place.get("city")), clean_str(place.get("state"))) if p)
        location = clean_str(content.get("location_text")) or city_state or None
        country = clean_str(place.get("country"))
        kinds = _strings(content.get("job_type"))
        labels = {label.lower() for label in _strings(content.get("attributes"))}
        return JobFields(
            title=clean_str(content.get("title")) or "",
            company=clean_str(content.get("company_name")) or "",
            description=html_to_text(content.get("description")),
            apply_url=safe_url(content.get("job_url_direct")) or safe_url(content.get("job_url")),
            location=location,
            countries=(country.lower(),) if country and len(country) == 2 else (),
            posted_at=clean_str(content.get("date_posted")),
            employment_type=kinds[0] if kinds else None,
            is_remote=bool(labels & _REMOTE_LABELS) or (location or "").lower().startswith("remote"),
        )
