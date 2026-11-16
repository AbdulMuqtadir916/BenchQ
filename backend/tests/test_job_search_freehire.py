"""freehire.me as a search source the BDE picks (decided 2026-11-16, Q53–Q56): the agent search's inputs (the role
on titles, a city's metro alone or the country, remote, 14 days, 100 from the last offset, the whole posting as text),
the key sent only when set, the reading of what it sends, the picker's choices, a search on the source picked, and the
job list's 14-day rule. No network: httpx.MockTransport. Every job here is made up (no real postings in the repo)."""
import asyncio
import uuid
from datetime import timedelta

import httpx
import pytest

from backend.job_search import http
from backend.job_search.providers import REMOTE, ProviderError
from backend.job_search.providers import freehire as fh
from backend.models.db import utcnow
from backend.tests.test_candidates_api import world  # noqa: F401  (the fixture)
from backend.tests.test_job_search_api import _job, _post, _run, _url, adnans, fake, launched  # noqa: F401

METROS = {"data": {"facets": {"metros": {"Austin (US)": 40, "Dallas (US)": 90, "Toronto (CA)": 30}}}}


def _made_up(n, **over):
    return {"title": f"Java Developer {n}", "company": f"Example {n}", "url": f"https://jobs.example.test/{n}",
            "description": f"Build services in Java {n}.\nUse x < y in code.", "location": "Austin, TX",
            "countries": ["us"], "posted_at": "2026-11-15T10:00:00Z", "closed_at": None, "work_mode": "onsite",
            "enrichment": {"employment_type": "contract"}, **over}


@pytest.fixture
def served(monkeypatch):
    """freehire.me, made up: the facets list and a search page of `page["jobs"]` with `page["total"]`. Records each
    search's parameters and headers."""
    monkeypatch.setattr(http, "RETRY_DELAY_SECONDS", 0)
    monkeypatch.setitem(fh._metros, "names", ())
    monkeypatch.setitem(fh._metros, "at", 0.0)
    page = {"jobs": [_made_up(1), _made_up(2)], "total": 2, "facets": 200, "searches": []}

    def handle(request):
        if request.url.path.endswith("/facets"):
            return httpx.Response(page["facets"], json=METROS)
        page["searches"].append({"params": dict(request.url.params), "headers": dict(request.headers)})
        offset = int(request.url.params.get("offset", 0))
        return httpx.Response(200, json={"data": page["jobs"], "meta": {"total": page["total"], "offset": offset}})
    monkeypatch.setattr(http, "transport", httpx.MockTransport(handle))
    return page


def _search(place, cursor=None, limit=100):
    return asyncio.run(fh.Freehire().search("Java Developer", "us", limit, cursor, place=place,
                                            posted_within_days=14))


def test_a_city_search_sends_its_metro_alone_and_asks_for_the_whole_posting(served, monkeypatch):
    monkeypatch.delenv("FREEHIRE_API_KEY", raising=False)
    result = _search("Austin, TX")
    params = served["searches"][0]["params"]
    assert params == {"q": "Java Developer", "q_fields": "title", "limit": "100", "offset": "0",
                      "description_format": "text", "source_exclude": "adzuna", "metros": "Austin (US)",
                      "posted_within_days": "14"}
    assert "authorization" not in served["searches"][0]["headers"]                # no key: none sent
    assert [job["_description_format"] for job in result.jobs] == ["text", "text"]
    assert result.next_cursor is None and result.metadata == {"total": 2, "by_metro": True, "skipped_adzuna": 0}


def test_a_remote_search_sends_the_country_and_remote_and_the_key_when_set(served, monkeypatch):
    monkeypatch.setenv("FREEHIRE_API_KEY", "made-up-key")
    _search(REMOTE)
    search = served["searches"][0]
    assert search["params"]["countries"] == "us" and search["params"]["work_mode"] == "remote"
    assert "metros" not in search["params"]
    assert search["headers"]["authorization"] == "Bearer made-up-key"


def test_a_city_with_no_metro_or_an_unreadable_facets_list_searches_the_country(served):
    _search("Smallville, KS")
    assert served["searches"][0]["params"]["countries"] == "us" and "metros" not in served["searches"][0]["params"]
    served["facets"] = 503
    fh._metros.update(names=(), at=0.0)
    _search("Austin, TX")
    assert served["searches"][1]["params"]["countries"] == "us"


def test_a_full_page_continues_from_its_offset(served):
    served["jobs"], served["total"] = [_made_up(n) for n in range(100)], 250
    first = _search("Austin, TX")
    assert first.next_cursor == "100"
    second = _search("Austin, TX", cursor=first.next_cursor)
    assert served["searches"][1]["params"]["offset"] == "100" and second.next_cursor == "200"
    served["total"] = 200                                                         # the last page: no more
    assert _search("Austin, TX", cursor="100").next_cursor is None


