"""Job search PR 3 (docs/02 §6.z): the job screens' firm-level reads. One item per job (the content hash), newest
first, with the candidates it was found or captured for, limited to the candidates the principal sees: the owner and
a viewer the firm's, a manager their BDEs' candidates', a BDE their own. Another firm is the isolation sweep's."""
import pytest

from backend.tests.test_candidates_api import _create, world  # noqa: F401  (the fixture)
from backend.tests.test_job_search_api import _url, adnans  # noqa: F401  (the fixture)


def _capture(client, world, candidate, who, title):
    body = {"source": "manual", "title": title, "company": "Example Corp", "description": f"A made-up {title} job.",
            "url": "https://jobs.example.test/" + title.replace(" ", "-").lower()}
    r = client.post(_url(world, candidate, "job-postings"), json=body, headers=world["as"][who])
    assert r.status_code == 201, r.text
    return r.json()


@pytest.fixture
def jobs(anonymous_client, world, adnans):
    """Two candidates in two teams: the same shared job for both, and one job only the first has (captured last)."""
    other = _create(anonymous_client, world, manager="priya", bde="vikram")
    assert other.status_code == 201, other.text
    other = other.json()
    shared_a = _capture(anonymous_client, world, adnans, "adnan", "Shared Developer")
    shared_b = _capture(anonymous_client, world, other, "vikram", "Shared Developer")
    own = _capture(anonymous_client, world, adnans, "adnan", "Own Developer")
    return {"first": adnans["id"], "other": other["id"], "shared_a": shared_a, "shared_b": shared_b, "own": own}


def _list(client, world, who, **params):
    return client.get(f"/api/firms/{world['firm'].id}/job-postings", params=params, headers=world["as"][who])


def _one(client, world, who, posting_id):
    return client.get(f"/api/firms/{world['firm'].id}/job-postings/{posting_id}", headers=world["as"][who])


def _seen(r):
    assert r.status_code == 200, r.text
    return [(item["title"], item["candidate_ids"]) for item in r.json()["items"]]


@pytest.mark.parametrize("who", ["owner", "rohan"])
def test_the_owner_and_a_viewer_see_each_job_once_with_every_candidate(anonymous_client, world, jobs, who):
    both = sorted([jobs["first"], jobs["other"]])
    assert _seen(_list(anonymous_client, world, who)) == [("Own Developer", [jobs["first"]]),
                                                          ("Shared Developer", both)]


def test_a_manager_sees_their_bdes_candidates_only(anonymous_client, world, jobs):
    assert _seen(_list(anonymous_client, world, "fatima")) == [("Own Developer", [jobs["first"]]),
                                                               ("Shared Developer", [jobs["first"]])]
    assert _seen(_list(anonymous_client, world, "priya")) == [("Shared Developer", [jobs["other"]])]


def test_a_bde_sees_their_own_candidates_only(anonymous_client, world, jobs):
    assert _seen(_list(anonymous_client, world, "adnan")) == [("Own Developer", [jobs["first"]]),
                                                              ("Shared Developer", [jobs["first"]])]
    assert _seen(_list(anonymous_client, world, "vikram")) == [("Shared Developer", [jobs["other"]])]


def test_one_candidate_narrows_the_list_and_another_bdes_is_not_found(anonymous_client, world, jobs):
    assert _seen(_list(anonymous_client, world, "owner", candidate_id=jobs["other"])) == [
        ("Shared Developer", [jobs["other"]])]
    assert _list(anonymous_client, world, "adnan", candidate_id=jobs["other"]).status_code == 404


def test_the_limit_keeps_the_newest_jobs(anonymous_client, world, jobs):
    assert [title for title, _ in _seen(_list(anonymous_client, world, "owner", limit=1))] == ["Own Developer"]
    assert _list(anonymous_client, world, "owner", limit=401).status_code == 422


def test_an_item_is_the_job_not_one_candidates_posting(anonymous_client, world, jobs):
    item = _list(anonymous_client, world, "owner").json()["items"][0]
    assert "candidate_id" not in item and "batch_id" not in item and "description" not in item
    assert {"id", "title", "company", "apply_url", "location", "job_id", "source", "candidate_ids"} <= item.keys()


