"""One click, several sources (backend/job_search/fanout.py; decided 2026-11-17, Q90–Q93, Q122–Q124, Q145–Q146): which
sources each mode asks and with what share, LinkedIn's share held while the fast sources save, the same job from two
sources saved once, a leg whose jobs didn't fit read again next time, a failing leg not failing the click. Fake
sources only: no network; every job is made up."""
import asyncio
import uuid

import pytest

from backend.job_search import fanout, limits, pipeline
from backend.job_search.providers import REGISTRY, REMOTE, ProviderError
from backend.models.job_search import JobPosting, ScrapeJob
from backend.tests.test_candidates_api import world  # noqa: F401  (the fixture)
from backend.tests.test_job_search_api import FakeProvider, adnans  # noqa: F401  (the fixture)


def _jobs(prefix, n, start=0, company=None):
    return [{"t": f"{prefix} Engineer #{i}", "c": company or f"{prefix} Co {i}", "d": f"Made-up {prefix} job {i}.",
             "u": f"https://jobs.example.test/{prefix}/{i}"} for i in range(start, start + n)]


@pytest.fixture
def sources(monkeypatch):
    fakes = {}
    for name in ("linkedin", "indeed", "freehire"):
        fake = FakeProvider()
        fake.name = name
        fake.next_cursor = None
        monkeypatch.setitem(REGISTRY, name, fake)
        fakes[name] = fake
    return fakes


def _click(world, candidate, place):
    from backend.models.db import SessionLocal
    with SessionLocal() as db:
        batch = pipeline.open_batch(db, firm_id=world["firm"].id, candidate_id=uuid.UUID(candidate["id"]),
                                    user_id=world["people"]["adnan"].id, query="Java Developer", country="us",
                                    provider=pipeline.ALL_SOURCES, place=place)
        db.commit()
        batch_id = batch.batch_id
    summary = asyncio.run(pipeline.run_search(firm_id=world["firm"].id, candidate_id=uuid.UUID(candidate["id"]),
                                              user_id=world["people"]["adnan"].id, batch_id=batch_id,
                                              query="Java Developer", country="us",
                                              provider_name=pipeline.ALL_SOURCES, place=place))
    return summary, batch_id


def _batch(test_db, batch_id):
    test_db.expire_all()
    return test_db.query(ScrapeJob).filter(ScrapeJob.batch_id == batch_id).one()


def _saved(test_db, candidate):
    test_db.expire_all()
    rows = test_db.query(JobPosting).filter(JobPosting.candidate_id == uuid.UUID(candidate["id"])).all()
    out = {}
    for row in rows:
        out[row.source] = out.get(row.source, 0) + 1
    return out


def test_each_mode_asks_its_sources_with_their_shares():
    remote = [(leg.provider, leg.place, leg.quota) for leg in fanout.plan(REMOTE)]
    hybrid = [(leg.provider, leg.place, leg.quota) for leg in fanout.plan("hybrid:Austin, TX")]
    onsite = [(leg.provider, leg.place, leg.quota) for leg in fanout.plan("Austin, TX")]
    assert remote == [("indeed", REMOTE, 100), ("freehire", REMOTE, 40)]                     # LinkedIn sits out
    assert hybrid == [("linkedin", "Austin, TX", 100), ("indeed", "Austin, TX", 50), ("indeed", REMOTE, 50),
                      ("freehire", REMOTE, 40)]
    assert onsite == [("linkedin", "Austin, TX", 100), ("indeed", "Austin, TX", 100), ("freehire", "Austin, TX", 40)]


