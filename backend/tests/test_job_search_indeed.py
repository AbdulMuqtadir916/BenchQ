"""Indeed through python-jobspy (decided 2026-11-14): what one search sends, how it pages, how it fails, and how a
stored job reads. No network: jobspy's session is swapped for a fake that answers like Indeed's GraphQL API. Every
job here is made up (no real postings in the repo)."""
import asyncio
import json
import logging

import pytest
import requests

from backend.job_search.providers import REMOTE, ProviderError
from backend.job_search.providers import indeed as indeed_module
from backend.job_search.providers.indeed import Indeed


def _job(key: str, title: str = "Data Engineer", **extra) -> dict:
    """One made-up job as Indeed's GraphQL API returns it (the fields jobspy's query asks for)."""
    job = {
        "key": key, "title": title, "datePublished": 1762732800000, "dateOnIndeed": 1762732800000,
        "description": {"html": "<p>Build <b>pipelines</b> in Python.</p><ul><li>Spark</li></ul>"},
        "location": {"countryName": "United States", "countryCode": "US", "admin1Code": "TX", "city": "Austin",
                     "postalCode": None, "streetAddress": None,
                     "formatted": {"short": "Austin, TX", "long": "Austin, TX"}},
        "compensation": {"estimated": None, "baseSalary": None, "currencyCode": None},
        "attributes": [{"key": "CF3CP", "label": "Full-time"}],
        "employer": {"relativeCompanyPageUrl": "/cmp/example", "name": "Example Corp", "dossier": None},
        "recruit": {"viewJobUrl": "https://jobs.example.test/apply/1", "detailedSalary": None, "workSchedule": None},
        "source": {"name": "Example Corp"},
    }
    job.update(extra)
    return job


def _page(jobs: list[dict], next_cursor: str | None = None) -> dict:
    return {"data": {"jobSearch": {"pageInfo": {"nextCursor": next_cursor},
                                   "results": [{"trackingKey": "t", "job": j} for j in jobs]}}}


class _Response:
    def __init__(self, status: int, body: bytes, after=None):
        self.status_code, self._body, self._after = status, body, after

    def iter_content(self, size):
        for i in range(0, len(self._body), size):
            yield self._body[i:i + size]

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        if self._after:
            self._after()                       # e.g. the clock moves on once the page is read
        return False


class _Indeed:
    """jobspy's session, answering each POST from `replies` in turn: a dict (JSON), (status, bytes) or an exception."""

    def __init__(self, replies):
        self.replies, self.calls, self.after = list(replies), [], None

    def post(self, url, **kwargs):
        self.calls.append({"url": url, **kwargs})
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        if isinstance(reply, tuple):
            return _Response(*reply, after=self.after)
        return _Response(200, json.dumps(reply).encode(), after=self.after)

    def query(self, n: int = 0) -> str:
        return self.calls[n]["json"]["query"]


@pytest.fixture
def indeed(monkeypatch):
    """Installs a fake Indeed: `indeed(replies)` returns it."""
    import jobspy.indeed

    def install(replies):
        fake = _Indeed(replies)
        monkeypatch.setattr(jobspy.indeed, "create_session", lambda **kwargs: fake)
        return fake
    return install


def _search(query="Data Engineer", country="us", limit=100, cursor=None, place="Austin, TX", days=14):
    return asyncio.run(Indeed().search(query, country, limit, cursor, place=place, posted_within_days=days))


# ── what one search sends ───────────────────────────────────────────────────

def test_a_search_sends_the_role_the_place_within_50_miles_the_14_days_and_the_country(indeed):
    fake = indeed([_page([_job("a1")])])
    result = _search()
    sent = fake.query()
    assert 'what: "Data Engineer"' in sent
    assert 'location: {where: "Austin, TX", radius: 50, radiusUnit: MILES}' in sent
    assert 'field: "dateOnIndeed"' in sent and 'start: "336h"' in sent         # the only filter Indeed takes
    assert "cursor:" not in sent
    call = fake.calls[0]
    assert call["headers"]["indeed-co"] == "US" and call["url"] == "https://apis.indeed.com/graphql"
    assert call["verify"] is True and call["allow_redirects"] is False      # jobspy's own call has verify=False
    assert len(result.jobs) == 1 and result.next_cursor is None and result.metadata["pages"] == 1


@pytest.mark.parametrize("country,header", [("ca", "CA"), ("in", "IN")])
def test_canada_and_india_search_their_own_indeed(indeed, country, header):
    fake = indeed([_page([])])
    _search(country=country)
    assert fake.calls[0]["headers"]["indeed-co"] == header


