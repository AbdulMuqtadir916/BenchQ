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
