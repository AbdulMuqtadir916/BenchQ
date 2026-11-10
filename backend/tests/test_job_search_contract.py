"""Job search routes (PRs 1, 2), the way the r4 suites test the rest of the API: every malformed request is a 4xx,
never a 500; a failure in the middle of a search ends it as an error row, never a stuck one; two clicks at once start
one search; the same job captured twice at once is one posting. A fake provider: no network, made-up jobs."""
import asyncio
import threading
import uuid

import pytest

from backend.job_search import pipeline
from backend.tests.test_candidates_api import _create, world  # noqa: F401  (the fixture)
from backend.tests.test_job_search_api import (FakeProvider, _job, _open, _post, _rows, _run, _url,  # noqa: F401
                                               adnans, fake, launched)


def _capture_body(**over):
    return {"source": "manual", "title": "Java Developer", "company": "Example Corp",
            "description": "A made-up captured job.", "url": "https://jobs.example.test/captured", **over}


# ── contract: a malformed request is a 4xx ───────────────────────────────────

@pytest.mark.parametrize("body", [{}, {"query": None}, {"query": 5}, {"query": ["Java"]}, {"query": {"q": 1}},
                                  {"query": True}, {"q": "Java"}])
def test_a_search_body_of_the_wrong_shape_is_422(anonymous_client, world, adnans, fake, launched, body):
    r = anonymous_client.post(_url(world, adnans, "job-searches"), json=body, headers=world["as"]["adnan"])
    assert r.status_code == 422 and launched == []


@pytest.mark.parametrize("raw", [b"not json", b"", b"{", b"[1, 2]", b'"Java"'])
def test_a_search_body_that_is_not_an_object_is_422(anonymous_client, world, adnans, fake, launched, raw):
    r = anonymous_client.post(_url(world, adnans, "job-searches"), content=raw, headers=world["as"]["adnan"])
    assert r.status_code == 422 and launched == []


@pytest.mark.parametrize("over", [{"title": 5}, {"company": ["x"]}, {"description": None}, {"url": None},
                                  {"url": "ftp://jobs.example.test/x"}, {"url": "https://"}, {"location": 7},
                                  {"source": None}, {"url": "https://jobs.example.test/" + "x" * 2048}])
def test_a_capture_body_of_the_wrong_shape_is_422(anonymous_client, world, adnans, over):
    r = anonymous_client.post(_url(world, adnans, "job-postings"), json=_capture_body(**over),
                              headers=world["as"]["adnan"])
    assert r.status_code == 422, r.text


@pytest.mark.parametrize("tail", ["job-searches", "job-postings", f"job-postings/{uuid.uuid4()}"])
def test_a_malformed_candidate_id_is_422_and_a_missing_one_404(anonymous_client, world, tail):
    base = f"/api/firms/{world['firm'].id}/candidates"
    assert anonymous_client.get(f"{base}/not-a-uuid/{tail}", headers=world["as"]["owner"]).status_code == 422
    assert anonymous_client.get(f"{base}/{uuid.uuid4()}/{tail}", headers=world["as"]["owner"]).status_code == 404


def test_a_malformed_posting_id_is_422(anonymous_client, world, adnans):
    r = anonymous_client.get(_url(world, adnans, "job-postings/not-a-uuid"), headers=world["as"]["owner"])
    assert r.status_code == 422


@pytest.mark.parametrize("query", ["page=0", "page=1001", "page=x", "size=0", "size=101", "size=-1"])
def test_paging_out_of_range_is_422(anonymous_client, world, adnans, query):
    r = anonymous_client.get(_url(world, adnans, f"job-postings?{query}"), headers=world["as"]["owner"])
    assert r.status_code == 422


def test_a_page_past_the_end_is_empty_not_an_error(anonymous_client, world, adnans, fake):
    fake.jobs = [_job(1)]
    _run(world, adnans)
    body = anonymous_client.get(_url(world, adnans, "job-postings?page=9&size=10"), headers=world["as"]["owner"]).json()
    assert (body["items"], body["total"]) == ([], 1)


@pytest.mark.parametrize("method,tail", [("POST", "job-searches"), ("POST", "job-postings"),
                                         ("GET", "job-searches"), ("GET", "job-postings")])
def test_signed_out_is_401(anonymous_client, world, adnans, method, tail):
    r = anonymous_client.request(method, _url(world, adnans, tail), json={"query": "Java"} if method == "POST" else None)
    assert r.status_code == 401


# ── failure injection: a search never stays stuck ────────────────────────────

def test_a_database_error_while_saving_ends_the_search_as_an_internal_error(world, adnans, fake, test_db,
                                                                            monkeypatch):
    fake.jobs = [_job(1)]

    def broken_save(**kwargs):
        raise RuntimeError("the database went away")
    monkeypatch.setattr(pipeline, "_save", broken_save)
    assert _run(world, adnans) == "failed: internal"
    (batch,), postings = _rows(test_db, adnans)
    assert (batch.state, batch.meta["error_code"], postings) == ("error", "internal", [])
    assert batch.finished_at is not None


