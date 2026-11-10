"""freehire.me (https://freehire.me): an open job aggregator with a REST API and no key. The first job search provider
(decided 2026-11-09).

One call: `GET /api/v1/jobs/search?q=<query>&countries=<us|ca|in>&limit=100`. `countries` filters by country (a plain
`country=` is ignored by the API). The reply is `{"data": [job, …], "meta": {"limit", "offset", "total"}}`; each job
carries the employer's apply link, an HTML description, location, countries, skills and an `enrichment` object, so no
second call per job is needed. A job with `closed_at` set is closed.
"""
from backend.job_search import http
from backend.job_search.providers.base import JobFields, ProviderError, SearchResult
from backend.job_search.text import clean_str, html_to_text, safe_url

API_URL = "https://freehire.me/api/v1/jobs/search"


def _strings(value) -> tuple[str, ...]:
    if not isinstance(value, list):
        return ()
    return tuple(s for s in (clean_str(v) for v in value) if s)


class Freehire:
    name = "freehire"

    async def search(self, query: str, country: str, limit: int) -> SearchResult:
        payload = await http.get_json(API_URL, {"q": query, "countries": country, "limit": limit}, source=self.name)
        jobs = payload.get("data")
        if not isinstance(jobs, list):
            raise ProviderError("bad_response")
        meta = payload.get("meta") if isinstance(payload.get("meta"), dict) else {}
        # Everything but the jobs (scrape_jobs.metadata): the source's own paging and total.
        rest = {k: v for k, v in payload.items() if k != "data"}
        return SearchResult(jobs=[j for j in jobs[:limit] if isinstance(j, dict)],
                            metadata={**rest, "total": meta.get("total")})

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
        )