def test_one_job_has_its_description_and_the_candidates_the_principal_sees(anonymous_client, world, jobs):
    r = _one(anonymous_client, world, "owner", jobs["shared_a"]["id"])
    assert r.status_code == 200, r.text
    job = r.json()
    assert job["id"] == jobs["shared_a"]["id"] and job["description"] == "A made-up Shared Developer job."
    assert job["candidate_ids"] == sorted([jobs["first"], jobs["other"]])
    assert _one(anonymous_client, world, "vikram", jobs["shared_b"]["id"]).json()["candidate_ids"] == [jobs["other"]]


def test_a_job_outside_the_principals_candidates_is_not_found(anonymous_client, world, jobs):
    assert _one(anonymous_client, world, "vikram", jobs["own"]["id"]).status_code == 404
    assert _one(anonymous_client, world, "priya", jobs["shared_a"]["id"]).status_code == 404
    assert _one(anonymous_client, world, "owner", "00000000-0000-0000-0000-000000000000").status_code == 404
    # A malformed id (an old pool job's, from an application) is the same 404, not a 422.
    assert _one(anonymous_client, world, "owner", "job_001").status_code == 404
    assert _list(anonymous_client, world, "owner", candidate_id="cand_01").status_code == 404


def test_a_firm_with_no_jobs_lists_none(anonymous_client, world, adnans):
    assert _seen(_list(anonymous_client, world, "owner")) == []


# ── A searched job's whole posting, on its first open (decided 2026-11-11) ──

class _FullPostings:
    """freehire.me's single-job read, made up: counts the calls; `fail` makes the next ones fail."""
    name = "freehire"

    def __init__(self):
        self.calls, self.fail = 0, False

    async def full_description(self, content):
        from backend.job_search.providers.base import ProviderError
        self.calls += 1
        if self.fail:
            raise ProviderError("timeout")
        return content["description"] + "<p>The rest of the posting.</p>"


@pytest.fixture
def full_postings(monkeypatch):
    from backend.job_search import providers
    fake = _FullPostings()
    monkeypatch.setitem(providers.REGISTRY, "freehire", fake)
    return fake


def _searched(test_db, world, candidate, n=1):
    """A job a freehire.me search saved: its description cut like the search's."""
    import hashlib
    import uuid as uuid_
    from backend.models.db import utcnow
    from backend.models.job_search import JobPosting, ScrapeJob
    candidate_id = uuid_.UUID(candidate["id"])
    batch = ScrapeJob(firm_id=world["firm"].id, candidate_id=candidate_id, user_id=world["people"]["adnan"].id,
                      batch_id=uuid_.uuid4(), kind="search", state="success", finished_at=utcnow(), meta={})
    test_db.add(batch)
    test_db.flush()
    posting = JobPosting(firm_id=world["firm"].id, candidate_id=candidate_id, batch_id=batch.batch_id, source="freehire",
                         first_source="freehire", job_id=hashlib.sha256(f"searched-{n}-{uuid_.uuid4()}".encode()).hexdigest(),
                         content={"title": f"Searched Developer {n}", "company": "Example Corp", "public_slug": f"searched-{n}",
                                  "description": "<p>The start of the posting.</p>", "url": "https://jobs.example.test/s"})
    test_db.add(posting)
    test_db.commit()
    return str(posting.id)


def test_the_first_open_brings_the_whole_posting_and_keeps_it(anonymous_client, world, adnans, full_postings, test_db):
    posting_id = _searched(test_db, world, adnans)
    first = _one(anonymous_client, world, "adnan", posting_id).json()
    assert first["description"] == "The start of the posting.\nThe rest of the posting."
    again = _one(anonymous_client, world, "owner", posting_id).json()
    assert again["description"] == first["description"] and full_postings.calls == 1      # asked once, then kept


def test_a_failed_read_shows_the_search_text_and_is_tried_again(anonymous_client, world, adnans, full_postings, test_db):
    posting_id = _searched(test_db, world, adnans)
    full_postings.fail = True
    assert _one(anonymous_client, world, "adnan", posting_id).json()["description"] == "The start of the posting."
    full_postings.fail = False
    assert _one(anonymous_client, world, "adnan", posting_id).json()["description"].endswith("The rest of the posting.")
    assert full_postings.calls == 2


