"""Job search PR 1, offline parts: the freehire.me provider, the outbound call's timeout / retry / cap / error codes,
the résumé country, the 6:30 PM IST day and the job identity. No network: httpx.MockTransport. Every job here is made
up (no real postings in the repo)."""
import asyncio
import json
from datetime import datetime, timedelta, timezone

import httpx
import pytest

from backend.job_search import http, limits
from backend.job_search.country import search_country
from backend.job_search.pipeline import job_id
from backend.job_search.providers import REGISTRY, ProviderError
from backend.job_search.providers.base import JobFields
from backend.job_search.providers.freehire import Freehire

MADE_UP_JOB = {
    "title": "Java Developer", "company": "Example Corp", "url": "https://jobs.example.test/apply/1",
    "description": "<p>Build <b>services</b> in Java.</p><ul><li>Spring</li><li>AWS</li></ul>",
    "location": "Austin, TX", "countries": ["US"], "skills": ["java", "spring"], "posted_at": "2026-11-09T11:00:00Z",
    "closed_at": None, "enrichment": {"employment_type": "contract"}, "my_vote": 0,
}


@pytest.fixture
def no_wait(monkeypatch):
    monkeypatch.setattr(http, "RETRY_DELAY_SECONDS", 0)


def _serve(monkeypatch, handler):
    calls = []

    def recording(request):
        calls.append(request)
        return handler(request, len(calls))
    monkeypatch.setattr(http, "transport", httpx.MockTransport(recording))
    return calls


def _search(query="java developer", country="us", limit=100):
    return asyncio.run(Freehire().search(query, country, limit))


# ── freehire.me ──────────────────────────────────────────────────────────────

def test_freehire_asks_for_the_country_and_100_jobs_and_keeps_each_job_as_sent(monkeypatch):
    calls = _serve(monkeypatch, lambda r, n: httpx.Response(200, json={"data": [MADE_UP_JOB], "meta": {"total": 1}}))
    result = _search()
    assert dict(calls[0].url.params) == {"q": "java developer", "countries": "us", "limit": "100"}
    assert result.jobs == [MADE_UP_JOB]                     # content is the source's own object (decided 2026-11-10)
    assert result.metadata["meta"] == {"total": 1} and "data" not in result.metadata


def test_freehire_read_gives_the_common_fields_in_plain_text():
    fields = Freehire().read(MADE_UP_JOB)
    assert (fields.title, fields.company, fields.apply_url) == ("Java Developer", "Example Corp",
                                                                "https://jobs.example.test/apply/1")
    assert fields.description == "Build services in Java.\nSpring\nAWS"
    assert (fields.countries, fields.skills, fields.employment_type, fields.is_closed) == (
        ("us",), ("java", "spring"), "contract", False)


def test_freehire_read_refuses_a_link_that_is_not_http_and_marks_a_closed_job():
    fields = Freehire().read({**MADE_UP_JOB, "url": "javascript:alert(1)", "closed_at": "2026-11-09T00:00:00Z"})
    assert fields.apply_url is None and fields.is_closed


def test_freehire_without_a_jobs_list_is_a_bad_response(monkeypatch):
    _serve(monkeypatch, lambda r, n: httpx.Response(200, json={"error": "nope"}))
    with pytest.raises(ProviderError) as e:
        _search()
    assert e.value.code == "bad_response"


def test_the_registry_has_freehire():
    assert "freehire" in REGISTRY


# ── the outbound call ────────────────────────────────────────────────────────

def test_a_5xx_is_retried_once_then_succeeds(monkeypatch, no_wait):
    calls = _serve(monkeypatch, lambda r, n: httpx.Response(503) if n == 1 else httpx.Response(200, json={"data": []}))
    assert _search().jobs == [] and len(calls) == 2


@pytest.mark.parametrize("status,code", [(429, "provider_unavailable"), (502, "provider_unavailable")])
def test_a_second_failure_ends_the_search_with_a_fixed_code(monkeypatch, no_wait, status, code):
    calls = _serve(monkeypatch, lambda r, n: httpx.Response(status, text="secret upstream body"))
    with pytest.raises(ProviderError) as e:
        _search()
    assert (e.value.code, len(calls)) == (code, 2)
    assert "secret" not in str(e.value)


@pytest.mark.parametrize("status", [400, 401, 404, 301])
def test_a_4xx_or_a_redirect_is_rejected_without_a_retry(monkeypatch, no_wait, status):
    calls = _serve(monkeypatch, lambda r, n: httpx.Response(status, headers={"location": "https://elsewhere.test"}))
    with pytest.raises(ProviderError) as e:
        _search()
    assert (e.value.code, len(calls)) == ("provider_rejected", 1)


def test_a_timeout_is_retried_then_reported(monkeypatch, no_wait):
    def slow(request, n):
        raise httpx.ReadTimeout("timed out", request=request)
    calls = _serve(monkeypatch, slow)
    with pytest.raises(ProviderError) as e:
        _search()
    assert (e.value.code, len(calls)) == ("timeout", 2)


def test_a_dropped_connection_is_retried(monkeypatch, no_wait):
    def drop(request, n):
        if n == 1:
            raise httpx.ConnectError("refused", request=request)
        return httpx.Response(200, json={"data": []})
    calls = _serve(monkeypatch, drop)
    assert _search().jobs == [] and len(calls) == 2


def test_a_body_over_5_mb_is_refused(monkeypatch, no_wait):
    monkeypatch.setattr(http, "MAX_BYTES", 1000)
    _serve(monkeypatch, lambda r, n: httpx.Response(200, content=json.dumps({"data": ["x" * 2000]}).encode()))
    with pytest.raises(ProviderError) as e:
        _search()
    assert e.value.code == "too_large"


