"""LinkedIn as a search source (decided 2026-11-16, Q75–Q86): the search's inputs (the titles in quotes joined by OR, the
place and 50 miles, or remote anywhere in the country, 14 days), 10 jobs a request 4 at a time from the cursor, what a
failed page keeps, the reading of a card (no description; its own id is its identity), and the posting fetched once
per firm on a job's first open, for every copy, then scored. No network: the queue's request is faked; every job and
card here is made up."""
import asyncio
import hashlib
import uuid

import pytest

from backend.job_search import linkedin_queue, pipeline
from backend.job_search.providers import REMOTE, ProviderError
from backend.job_search.providers import linkedin as li
from backend.tests.test_candidates_api import _create, world  # noqa: F401  (the fixture)
from backend.tests.test_job_search_api import adnans  # noqa: F401  (the fixture)


def _card(n: int, title="Java Developer", company="Example Corp", place="Austin, TX", posted="2026-11-15") -> str:
    return (f'<li><div class="base-search-card" data-entity-urn="urn:li:jobPosting:{1000000 + n}">'
            f'<a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/java-developer-at-example-{1000000 + n}?trk=x"></a>'
            f'<span class="sr-only">{title} {n}</span>'
            f'<h4 class="base-search-card__subtitle"><a href="https://www.linkedin.com/company/example?trk=y">{company}</a></h4>'
            f'<div class="base-search-card__metadata"><span class="job-search-card__location">{place}</span>'
            f'<time class="job-search-card__listdate" datetime="{posted}">1 day ago</time></div></div></li>')


@pytest.fixture
def pages(monkeypatch):
    """LinkedIn, made up: `pages[start]` is (status, n cards); records every request's params."""
    state = {"pages": {}, "asked": []}

    def get(url, params, headers, *, kind, firm_id, deadline):
        state["asked"].append({"url": url, "kind": kind, "firm_id": firm_id, **(params or {})})
        status, count = state["pages"].get(params["start"], (200, 0))
        return status, "".join(_card(params["start"] + i) for i in range(count)) if status == 200 else ""
    monkeypatch.setattr(linkedin_queue, "get", get)
    return state


def _search(place="Austin, TX", cursor=None, titles=("GenAI Engineer", "LLM Engineer", "Python Backend Engineer")):
    return asyncio.run(li.LinkedIn().search("GenAI / LLM Engineer | Python Backend Engineer", "us", 100, cursor,
                                            place=place, posted_within_days=14, titles=titles, firm_id="firm-1"))


def test_a_search_sends_the_titles_the_place_50_miles_and_14_days(pages):
    pages["pages"] = {0: (200, 10), 10: (200, 4)}
    result = _search()
    first = pages["asked"][0]
    assert first["keywords"] == '"GenAI Engineer" OR "LLM Engineer" OR "Python Backend Engineer"'
    assert (first["location"], first["distance"], first["f_TPR"], first["kind"], first["firm_id"]) == (
        "Austin, TX", 50, "r1209600", "search", "firm-1")
    assert "f_WT" not in first
    assert len(result.jobs) == 14 and result.next_cursor is None                    # a short page: no more


def test_one_title_is_searched_as_it_is_and_remote_is_the_whole_country(pages):
    pages["pages"] = {0: (200, 3)}
    _search(place=REMOTE, titles=("Java Developer",))
    asked = pages["asked"][0]
    assert (asked["keywords"], asked["location"], asked["f_WT"]) == ("Java Developer", "United States", 2)
    assert "distance" not in asked


def test_100_jobs_are_10_requests_4_at_a_time_and_the_next_search_continues(pages):
    pages["pages"] = {start: (200, 10) for start in range(0, 200, 10)}
    result = _search()
    assert sorted(a["start"] for a in pages["asked"]) == list(range(0, 100, 10))
    assert len(result.jobs) == 100 and result.next_cursor == "100"
    pages["asked"].clear()
    _search(cursor="100")
    assert min(a["start"] for a in pages["asked"]) == 100


def test_a_page_that_fails_keeps_what_came_before_it(pages):
    pages["pages"] = {0: (200, 10), 10: (200, 10), 20: (429, 0), 30: (200, 10)}
    result = _search()
    assert len(result.jobs) == 20 and result.next_cursor == "20" and result.metadata["stopped"] == "provider_unavailable"


def test_a_first_page_that_fails_fails_the_search(pages):
    pages["pages"] = {0: (403, 0)}
    with pytest.raises(ProviderError) as error:
        _search()
    assert error.value.code == "provider_rejected"


def test_a_card_reads_without_a_description_and_its_own_id_is_its_identity(pages):
    pages["pages"] = {0: (200, 2)}
    content = _search().jobs[0]
    fields = li.LinkedIn().read(content)
    assert (fields.title, fields.company, fields.location, fields.posted_at[:10]) == (
        "Java Developer 0", "Example Corp", "Austin, TX", "2026-11-15")
    assert fields.description == "" and fields.source_id == "linkedin:1000000"
    assert fields.apply_url == "https://www.linkedin.com/jobs/view/1000000"
    assert pipeline.job_id(fields) == hashlib.sha256(b"linkedin:1000000").hexdigest()
    assert pipeline._read(li.LinkedIn(), content) is not None                       # kept, though it has no text