def test_remote_searches_the_whole_country_for_remote_jobs_and_no_place_has_no_location(indeed):
    fake = indeed([_page([]), _page([])])
    _search(place=REMOTE)
    _search(place=None)
    # Indeed refuses a place without a radius, "Remote" included (live 2026-11-14).
    assert 'location: {where: "Remote", radius: 50, radiusUnit: MILES}' in fake.query(0)
    assert "location:" not in fake.query(1)


def test_a_quote_a_backslash_or_a_line_break_cant_break_the_query(indeed):
    """jobspy puts the place into the query as it is; here both are JSON-escaped and control characters go."""
    fake = indeed([_page([])])
    _search(query='Data "Lead" \\ Engineer', place='Austin",\nTX')
    sent = fake.query()
    assert 'what: "Data \\"Lead\\" \\\\ Engineer"' in sent
    assert 'where: "Austin\\", TX"' in sent


def test_an_unknown_country_never_reaches_indeed(indeed):
    fake = indeed([])
    with pytest.raises(ProviderError) as e:
        _search(country="de")
    assert e.value.code == "internal" and fake.calls == []


# ── paging: Indeed's own cursor, at most 3 requests, never an empty extra one ──

def test_one_page_with_no_more_is_one_request(indeed):
    fake = indeed([_page([_job(f"k{i}") for i in range(40)], next_cursor=None)])
    result = _search()
    assert len(fake.calls) == 1 and len(result.jobs) == 40 and result.next_cursor is None


def test_a_short_page_asks_for_the_next_until_100_and_keeps_indeeds_cursor(indeed):
    fake = indeed([_page([_job(f"a{i}") for i in range(60)], "c2"),
                   _page([_job(f"b{i}") for i in range(60)], "c3")])
    result = _search()
    assert len(fake.calls) == 2 and len(result.jobs) == 100 and result.next_cursor == "c3"
    assert 'cursor: "c2"' in fake.query(1)


def test_never_more_than_3_requests(indeed):
    fake = indeed([_page([_job(f"{p}{i}") for i in range(10)], f"c{p + 1}") for p in range(5)])
    result = _search()
    assert len(fake.calls) == 3 and len(result.jobs) == 30 and result.next_cursor == "c3"


def test_a_search_continues_from_the_cursor_it_is_given(indeed):
    fake = indeed([_page([_job("x")])])
    _search(cursor="abc")
    assert 'cursor: "abc"' in fake.query()


def test_the_same_job_on_a_later_page_is_kept_once(indeed):
    indeed([_page([_job("same"), _job("a")], "c2"), _page([_job("same"), _job("b")])])
    assert len(_search().jobs) == 3


def test_a_job_jobspy_cant_read_is_skipped_and_counted(indeed):
    broken = _job("bad")
    del broken["employer"]
    indeed([_page([_job("ok"), broken])])
    result = _search()
    assert len(result.jobs) == 1 and result.metadata["unreadable"] == 1


# ── failures: each is a failed search with a fixed code, never "0 jobs", never retried ──

@pytest.mark.parametrize("status,code", [(400, "provider_rejected"), (403, "provider_rejected"),
                                         (302, "provider_rejected"), (429, "provider_unavailable"),
                                         (503, "provider_unavailable")])
def test_a_refusal_or_an_outage_is_a_failed_search_with_one_request(indeed, status, code):
    fake = indeed([(status, b"secret upstream body")])
    with pytest.raises(ProviderError) as e:
        _search()
    assert (e.value.code, len(fake.calls)) == (code, 1)
    assert "secret" not in str(e.value)


def test_a_graphql_error_is_a_refused_search(indeed):
    """Indeed answers a query it won't run with 200 and `errors` (live 2026-11-14)."""
    indeed([{"errors": [{"message": "Conflicting filter types found."}], "data": None}])
    with pytest.raises(ProviderError) as e:
        _search()
    assert e.value.code == "provider_rejected"


@pytest.mark.parametrize("reply", [(200, b"<html>maintenance</html>"), {"data": {"other": 1}},
                                   {"data": {"jobSearch": {"results": "x"}}}])
def test_a_reply_without_jobs_is_a_bad_response(indeed, reply):
    indeed([reply])
    with pytest.raises(ProviderError) as e:
        _search()
    assert e.value.code == "bad_response"


@pytest.mark.parametrize("error,code", [(requests.Timeout("slow"), "timeout"),
                                        (requests.ConnectionError("refused"), "provider_unavailable")])
def test_a_timeout_or_a_dropped_connection_is_a_failed_search(indeed, error, code):
    fake = indeed([error])
    with pytest.raises(ProviderError) as e:
        _search()
    assert (e.value.code, len(fake.calls)) == (code, 1)


def test_a_failed_second_page_fails_the_whole_search(indeed):
    indeed([_page([_job(f"a{i}") for i in range(10)], "c2"), (403, b"")])
    with pytest.raises(ProviderError) as e:
        _search()
    assert e.value.code == "provider_rejected"


