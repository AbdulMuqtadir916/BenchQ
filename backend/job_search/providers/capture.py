"""Captured jobs (job search PR 2, decided 2026-11-10): a job the BDE adds by hand (`manual`) or from the extension
(`extension`, Arbaz's; it only calls the route). Not search providers: they have no `search`, only the `read` that
turns what was sent (`{title, company, description, url, location}`, stored as `content`) into the common fields.
A capture is its own batch (`scrape_jobs.kind = 'capture'`)."""
from backend.job_search.providers.base import JobFields
from backend.job_search.text import clean_str, html_to_text, safe_url

CAPTURE_SOURCES = ("manual", "extension")


class Capture:
    def __init__(self, name: str):
        self.name = name

    def read(self, content: dict) -> JobFields:
        description = content.get("description")
        # The extension reads the employer's page, so its description may be HTML; a manual one is plain text.
        text = html_to_text(description) if self.name == "extension" else (clean_str(description) or "")
        return JobFields(
            title=clean_str(content.get("title")) or "",
            company=clean_str(content.get("company")) or "",
            description=text,
            apply_url=safe_url(content.get("url")),
            location=clean_str(content.get("location")),
        )
