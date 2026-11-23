"""LinkedIn through python-jobspy (decided 2026-11-16, Q75–Q86): the third search source, beside Indeed and freehire.me.

LinkedIn has no public job API; jobspy reads its public ("guest") job search, the one a signed-out visitor sees. Here
jobspy reads each job card (`_process_job`, its headers); the requests themselves go through BenchQ's own pace for
LinkedIn (`linkedin_queue`: 4 at a time for the whole backend, 5 s between rounds, a 429 sent again after 7 s), never
jobspy's loop, which sleeps 3–7 s between pages in one thread.

One search (Q77), the same inputs as Indeed's:
- the candidate's titles in quotes joined by OR (`keywords`; one title alone as it is);
- the place picked, 50 miles around it; Remote: the search country with LinkedIn's remote filter (`f_WT=2`);
- the last 14 days (`f_TPR`), a hint: the pipeline checks each job's posted date itself;
- 100 jobs: LinkedIn answers 10 a request (whatever is asked, live 2026-11-16), so 10 requests, 4 at a time, from
  `cursor` (the next job number; LinkedIn goes no further than 1,000). A page that fails keeps what came before it,
  and the next search starts there; a search stops at `TIME_LIMIT_SECONDS` the same way.

A job card has no description (live 2026-11-16: title, company, place, date and LinkedIn's job page). BenchQ never
fetches the posting (decided 2026-11-17, Q114): the job pane shows LinkedIn's own page in a frame, through the BenchQ
Apply extension (Q106, Q115); to tailor, the BDE pastes the posting's text (Q107). LinkedIn jobs are never scored
(no Match) and skip the text-based filters; the level check reads their title (Q97).

LinkedIn's terms forbid scraping: this must be settled before production (docs/team/cross-area-changes.md, Q78).
A stored job is jobspy's `JobPost` as JSON, plus `linkedin_id` and `searched_remote` (the search asked for remote
jobs only). Logs carry pages, status codes, counts and timings, never the query or the place.
"""
import asyncio
import functools
import logging
import re
import time

from backend.job_search.providers.base import (REMOTE, JobFields, ProviderError, SearchResult, load_jobspy,
                                               quoted_or)
from backend.job_search.text import clean_str, html_to_text, safe_url

logger = logging.getLogger("benchq.job_search")

SEARCH_URL = "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search"
PAGE = 10                               # jobs a request returns
AT_ONCE = 4                             # requests sent together (the queue allows 4 for every firm together)
RADIUS_MILES = 50
LAST_START = 1000                       # LinkedIn's search goes no further
TIME_LIMIT_SECONDS = 90.0               # one search, every page and every wait included (Q76; 90 s since Q90)
COUNTRIES = {"us": ("usa", "United States"), "ca": ("canada", "Canada"), "in": ("india", "India")}
_CONTROL = re.compile(r"[\x00-\x1f\x7f]+")
_SPACES = re.compile(r"\s+")
_ID = re.compile(r"^\d{5,20}$")


def _line(value: str, most: int) -> str:
    return _SPACES.sub(" ", _CONTROL.sub(" ", value or "")).strip()[:most]


# The levels a search leaves out for each candidate level (decided 2026-11-17, Q96): LinkedIn's own level filter (f_E)
# is ignored by its public search, but NOT words work (live: 0 senior titles in 20 for an entry-level candidate).
LEVEL_WORDS_OUT = {
    "entry": ("Senior", "Lead", "Principal", "Staff", "Manager", "Director"),
    "mid": ("Junior", "Intern", "Principal", "Director"),
    "senior": ("Junior", "Intern", "Entry"),
}


def keywords(query: str, titles=(), level: str | None = None) -> str:
    """The search's words: several titles in quotes joined by OR (`quoted_or`); one title as it is; none, the query;
    then the other levels' words left out (Q96)."""
    words = quoted_or(titles) or _line(next(iter(titles or ()), query), 200)
    out = LEVEL_WORDS_OUT.get(level or "")
    return f"({words}) " + " ".join(f"NOT {w}" for w in out) if out else words


@functools.cache
def _jobspy():
    """jobspy's LinkedIn scraper (for its card reader and headers), built on first use: importing jobspy loads pandas
    and every board's scraper."""
    load_jobspy()
    from jobspy.linkedin import LinkedIn as JobspyLinkedIn
    from jobspy.linkedin.constant import headers
    return JobspyLinkedIn, headers


def _scraper(country: str):
    scraper_class, _ = _jobspy()
    scraper = scraper_class()
    scraper.country = COUNTRIES[country][0]
    return scraper


def _cards(html: str, scraper, searched_remote: bool) -> tuple[list[dict], int]:
    """A search page's jobs as stored contents, and how many cards it had."""
    from bs4 import BeautifulSoup
    cards = BeautifulSoup(html, "html.parser").find_all("div", class_="base-search-card")
    jobs = []
    for card in cards:
        link = card.find("a", class_="base-card__full-link")
        href = (link.get("href") or "").split("?")[0] if link else ""
        job_id = href.rstrip("/").split("-")[-1]
        if not _ID.match(job_id):
            continue
        try:
            post = scraper._process_job(card, job_id, False)
        except Exception:
            post = None
        if post is None:
            continue
        content = post.model_dump(mode="json", exclude_none=True)
        content.update({"linkedin_id": job_id, "searched_remote": searched_remote})
        if not content.get("date_posted"):
            # LinkedIn marks its newest jobs `job-search-card__listdate--new`, which jobspy doesn't read (Q98).
            tag = card.find("time", class_=lambda c: c and "job-search-card__listdate" in c)
            posted = (tag.get("datetime") or "").strip() if tag else ""
            if re.match(r"^\d{4}-\d{2}-\d{2}$", posted):
                content["date_posted"] = posted
        jobs.append(content)
    return jobs, len(cards)