def test_a_body_that_is_not_json_is_a_bad_response(monkeypatch, no_wait):
    _serve(monkeypatch, lambda r, n: httpx.Response(200, content=b"<html>maintenance</html>"))
    with pytest.raises(ProviderError) as e:
        _search()
    assert e.value.code == "bad_response"


def test_the_whole_call_has_a_time_limit(monkeypatch, no_wait):
    monkeypatch.setattr(http, "TIMEOUT_SECONDS", 0.05)

    async def hang(*args, **kwargs):
        await asyncio.sleep(1)
    monkeypatch.setattr(http, "_once", hang)
    with pytest.raises(ProviderError) as e:
        _search()
    assert e.value.code == "timeout"


def test_an_unknown_error_code_fails_loudly():
    with pytest.raises(ValueError):
        ProviderError("whatever")


# ── the country, the day, the identity ──────────────────────────────────────

@pytest.mark.parametrize("text,code", [("US", "us"), ("U.S.A.", "us"), (" united  states ", "us"),
                                       ("United States of America", "us"), ("Canada", "ca"), ("india", "in"),
                                       ("IN", "in"), ("", None), (None, None), ("Germany", None)])
def test_the_resume_country_maps_to_a_search_country_or_none(text, code):
    assert search_country(text) == code


@pytest.mark.parametrize("utc,start", [
    ("2026-11-10T12:59:00", "2026-11-09T13:00:00"),    # 6:29 PM IST: still yesterday's day
    ("2026-11-10T13:00:00", "2026-11-10T13:00:00"),    # 6:30 PM IST: a new day
    ("2026-11-10T19:00:00", "2026-11-10T13:00:00"),    # 12:30 AM IST: the same night
])
def test_the_day_starts_at_6_30_pm_ist(utc, start):
    now = datetime.fromisoformat(utc).replace(tzinfo=timezone.utc)
    assert limits.day_start(now) == datetime.fromisoformat(start).replace(tzinfo=timezone.utc)
    assert limits.next_reset(now) - limits.day_start(now) == timedelta(days=1)


def test_the_job_id_ignores_case_and_spacing_but_not_content():
    a = job_id(JobFields(title="Java Developer", company="Example Corp", description="Build  services."))
    b = job_id(JobFields(title="java developer ", company="EXAMPLE CORP", description="Build services."))
    c = job_id(JobFields(title="Java Developer", company="Example Corp", description="Build other services."))
    assert a == b != c and len(a) == 64


def test_the_time_limit_covers_the_retry_too(monkeypatch):
    """Two stalled attempts can't take 20 s each: the retry gets what is left of the whole call's limit."""
    import time
    monkeypatch.setattr(http, "TIMEOUT_SECONDS", 0.4)
    monkeypatch.setattr(http, "RETRY_DELAY_SECONDS", 0.05)

    async def hang(*args, **kwargs):
        await asyncio.sleep(5)
    monkeypatch.setattr(http, "_once", hang)
    started = time.monotonic()
    with pytest.raises(ProviderError) as e:
        _search()
    assert e.value.code == "timeout" and time.monotonic() - started < 0.7


# ── freehire.me's single-job read: the whole posting (job search PR 3, decided 2026-11-11) ──

def _full(content):
    return asyncio.run(Freehire().full_description(content))


def test_the_whole_posting_comes_from_the_job_by_its_slug_once_with_a_short_limit(monkeypatch):
    whole = "<p>Build services in Java.</p>" + "<p>More of the posting.</p>" * 60
    calls = _serve(monkeypatch, lambda request, n: httpx.Response(200, json={"data": {"description": whole}}))
    content = {**MADE_UP_JOB, "public_slug": "java-developer-example-corp-ab12cd"}
    assert _full(content) == whole
    assert [str(c.url) for c in calls] == ["https://freehire.me/api/v1/jobs/java-developer-example-corp-ab12cd"]


@pytest.mark.parametrize("slug", [None, "", "../admin", "Java Developer", "a" * 201, 7])
def test_no_call_without_a_plain_slug(monkeypatch, slug):
    calls = _serve(monkeypatch, lambda request, n: httpx.Response(200, json={"data": {"description": "x" * 5000}}))
    assert _full({**MADE_UP_JOB, "public_slug": slug}) is None
    assert calls == []


def test_nothing_longer_than_the_search_gave_is_none(monkeypatch):
    _serve(monkeypatch, lambda request, n: httpx.Response(200, json={"data": {"description": "<p>short</p>"}}))
    assert _full({**MADE_UP_JOB, "public_slug": "java-developer-1"}) is None


def test_a_failed_single_job_read_is_not_retried(monkeypatch, no_wait):
    calls = _serve(monkeypatch, lambda request, n: httpx.Response(502))
    with pytest.raises(ProviderError):
        _full({**MADE_UP_JOB, "public_slug": "java-developer-1"})
    assert len(calls) == 1


@pytest.mark.parametrize("reply", [{}, {"data": None}, {"data": {"title": "x"}}, {"data": {"description": 7}}])
def test_a_single_job_reply_without_the_job_is_a_failure(monkeypatch, reply):
    """A malformed reply is tried again on the next open, not marked done (CodeRabbit on #135)."""
    _serve(monkeypatch, lambda request, n: httpx.Response(200, json=reply))
    with pytest.raises(ProviderError) as e:
        _full({**MADE_UP_JOB, "public_slug": "java-developer-1"})
    assert e.value.code == "bad_response"

