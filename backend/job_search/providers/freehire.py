"""freehire.me (https://freehire.me): the first job search provider (decided 2026-11-09), retired as a source on
2026-11-14, when Indeed replaced it (`indeed.py`). It no longer searches and is never called; only its reader stays, so
the jobs its searches saved (`job_postings.source = 'freehire'`) still read (decided 2026-11-14, 8a).

A stored job is freehire.me's search object as it sent it: the employer's apply link, an HTML description cut at about
1,000 characters (unless its first open replaced it with the whole posting, `_full_posting`), location, countries,
skills, `closed_at` and an `enrichment` object.
"""
from backend.job_search.providers.base import JobFields
from backend.job_search.text import clean_str, html_to_text, safe_url


def _strings(value) -> tuple[str, ...]:
    if not isinstance(value, list):
        return ()
    return tuple(s for s in (clean_str(v) for v in value) if s)


class Freehire:
    name = "freehire"

    def read(self, content: dict) -> JobFields:
        enrichment = content.get("enrichment") if isinstance(content.get("enrichment"), dict) else {}
        location = clean_str(content.get("location"))
        return JobFields(
            title=clean_str(content.get("title")) or "",
            company=clean_str(content.get("company")) or "",
            description=html_to_text(content.get("description")),
            apply_url=safe_url(content.get("url")),
            location=location,
            countries=tuple(c.lower() for c in _strings(content.get("countries"))),
            posted_at=clean_str(content.get("posted_at")),
            employment_type=clean_str(enrichment.get("employment_type")),
            skills=_strings(content.get("skills")),
            is_closed=bool(content.get("closed_at")),
            # freehire.me tags employers it knows sponsor H-1B (`collections`; job search PR 3, decided 2026-11-11).
            h1b_sponsor="us-h1b-sponsor" in _strings(content.get("collections")),
            is_remote=bool(location) and location.lower().startswith("remote"),
        )
