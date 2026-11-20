"""A job a candidate has (`job_postings`, docs/02 §6.y), read the one way: what it is, from its stored `content`.

`content` is whatever wrote the posting sent, by `source`:
- `manual` / `extension`: a job the BDE added for the candidate, by hand or from the extension
  (`{title, company, description, url, location}`; the extension's description may be the employer's HTML);
- `legacy`: a job copied from the old `jobs` pool when applications moved onto `job_postings` (migration 0026): the
  same keys plus `salary_min`, `salary_max` (whole dollars, when the old job had them), `posted_at`, `old_job_id` and
  `old_source`;
- a job search provider's own object (job search, Zuhair's #123), read by that provider's reader once it's here.

`posting_job()` turns any of them into `PostingJob`, so nothing else looks inside `content`: an application's title and
link, the ledger's labels, the prep page, inbox matching. `job_hash()` is a posting's identity for its candidate: the
job search pipeline's rule (company, title, description; docs/02 §6.y), so the same job added twice is one posting.
"""
import hashlib
import html
import logging
import re
from urllib.parse import urlsplit
from dataclasses import dataclass

logger = logging.getLogger(__name__)

ADDED_SOURCES = ("manual", "extension")
LEGACY = "legacy"
MAX_URL = 2048


@dataclass(frozen=True)
class PostingJob:
    """The common fields of one stored job, whatever wrote it. `description` is plain text; `url` an http(s) link."""
    title: str = ""
    company: str = ""
    description: str = ""
    url: str | None = None
    location: str | None = None
    posted_at: str | None = None
    employment_type: str | None = None
    source: str = ""
    # The pay a moved job listed (`legacy`, whole dollars) or a page stated (`extension`, its currency and period only
    # when named); how and where the job is done; its requisition ID (decided 2026-11-12). None when not stated.
    salary_min: int | float | None = None
    salary_max: int | float | None = None
    salary_currency: str | None = None
    salary_period: str | None = None
    work_mode: str | None = None
    requisition_id: str | None = None


EMPTY = PostingJob()

_TAG = re.compile(r"<[^>]+>")
_BREAK = re.compile(r"<\s*(br|/p|/div|/li|/h[1-6])\s*/?\s*>", re.IGNORECASE)
_DROP = re.compile(r"<\s*(script|style)[^>]*>.*?<\s*/\s*\1\s*>", re.IGNORECASE | re.DOTALL)


def _text(value) -> str:
    return str(value).strip() if isinstance(value, (str, int, float)) and not isinstance(value, bool) else ""


def plain_text(value) -> str:
    """An employer page's HTML as plain text: scripts and styles dropped, a line per block, entities read, spaces tidied."""
    raw = _text(value)
    if "<" not in raw and "&" not in raw:
        return raw
    text = html.unescape(_TAG.sub(" ", _BREAK.sub("\n", _DROP.sub(" ", raw))))
    lines = (re.sub(r"[ \t ]+", " ", line).strip() for line in text.splitlines())
    return "\n".join(line for line in lines if line)


def safe_url(value) -> str | None:
    """An http(s) link with a host, or None: never a script, a data URL, a relative path or `https://?x`."""
    url = _text(value)
    if not re.match(r"^https?://[^\s/]", url, re.IGNORECASE) or len(url) > MAX_URL:
        return None
    try:
        return url if urlsplit(url).hostname else None
    except ValueError:
        return None


def _provider_reader(source: str):
    """The job search pipeline's reader for its own providers (#123), when that code is here; None before."""
    try:
        from backend.job_search.providers import reader_for  # noqa: PLC0415 (absent until job search merges)
    except ImportError:
        return None
    return reader_for(source)


def read_content(source: str, content) -> PostingJob:
    """One stored `content` as `PostingJob`, read by the rules of the `source` that wrote it."""
    if source not in ADDED_SOURCES and source != LEGACY:
        reader = _provider_reader(source)
        if reader is not None:
            fields = reader.read(content or {})
            return PostingJob(title=fields.title, company=fields.company, description=fields.description,
                              url=fields.apply_url, location=fields.location, posted_at=fields.posted_at,
                              employment_type=fields.employment_type, source=source)
    found = content if isinstance(content, dict) else {}
    description = plain_text(found.get("description")) if source == "extension" else _text(found.get("description"))
    period, mode = _text(found.get("salary_period")), _text(found.get("work_mode"))
    currency = _text(found.get("salary_currency"))
    return PostingJob(title=_text(found.get("title")), company=_text(found.get("company")), description=description,
                      url=safe_url(found.get("url")), location=_text(found.get("location")) or None,
                      posted_at=_text(found.get("posted_at")) or None,
                      employment_type=_text(found.get("employment_type")) or None, source=source,
                      salary_min=_amount(found.get("salary_min")), salary_max=_amount(found.get("salary_max")),
                      salary_currency=currency if re.fullmatch(r"[A-Z]{3}", currency) else None,
                      salary_period=period if period in PAY_PERIODS else None,
                      work_mode=mode if mode in ("remote", "hybrid", "onsite") else None,
                      requisition_id=_text(found.get("requisition_id"))[:60] or None)


PAY_PERIODS = {"hour": "an hour", "day": "a day", "week": "a week", "month": "a month", "year": "a year"}


def _amount(value) -> int | float | None:
    """A pay bound as stored: a non-negative number, else none."""
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 <= value < float("inf"):
        return None
    return int(value) if float(value).is_integer() else value


def pay_text(job: PostingJob) -> str:
    """The pay a posting states, as words: "USD 120,000–150,000 a year", "65 an hour"; "" when it states none."""
    low, high = job.salary_min, job.salary_max
    if low is None and high is None:
        return ""
    amounts = [f"{value:,.2f}".removesuffix(".00") for value in dict.fromkeys(v for v in (low, high) if v is not None)]
    return " ".join(part for part in (job.salary_currency, "–".join(amounts), PAY_PERIODS.get(job.salary_period or ""))
                    if part)


def posting_job(posting) -> PostingJob:
    """What a `JobPosting` row is. A row its reader can't read is logged by its id only and shows as an empty job, so
    one bad row never fails a whole list."""
    if posting is None:
        return EMPTY
    try:
        return read_content(posting.source, posting.content)
    except Exception as error:  # a provider's own reader can raise on a malformed row
        logger.warning("posting %s unreadable: %s", posting.id, type(error).__name__)
        return PostingJob(source=posting.source)


def job_hash(company: str, title: str, description: str) -> str:
    """A job's identity for its candidate: SHA256 hex of company, title and description, each lowercased with its
    whitespace collapsed (the job search pipeline's rule, docs/02 §6.y). A content change is a new job by design."""
    def norm(value: str) -> str:
        return re.sub(r"\s+", " ", value or "").strip().lower()
    return hashlib.sha256("\x1f".join(norm(part) for part in (company, title, description)).encode("utf-8")).hexdigest()