def test_a_hybrid_click_saves_every_sources_share_and_counts_them_by_source(world, adnans, sources, test_db):
    sources["linkedin"].jobs = _jobs("Li", 60)
    sources["indeed"].jobs = [{**job, "remote": True} for job in _jobs("In", 70)]      # fit the remote half too
    sources["freehire"].jobs = [{**job, "remote": True} for job in _jobs("Fh", 50)]
    summary, batch_id = _click(world, adnans, "hybrid:Austin, TX")
    # Indeed's two searches one after the other: the city, then remote.
    assert [ask["place"] for ask in sources["indeed"].asks] == ["Austin, TX", REMOTE]
    # Indeed: 50 city + 20 more remote; freehire.me: its 40, then 10 more into the gap LinkedIn left (60 of 100, Q123).
    assert _saved(test_db, adnans) == {"linkedin": 60, "indeed": 70, "freehire": 50}
    batch = _batch(test_db, batch_id)
    assert batch.state == "success" and batch.meta["counts"]["by_source"]["freehire"]["saved"] == 50
    assert summary.startswith("LinkedIn 60 · Indeed 70 · freehire.me 50 new")


def test_a_small_room_goes_to_linkedin_first(world, adnans, sources, test_db, monkeypatch):
    """Q146: 40 left today; the fast sources answer first, but LinkedIn's share is held for it."""
    monkeypatch.setattr(limits, "JOBS_PER_CANDIDATE_PER_DAY", 40)
    sources["linkedin"].jobs = _jobs("Li", 30)
    sources["indeed"].jobs = _jobs("In", 30)
    sources["freehire"].jobs = _jobs("Fh", 30)
    _click(world, adnans, "Austin, TX")
    assert _saved(test_db, adnans) == {"linkedin": 30, "indeed": 10}       # LinkedIn's 30, then Indeed fills the rest


def test_the_same_job_from_two_sources_is_saved_once(world, adnans, sources, test_db):
    """Q91: the same company and title."""
    sources["linkedin"].jobs = [{"t": "Java Developer", "c": "Acme Corp", "d": "LinkedIn's copy.", "u": "https://l.test/1"}]
    sources["indeed"].jobs = [{"t": "Java  Developer", "c": "ACME corp", "d": "Indeed's copy.", "u": "https://i.test/1"}]
    sources["freehire"].jobs = []
    _, batch_id = _click(world, adnans, "Austin, TX")
    assert sum(_saved(test_db, adnans).values()) == 1
    assert _batch(test_db, batch_id).meta["counts"]["skipped_duplicate_source"] == 1


def test_a_failing_source_does_not_fail_the_click_and_all_failing_does(world, adnans, sources, test_db):
    """Q93."""
    sources["linkedin"].error = "provider_rejected"
    sources["indeed"].jobs = _jobs("In", 5)
    sources["freehire"].jobs = _jobs("Fh", 5)
    for fake in sources.values():
        fake.next_cursor = "more"                                   # so the next click asks every source again
    _, batch_id = _click(world, adnans, "Austin, TX")
    batch = _batch(test_db, batch_id)
    assert batch.state == "success" and batch.meta["errors"] == {"linkedin|Austin, TX": "provider_rejected"}
    for fake in sources.values():
        fake.error = "timeout"
    summary, batch_id = _click(world, adnans, "Austin, TX")
    assert summary == "failed: timeout" and _batch(test_db, batch_id).state == "error"


def test_a_source_whose_jobs_did_not_fit_is_read_again_next_time(world, adnans, sources, test_db, monkeypatch):
    """Q92: 100 left today and Indeed brings 120 → 20 don't fit, so its place stays; freehire.me had none to keep, so
    it moves on."""
    monkeypatch.setattr(limits, "JOBS_PER_CANDIDATE_PER_DAY", 100)
    sources["linkedin"].jobs = []
    sources["indeed"].jobs = _jobs("In", 120)
    sources["indeed"].next_cursor = "indeed-page-2"
    sources["freehire"].jobs = []
    sources["freehire"].next_cursor = "40"
    _, batch_id = _click(world, adnans, "Austin, TX")
    legs = _batch(test_db, batch_id).meta["request"]["legs"]
    assert legs["indeed|Austin, TX"] == {"cursor": None, "exhausted": False}           # read again from the top
    assert legs["freehire|Austin, TX"] == {"cursor": "40", "exhausted": False}
    sources["indeed"].cursors.clear(); sources["freehire"].cursors.clear()
    _click(world, adnans, "Austin, TX")
    assert sources["indeed"].cursors == [None] and sources["freehire"].cursors == ["40"]