def test_a_job_the_provider_cannot_read_is_skipped_not_fatal(world, adnans, fake, test_db, monkeypatch):
    fake.jobs = [_job(1), _job(2)]
    real_read = fake.read

    def flaky_read(content):
        if content["t"].endswith("1"):
            raise ValueError("unexpected shape")
        return real_read(content)
    monkeypatch.setattr(fake, "read", flaky_read)
    assert _run(world, adnans) == "1 new, 0 seen again"
    (batch,), _ = _rows(test_db, adnans)
    assert batch.meta["counts"]["skipped_unreadable"] == 1


def test_metadata_the_database_cannot_store_is_cleaned(world, adnans, fake, test_db, monkeypatch):
    async def odd(query, country, limit, cursor=None):
        from backend.job_search.providers import SearchResult
        return SearchResult(jobs=[_job(1, extra=float("nan"))],
                            metadata={"note": "nul\x00byte", "ratio": float("inf"), "nested": [{"k": "\x07"}]})
    monkeypatch.setattr(fake, "search", odd)
    assert _run(world, adnans) == "1 new, 0 seen again"
    (batch,), (posting,) = _rows(test_db, adnans)
    assert (batch.meta["note"], batch.meta["ratio"], batch.meta["nested"]) == ("nulbyte", None, [{"k": ""}])
    assert posting.content["extra"] is None


def test_a_provider_error_after_a_lost_batch_writes_nothing(anonymous_client, world, adnans, fake, launched, test_db):
    from backend.tests.test_job_search_api import _lose
    fake.error = "timeout"
    lost = _open(world, adnans)
    _lose(test_db, lost)
    assert _post(anonymous_client, world, adnans).status_code == 202       # marks the lost one an error
    _run(world, adnans, batch_id=lost)
    test_db.expire_all()
    batches, _ = _rows(test_db, adnans)
    lost_row = next(b for b in batches if b.batch_id == lost)
    assert lost_row.meta.get("error_code") is None                          # the late task didn't overwrite it


# ── concurrency ──────────────────────────────────────────────────────────────

def _at_once(calls):
    results, gate = [None] * len(calls), threading.Barrier(len(calls))

    def go(i, call):
        gate.wait()
        results[i] = call()
    threads = [threading.Thread(target=go, args=(i, c)) for i, c in enumerate(calls)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(30)
    return results


def _poster(client, world, candidate, tail, body):
    """The request, built before the threads start: they mustn't share the test's ORM session."""
    url, headers = _url(world, candidate, tail), dict(world["as"]["adnan"])
    return lambda: client.post(url, json=body, headers=headers)


def test_two_clicks_at_once_start_one_search(anonymous_client, world, adnans, fake, launched, test_db):
    click = _poster(anonymous_client, world, adnans, "job-searches", {"query": "Java Developer"})
    results = _at_once([click, click])
    assert sorted(r.status_code for r in results) == [202, 409]
    batches, _ = _rows(test_db, adnans)
    assert [b.state for b in batches] == ["running"] and len(launched) == 1


def test_the_same_job_captured_twice_at_once_is_one_posting(anonymous_client, world, adnans, test_db):
    post = _poster(anonymous_client, world, adnans, "job-postings", _capture_body())
    results = _at_once([post, post])
    assert sorted(r.status_code for r in results) == [200, 201]
    batches, postings = _rows(test_db, adnans)
    assert len(postings) == 1 and len(batches) == 1


def test_two_searches_for_different_candidates_run_side_by_side(anonymous_client, world, adnans, fake, launched):
    other = _create(anonymous_client, world, bde="adnan").json()
    results = _at_once([_poster(anonymous_client, world, adnans, "job-searches", {"query": "Java Developer"}),
                        _poster(anonymous_client, world, other, "job-searches", {"query": "Java Developer"})])
    assert [r.status_code for r in results] == [202, 202]


def test_the_cap_holds_when_two_searches_finish_together(world, adnans, fake, test_db):
    """Two batches of 60 new jobs each, finished at once: the candidate lock makes the second count the first's."""
    fake.jobs = [_job(n) for n in range(60)]
    first = _open(world, adnans, query="Java Developer")
    second = _open(world, adnans, query="Spring Developer")
    jobs_b = [_job(n) for n in range(100, 160)]

    async def both():
        from backend.job_search.providers import SearchResult
        originals = {"Java Developer": list(fake.jobs), "Spring Developer": jobs_b}

        async def by_query(query, country, limit, cursor=None):
            return SearchResult(jobs=originals[query], metadata={})
        fake.search = by_query
        cid = uuid.UUID(adnans["id"])
        common = dict(firm_id=world["firm"].id, candidate_id=cid, user_id=world["people"]["adnan"].id,
                      country="us", provider_name="fake")
        return await asyncio.gather(
            pipeline.run_search(batch_id=first, query="Java Developer", **common),
            pipeline.run_search(batch_id=second, query="Spring Developer", **common))
    asyncio.run(both())
    _, postings = _rows(test_db, adnans)
    assert len(postings) == 100