def _page_error(status) -> str:
    if status == 429 or (isinstance(status, int) and status >= 500):
        return "provider_unavailable"
    if status == 413:
        return "too_large"
    return "provider_rejected"           # a refusal (400, 403) or a redirect (a sign-in wall), not followed


def _search(query: str, country: str, limit: int, cursor: str | None, place: str | None,
            posted_within_days: int | None, titles, firm_id, deadline: float, level: str | None = None) -> SearchResult:
    """Pages of 10, `AT_ONCE` at a time through the queue, in a worker thread (jobspy and the queue are blocking)."""
    from concurrent.futures import ThreadPoolExecutor

    from backend.job_search import linkedin_queue

    _, headers = _jobspy()
    scraper = _scraper(country)
    remote = place == REMOTE
    params = {"keywords": keywords(query, titles, level), "pageNum": 0,
              "location": COUNTRIES[country][1] if remote or not place else _line(place, 100)}
    if remote:
        params["f_WT"] = 2
    elif place:
        params["distance"] = RADIUS_MILES
    if posted_within_days:
        params["f_TPR"] = f"r{posted_within_days * 86400}"
    start = int(cursor) if cursor and cursor.isdigit() else 0
    jobs: list[dict] = []
    seen: set[str] = set()
    pages, failed, more, started = 0, None, True, time.monotonic()

    def page(at: int):
        try:
            return linkedin_queue.get(SEARCH_URL, {**params, "start": at}, headers, kind="search", firm_id=firm_id,
                                      deadline=deadline)
        except linkedin_queue.Busy:
            return "busy", ""
        except Exception as error:      # a timeout, a dropped connection: never its message (it holds the URL)
            return type(error).__name__, ""

    with ThreadPoolExecutor(AT_ONCE) as pool:
        while more and failed is None and len(jobs) < limit and start < LAST_START:
            if time.monotonic() >= deadline:
                break                   # out of time: keep what came, the next search continues from here
            wanted = min(AT_ONCE, -(-(limit - len(jobs)) // PAGE), (LAST_START - start) // PAGE or 1)
            starts = [start + PAGE * i for i in range(wanted)]
            for at, (status, body) in zip(starts, pool.map(page, starts)):
                if failed is not None or not more:
                    break
                if status != 200:
                    failed = "timeout" if status == "busy" else _page_error(status) \
                        if isinstance(status, int) else "provider_unavailable"
                    logger.warning("job search source=linkedin page_start=%d status=%s code=%s", at, status, failed)
                    break
                pages += 1
                found, cards = _cards(body, scraper, remote)
                for job in found:
                    if job["linkedin_id"] not in seen:
                        seen.add(job["linkedin_id"])
                        jobs.append(job)
                start = at + PAGE
                if cards < PAGE:
                    more = False        # LinkedIn has no more for this search
    logger.info("job search source=linkedin pages=%d jobs=%d failed=%s ms=%d", pages, len(jobs), failed,
                (time.monotonic() - started) * 1000)
    if failed is not None and not jobs:
        raise ProviderError(failed)     # nothing came: the search fails, and its cursor stays for a retry
    return SearchResult(jobs=jobs[:limit], metadata={"pages": pages, "stopped": failed},
                        next_cursor=str(start) if more and start < LAST_START else None)


class LinkedIn:
    name = "linkedin"
    label = "LinkedIn"
    sends_descriptions = False          # a search's jobs have none: LinkedIn's page shows in a frame (Q106)

    async def search(self, query: str, country: str, limit: int, cursor: str | None = None, *,
                     place: str | None = None, posted_within_days: int | None = None, titles=(), years=None,
                     level=None, search_level=None, firm_id=None) -> SearchResult:
        if country not in COUNTRIES:
            raise ProviderError("internal")     # the route admits us, ca and in only
        place = place if place == REMOTE else (_line(place, 100) or None)
        deadline = time.monotonic() + TIME_LIMIT_SECONDS
        try:
            # The thread keeps to the deadline itself; this is only the backstop (a thread can't be cancelled).
            return await asyncio.wait_for(asyncio.to_thread(_search, query, country, limit, cursor, place,
                                                            posted_within_days, titles, firm_id, deadline, level),
                                          timeout=TIME_LIMIT_SECONDS + 60)
        except asyncio.TimeoutError:
            raise ProviderError("timeout") from None

    def read(self, content: dict) -> JobFields:
        place = content.get("location") if isinstance(content.get("location"), dict) else {}
        city_state = ", ".join(p for p in (clean_str(place.get("city")), clean_str(place.get("state"))) if p)
        searched_remote = bool(content.get("searched_remote"))
        location = city_state or ("Remote" if searched_remote else None)
        country = clean_str(place.get("country"))
        linkedin_id = clean_str(content.get("linkedin_id"))
        return JobFields(
            title=clean_str(content.get("title")) or "",
            company=clean_str(content.get("company_name")) or "",
            description=html_to_text(content.get("description")),
            apply_url=safe_url(content.get("job_url_direct")) or safe_url(content.get("job_url")),
            location=location,
            countries=(country.lower(),) if country and len(country) == 2 else (),
            posted_at=clean_str(content.get("date_posted")),
            is_remote=searched_remote or bool(content.get("is_remote")) or (location or "").lower().startswith("remote"),
            source_id=f"linkedin:{linkedin_id}" if linkedin_id else None,
        )