def test_a_captured_job_is_never_asked_for(anonymous_client, world, adnans, jobs, full_postings):
    assert _one(anonymous_client, world, "adnan", jobs["own"]["id"]).status_code == 200
    assert full_postings.calls == 0


def test_a_support_view_sees_the_whole_posting_but_never_writes_it(world, adnans, full_postings, test_db):
    """No platform-admin write into a firm: the support view's read fills the answer, not the row."""
    import types
    import uuid as uuid_
    from backend.api.routes_job_search import FULL_POSTING_KEY, _fill_full_posting
    from backend.models.job_search import JobPosting
    posting_id = _searched(test_db, world, adnans)
    row = test_db.get(JobPosting, uuid_.UUID(posting_id))
    _fill_full_posting(test_db, row, types.SimpleNamespace(kind="platform"))
    assert row.content["description"].endswith("<p>The rest of the posting.</p>")
    test_db.rollback()
    test_db.expire_all()
    stored = test_db.get(JobPosting, uuid_.UUID(posting_id)).content
    assert FULL_POSTING_KEY not in stored and stored["description"] == "<p>The start of the posting.</p>"


def test_the_whole_posting_does_not_overwrite_a_refresh_made_while_it_was_fetched(anonymous_client, world, adnans,
                                                                                  full_postings, test_db, monkeypatch):
    """A search refreshing the job while the single-job read waits keeps its fields (CodeRabbit on #135)."""
    import uuid as uuid_
    from backend.models.db import SessionLocal
    from backend.models.job_search import JobPosting
    posting_id = _searched(test_db, world, adnans)
    real = full_postings.full_description

    async def refreshed_meanwhile(content):
        with SessionLocal() as other:                    # the search, in its own session
            row = other.get(JobPosting, uuid_.UUID(posting_id))
            row.content = {**row.content, "location": "Refreshed City"}
            other.commit()
        return await real(content)
    monkeypatch.setattr(full_postings, "full_description", refreshed_meanwhile)
    assert _one(anonymous_client, world, "adnan", posting_id).status_code == 200
    test_db.expire_all()
    content = test_db.get(JobPosting, uuid_.UUID(posting_id)).content
    assert content["location"] == "Refreshed City" and content["_full_posting"] is True
    assert content["description"].endswith("<p>The rest of the posting.</p>")



def test_a_nul_in_the_whole_posting_is_cleaned_before_it_is_stored_or_shown(anonymous_client, world, adnans,
                                                                            full_postings, test_db, monkeypatch):
    """Postgres refuses \\u0000 in JSONB: an escaped NUL in the source's text would fail every open (Abdul on #135)."""
    import types
    import uuid as uuid_
    from backend.api.routes_job_search import FULL_POSTING_KEY, _fill_full_posting
    from backend.models.job_search import JobPosting

    async def with_nul(content):
        full_postings.calls += 1
        return content["description"] + "<p>The rest\u0000 of the posting.</p>"
    monkeypatch.setattr(full_postings, "full_description", with_nul)

    # A support view: shown clean, nothing written.
    supported = _searched(test_db, world, adnans, n=2)
    row = test_db.get(JobPosting, uuid_.UUID(supported))
    _fill_full_posting(test_db, row, types.SimpleNamespace(kind="platform"))
    assert "\x00" not in row.content["description"] and row.content["description"].endswith("The rest of the posting.</p>")
    test_db.rollback()
    test_db.expire_all()
    assert FULL_POSTING_KEY not in test_db.get(JobPosting, uuid_.UUID(supported)).content

    # The firm: the open succeeds, and the row keeps the clean text.
    posting_id = _searched(test_db, world, adnans)
    r = _one(anonymous_client, world, "adnan", posting_id)
    assert r.status_code == 200 and r.json()["description"] == "The start of the posting.\nThe rest of the posting."
    test_db.expire_all()
    stored = test_db.get(JobPosting, uuid_.UUID(posting_id)).content
    assert stored[FULL_POSTING_KEY] is True and "\x00" not in stored["description"]