def test_a_page_over_5_mb_is_refused(indeed, monkeypatch):
    monkeypatch.setattr(indeed_module, "MAX_BYTES", 1000)
    indeed([(200, json.dumps(_page([_job("a")])).encode() * 3)])
    with pytest.raises(ProviderError) as e:
        _search()
    assert e.value.code == "too_large"


def test_the_time_limit_covers_reading_a_page(indeed, monkeypatch):
    monkeypatch.setattr(indeed_module, "TIME_LIMIT_SECONDS", 0.0)
    fake = indeed([_page([_job("a")], "c2")])
    with pytest.raises(ProviderError) as e:
        _search()
    assert e.value.code == "timeout" and len(fake.calls) == 1


def test_out_of_time_after_a_page_keeps_what_came_and_continues_there_next(indeed, monkeypatch):
    """Time runs out once the first page is read: no second request; the next search continues at Indeed's cursor."""
    clock = {"now": 1000.0}
    monkeypatch.setattr(indeed_module, "time", type("Clock", (), {"monotonic": staticmethod(lambda: clock["now"])}))
    fake = indeed([_page([_job("a")], "c2"), _page([_job("b")])])
    fake.after = lambda: clock.update(now=clock["now"] + indeed_module.TIME_LIMIT_SECONDS + 1)
    result = _search()
    assert len(fake.calls) == 1 and len(result.jobs) == 1 and result.next_cursor == "c2"


def test_the_logs_never_carry_the_role_or_the_place(indeed, caplog):
    indeed([_page([_job("a")]), (403, b"")])
    with caplog.at_level(logging.DEBUG):
        _search(query="Secret Role Name", place="Hiddenville, TX")
        with pytest.raises(ProviderError):
            _search(query="Secret Role Name", place="Hiddenville, TX")
    text = caplog.text
    assert "page=1" in text and "Secret" not in text and "Hiddenville" not in text


# ── how a stored job reads ──────────────────────────────────────────────────

def _stored(**extra) -> dict:
    """What a search stores for one job."""
    import jobspy.indeed
    fake = _Indeed([_page([_job("a", **extra)])])
    original = jobspy.indeed.create_session
    jobspy.indeed.create_session = lambda **kwargs: fake
    try:
        return _search().jobs[0]
    finally:
        jobspy.indeed.create_session = original


def test_a_stored_job_keeps_plain_job_types_the_labels_and_the_formatted_location():
    content = _stored(attributes=[{"key": "CF3CP", "label": "Full-time"}, {"key": "NJXCK", "label": "Contract"},
                                  {"key": "DSQF7", "label": "Remote"}],
                      location={**_job("x")["location"], "formatted": {"short": "Remote", "long": "Remote in Austin, TX"}})
    assert content["job_type"] == ["fulltime", "contract"]
    assert content["attributes"] == ["Full-time", "Contract", "Remote"]
    assert content["location_text"] == "Remote in Austin, TX"
    assert content["description"].startswith("<p>Build")                     # HTML; read() makes it plain text
    json.dumps(content)                                                     # stored as JSONB


def test_read_gives_the_common_fields_in_plain_text():
    fields = Indeed().read(_stored())
    assert (fields.title, fields.company) == ("Data Engineer", "Example Corp")
    assert fields.description == "Build pipelines in Python.\nSpark"
    assert fields.apply_url == "https://jobs.example.test/apply/1"            # the employer's link first
    assert (fields.location, fields.countries, fields.employment_type) == ("Austin, TX", ("us",), "fulltime")
    assert fields.posted_at == "2025-11-10" and fields.is_closed is False and fields.h1b_sponsor is False


def test_read_falls_back_to_indeeds_link_and_refuses_one_that_is_not_http():
    content = _stored(recruit=None)
    assert Indeed().read(content).apply_url.startswith("https://www.indeed.com/viewjob?jk=")
    assert Indeed().read({**content, "job_url": "javascript:alert(1)"}).apply_url is None


def test_remote_comes_from_indeeds_label_or_location_never_a_word_in_the_description():
    words = _stored(description={"html": "<p>Not remote. On site in Austin.</p>"})
    assert Indeed().read(words).is_remote is False
    labelled = _stored(attributes=[{"key": "DSQF7", "label": "Remote"}])
    assert Indeed().read(labelled).is_remote is True
    hybrid = _stored(attributes=[{"key": "PAXZC", "label": "Hybrid work"}])
    assert Indeed().read(hybrid).is_remote is False
    located = _stored(location={**_job("x")["location"], "formatted": {"short": "Remote", "long": "Remote"}})
    assert Indeed().read(located).is_remote is True