def test_remote_never_asks_linkedin(world, adnans, sources, test_db):
    sources["indeed"].jobs = [{**job, "remote": True} for job in _jobs("In", 3)]
    sources["freehire"].jobs = [{**job, "remote": True} for job in _jobs("Fh", 3)]
    _click(world, adnans, REMOTE)
    assert sources["linkedin"].calls == [] and _saved(test_db, adnans) == {"indeed": 3, "freehire": 3}


def test_an_error_code_is_one_of_the_known_ones():
    with pytest.raises(ValueError):
        ProviderError("not-a-code")


# ── the list: LinkedIn first, counts by source, batches, work mode (Q109, Q113, Q121) ──

def _list(client, world, candidate, **params):
    r = client.get(f"/api/firms/{world['firm'].id}/job-postings", params={"candidate_id": candidate["id"], **params},
                   headers=world["as"]["adnan"])
    assert r.status_code == 200, r.text
    return r.json()


def test_linkedin_first_counts_by_source_and_a_batch_keeps_what_it_first_found(anonymous_client, world, adnans,
                                                                              sources, test_db):
    sources["linkedin"].jobs = _jobs("Li", 2)
    sources["indeed"].jobs = _jobs("In", 2)
    sources["freehire"].jobs = []
    for fake in sources.values():
        fake.next_cursor = "more"                                   # each source has more for the next click
    _, first = _click(world, adnans, "Austin, TX")
    sources["linkedin"].jobs = _jobs("Li", 1, start=10)
    sources["indeed"].jobs = _jobs("In", 3)                               # 2 seen again, 1 new
    _, second = _click(world, adnans, "Austin, TX")
    for sort in ("match", "newest"):
        body = _list(anonymous_client, world, adnans, sort=sort)
        assert [item["source"] for item in body["items"]][:3] == ["linkedin"] * 3          # Q113
    assert _list(anonymous_client, world, adnans)["source_counts"] == {"linkedin": 3, "indeed": 3}
    assert _list(anonymous_client, world, adnans, batch=str(first))["total"] == 4          # seen again stays in 1
    batch_two = _list(anonymous_client, world, adnans, batch=str(second))
    assert batch_two["total"] == 2 and batch_two["source_counts"] == {"linkedin": 1, "indeed": 1}
    assert _list(anonymous_client, world, adnans, batch=str(second), source="indeed")["total"] == 1


def test_a_batch_names_one_of_the_candidates_searches(anonymous_client, world, adnans, sources):
    r = anonymous_client.get(f"/api/firms/{world['firm'].id}/job-postings", params={"batch": str(uuid.uuid4())},
                             headers=world["as"]["adnan"])
    assert r.status_code == 422                                           # no candidate named
    r = anonymous_client.get(f"/api/firms/{world['firm'].id}/job-postings",
                             params={"candidate_id": adnans["id"], "batch": str(uuid.uuid4())}, headers=world["as"]["adnan"])
    assert r.status_code == 404


def test_the_work_mode_is_what_the_source_says():
    """Q121: freehire.me's hybrid jobs showed as on-site; Indeed's "Hybrid work" label is hybrid."""
    from backend.api.routes_job_search import remote_mode
    from backend.job_search.providers.freehire import Freehire
    from backend.job_search.providers.indeed import Indeed
    hybrid = Freehire().read({"title": "Java Developer", "company": "Acme", "work_mode": "hybrid",
                              "location": "Austin, TX", "_description_format": "text"})
    assert remote_mode(hybrid) == "HYBRID"
    indeed = Indeed().read({"title": "Java Developer", "company_name": "Acme", "attributes": ["Hybrid work"]})
    assert remote_mode(indeed) == "HYBRID"
