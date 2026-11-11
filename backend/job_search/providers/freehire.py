"""freehire.me (https://freehire.me): an open job aggregator with a REST API and no key. The first job search provider
(decided 2026-11-09).

One call: `GET /api/v1/jobs/search?q=<query>&countries=<us|ca|in>&limit=100&offset=<n>`. The cursor is the offset:
the next search of the same role asks for the next 100 (job search PR 2). `countries` filters by country (a plain
`country=` is ignored by the API). The reply is `{"data": [job, …], "meta": {"limit", "offset", "total"}}`; each job
carries the employer's apply link, an HTML description, location, countries, skills and an `enrichment` object. The
search cuts each description at about 1,000 characters; `GET /api/v1/jobs/{public_slug}` has the whole posting, asked
for once, when someone first opens the job (job search PR 3, decided 2026-11-11). A job with `closed_at` set is closed.
"""
import re

from backend.job_search import http
from backend.job_search.providers.base import JobFields, ProviderError, SearchResult
from backend.job_search.text import clean_str, html_to_text, safe_url

API_URL = "https://freehire.me/api/v1/jobs/search"
JOB_URL = "https://freehire.me/api/v1/jobs/{slug}"
# A page waits on the single-job read: short, one attempt; on failure the search's text stays.
FULL_POSTING_TIMEOUT_SECONDS = 5.0
_SLUG = re.compile(r"^[a-z0-9][a-z0-9-]{0,199}$")


def _strings(value) -> tuple[str, ...]:
    if not isinstance(value, list):
        return ()
    return tuple(s for s in (clean_str(v) for v in value) if s)


class Freehire:
    name = "freehire"

    async def search(self, query: str, country: str, limit: int, cursor: str | None = None) -> SearchResult:
        offset = int(cursor) if cursor and cursor.isdigit() else 0
        params = {"q": query, "countries": country, "limit": limit}
        if offset:
            params["offset"] = offset
        payload = await http.get_json(API_URL, params, source=self.name)
        jobs = payload.get("data")
        if not isinstance(jobs, list):
            raise ProviderError("bad_response")
        meta = payload.get("meta") if isinstance(payload.get("meta"), dict) else {}
        # Everything but the jobs (scrape_jobs.metadata): the source's own paging and total.
        rest = {k: v for k, v in payload.items() if k != "data"}
        total = meta.get("total") if isinstance(meta.get("total"), int) else None
        reached = offset + len(jobs)
        more = bool(jobs) and (total is None or reached < total)
        return SearchResult(jobs=[j for j in jobs[:limit] if isinstance(j, dict)],
                            metadata={**rest, "total": total}, next_cursor=str(reached) if more else None)

    async def full_description(self, content: dict) -> str | None:
        """The whole posting's HTML description, from the single-job read; None when the job has no usable slug or the
        source has nothing longer. `ProviderError` when the call fails."""
        slug = content.get("public_slug")
        if not isinstance(slug, str) or not _SLUG.match(slug):
            return None
        payload = await http.get_json(JOB_URL.format(slug=slug), {}, source=f"{self.name}-job",
                                      timeout=FULL_POSTING_TIMEOUT_SECONDS, attempts=1)
        job = payload.get("data")
        full = job.get("description") if isinstance(job, dict) else None
        if not isinstance(full, str):     # a reply without the job: a failure, tried again (CodeRabbit on #135)
            raise ProviderError("bad_response")
        return full if len(full) > len(content.get("description") or "") else None

    def read(self, content: dict) -> JobFields:
        enrichment = content.get("enrichment") if isinstance(content.get("enrichment"), dict) else {}
        return JobFields(
            title=clean_str(content.get("title")) or "",
            company=clean_str(content.get("company")) or "",
            description=html_to_text(content.get("description")),
            apply_url=safe_url(content.get("url")),
            location=clean_str(content.get("location")),
            countries=tuple(c.lower() for c in _strings(content.get("countries"))),
            posted_at=clean_str(content.get("posted_at")),
            employment_type=clean_str(enrichment.get("employment_type")),
            skills=_strings(content.get("skills")),
            is_closed=bool(content.get("closed_at")),
            # freehire.me tags employers it knows sponsor H-1B (`collections`; job search PR 3, decided 2026-11-11).
            h1b_sponsor="us-h1b-sponsor" in _strings(content.get("collections")),
        )