def test_a_remote_searchs_jobs_count_as_remote():
    fields = li.LinkedIn().read({"title": "Java Developer", "company_name": "Example", "linkedin_id": "1234567",
                                 "searched_remote": True, "location": {"country": "usa"}})
    assert fields.is_remote and fields.location == "Remote"


# ── the posting, fetched once per firm on the first open (Q83, Q85, Q86) ──

def _saved(test_db, world, candidate, linkedin_id="7654321"):
    from backend.models.db import utcnow
    from backend.models.job_search import JobPosting, ScrapeJob
    candidate_id = uuid.UUID(candidate["id"])
    batch = ScrapeJob(firm_id=world["firm"].id, candidate_id=candidate_id, user_id=world["people"]["adnan"].id,
                      batch_id=uuid.uuid4(), kind="search", state="success", finished_at=utcnow(), meta={})
    test_db.add(batch)
    test_db.flush()
    content = {"title": "Java Developer", "company_name": "Example Corp", "linkedin_id": linkedin_id,
               "job_url": f"https://www.linkedin.com/jobs/view/{linkedin_id}", "date_posted": utcnow().date().isoformat(),
               "location": {"city": "Austin", "state": "TX", "country": "usa"}}
    posting = JobPosting(firm_id=world["firm"].id, candidate_id=candidate_id, batch_id=batch.batch_id,
                         source="linkedin", first_source="linkedin",
                         job_id=hashlib.sha256(f"linkedin:{linkedin_id}".encode()).hexdigest(), content=content)
    test_db.add(posting)
    test_db.commit()
    return posting.id


@pytest.fixture
def postings(monkeypatch):
    calls = []

    def posting(linkedin_id, firm_id, deadline):
        calls.append((linkedin_id, firm_id))
        return {"description": "<p>Build Java services with Spring.</p><p>US citizens only.</p>",
                "job_url_direct": "https://jobs.example.test/apply/7654321"}
    monkeypatch.setattr(li, "_posting", posting)
    return calls


def test_the_first_open_fetches_the_posting_once_for_every_copy_in_the_firm(anonymous_client, world, adnans,
                                                                           postings, test_db):
    from backend.models.job_search import JobPosting
    other = _create(anonymous_client, world, bde="adnan").json()
    first, second = _saved(test_db, world, adnans), _saved(test_db, world, other)
    r = anonymous_client.get(f"/api/firms/{world['firm'].id}/job-postings/{first}", headers=world["as"]["adnan"])
    assert r.status_code == 200 and "Build Java services with Spring." in r.json()["description"]
    assert r.json()["apply_url"] == "https://jobs.example.test/apply/7654321"       # the employer's own link
    assert postings == [("7654321", world["firm"].id)]
    test_db.expire_all()
    for posting_id in (first, second):
        row = test_db.get(JobPosting, posting_id)
        assert row.content["_full_posting"] is True and row.match_score is not None  # every copy, then scored
    anonymous_client.get(f"/api/firms/{world['firm'].id}/job-postings/{second}", headers=world["as"]["owner"])
    assert len(postings) == 1                                                       # kept: never asked again


def test_a_job_without_its_text_is_saved_unscored(world, adnans, test_db):
    from backend.match import store
    fields = li.LinkedIn().read({"title": "Java Developer", "company_name": "Example", "linkedin_id": "1234567"})
    row = type("Row", (), {"match_basis": None, "match_score": None})()
    scorer = store.Scorer(who=None, resume_id=uuid.uuid4(), resume=object())
    assert store.apply(row, scorer, fields) is False and row.match_score is None


# ── the candidate's level and LinkedIn's newest-job date (decided 2026-11-17, Q96, Q98) ──

def test_other_levels_are_left_out_by_words():
    assert li.keywords("x", ["AI Engineer", "LLM Engineer"], "entry") == (
        '("AI Engineer" OR "LLM Engineer") NOT Senior NOT Lead NOT Principal NOT Staff NOT Manager NOT Director')
    assert li.keywords("x", ["Java Developer"], "senior") == "(Java Developer) NOT Junior NOT Intern NOT Entry"
    assert li.keywords("Java Developer", (), None) == "Java Developer"


def test_a_newest_jobs_date_is_read_from_linkedins_new_tag(pages):
    html = _card(1).replace('class="job-search-card__listdate" datetime="2026-11-15"',
                            'class="job-search-card__listdate--new" datetime="2026-11-17"')
    jobs, _ = li._cards(html, li._scraper("us"), False)
    assert jobs[0]["date_posted"] == "2026-11-17"