def test_an_adzuna_job_that_gets_through_is_left_out_and_counted(served):
    """Q64: `source_exclude=adzuna` is sent; one that comes back anyway (the parameter ignored) is dropped here."""
    served["jobs"] = [_made_up(1, source="greenhouse"), _made_up(2, source="adzuna"), _made_up(3, source="Adzuna")]
    result = _search("Austin, TX")
    assert [job["title"] for job in result.jobs] == ["Java Developer 1"]
    assert result.metadata["skipped_adzuna"] == 2


def test_an_ignored_source_exclude_is_logged_as_a_code(served, monkeypatch, caplog):
    monkeypatch.setattr(http, "transport", httpx.MockTransport(
        lambda r: httpx.Response(200, json=METROS if r.url.path.endswith("/facets") else
                                 {"data": [], "meta": {"total": 0, "ignored_params": ["source_exclude"]}})))
    with caplog.at_level("WARNING", logger="benchq.job_search"):
        _search("Austin, TX")
    assert "code=source_exclude_ignored" in caplog.text


def test_a_search_counts_the_adzuna_jobs_its_source_left_out(world, fake, adnans, test_db):
    from backend.models.job_search import ScrapeJob
    fake.jobs = [_job(1)]
    fake.metadata = {"skipped_adzuna": 4}
    _run(world, adnans)
    test_db.expire_all()
    batch = test_db.query(ScrapeJob).filter(ScrapeJob.candidate_id == uuid.UUID(adnans["id"])).one()
    assert batch.meta["counts"]["skipped_adzuna"] == 4 and batch.meta["counts"]["saved"] == 1


def test_a_reply_without_a_job_list_is_a_bad_response(served, monkeypatch):
    monkeypatch.setattr(http, "transport", httpx.MockTransport(
        lambda r: httpx.Response(200, json=METROS if r.url.path.endswith("/facets") else {"data": "nope"})))
    with pytest.raises(ProviderError) as error:
        _search("Austin, TX")
    assert error.value.code == "bad_response"


def test_a_saved_agent_job_reads_as_plain_text_and_its_work_mode():
    fields = fh.Freehire().read({**_made_up(1), "_description_format": "text", "work_mode": "remote"})
    assert fields.description == "Build services in Java 1.\nUse x < y in code."       # not read as HTML
    assert fields.is_remote and fields.employment_type == "contract" and fields.countries == ("us",)
    assert not fh.Freehire().read({**_made_up(1), "_description_format": "text"}).is_remote


# ── through the API ─────────────────────────────────────────────────────────

def test_the_bde_picks_the_source_and_the_list_names_both_indeed_first(anonymous_client, world, adnans, launched):
    r = anonymous_client.get(_url(world, adnans, "job-searches"), headers=world["as"]["adnan"])
    assert r.json()["sources"] == [{"value": "indeed", "label": "Indeed"}, {"value": "freehire", "label": "freehire.me"}]
    r = anonymous_client.post(_url(world, adnans, "job-searches"), json={"source": "freehire"},
                              headers=world["as"]["adnan"])
    assert r.status_code == 202 and launched[-1]["kwargs"]["provider_name"] == "freehire"
    r = anonymous_client.post(_url(world, adnans, "job-searches"), json={"source": "jobright"},
                              headers=world["as"]["adnan"])
    assert r.status_code == 422


def test_no_source_uses_the_platform_setting(anonymous_client, world, adnans, fake, launched):
    assert _post(anonymous_client, world, adnans).status_code == 202
    assert launched[-1]["kwargs"]["provider_name"] == "fake"


def test_the_job_list_shows_only_jobs_posted_in_the_last_14_days(anonymous_client, world, adnans, fake):
    today = utcnow().date()
    fake.jobs = [_job(1, posted=(today - timedelta(days=3)).isoformat()), _job(2, posted=today.isoformat()),
                 _job(3)]                                                          # no date: counts from today
    _run(world, adnans)
    from backend.models.db import SessionLocal
    from backend.models.job_search import JobPosting
    with SessionLocal() as db:                                                    # job 1 is now 20 days old
        row = db.query(JobPosting).filter(JobPosting.candidate_id == uuid.UUID(adnans["id"]),
                                          JobPosting.content["t"].astext == "Java Developer 1").one()
        row.content = {**row.content, "posted": (today - timedelta(days=20)).isoformat()}
        db.commit()
    r = anonymous_client.get(f"/api/firms/{world['firm'].id}/job-postings", params={"candidate_id": adnans["id"]},
                             headers=world["as"]["adnan"])
    assert r.status_code == 200
    assert sorted(item["title"] for item in r.json()["items"]) == ["Java Developer 2", "Java Developer 3"]
    assert r.json()["total"] == 2
