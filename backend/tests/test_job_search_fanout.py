"""One click, several sources (backend/job_search/fanout.py; decided 2026-11-17, Q90–Q93, Q145–Q146; the split since
2026-11-18, 07 Q71): which sources each mode asks and with what share, LinkedIn's share held while the fast sources save, the same job from two
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


def test_each_mode_asks_its_sources_for_their_shares_of_30():
    """07 Q71 (2026-11-18): (source, place, asked, kept, filler)."""
    def legs(place):
        return [(leg.provider, leg.place, leg.ask, leg.keep, leg.filler) for leg in fanout.plan(place)]
    assert limits.JOBS_PER_CANDIDATE_PER_DAY == 30
    assert legs(REMOTE) == [("indeed", REMOTE, 33, 30, False), ("freehire", REMOTE, 20, 20, True)]   # no LinkedIn
    assert legs("hybrid:Austin, TX") == [("linkedin", "Austin, TX", 25, 20, False), ("indeed", "Austin, TX", 10, 5, False),
                                         ("indeed", REMOTE, 10, 5, False), ("freehire", REMOTE, 20, 20, True)]
    assert legs("Austin, TX") == [("linkedin", "Austin, TX", 25, 20, False), ("indeed", "Austin, TX", 13, 10, False),
                                  ("freehire", "Austin, TX", 20, 20, True)]


def test_a_full_hybrid_click_is_linkedin_20_and_indeed_5_and_5_and_never_asks_freehire(world, adnans, sources, test_db):
    sources["linkedin"].jobs = _jobs("Li", 25)
    sources["indeed"].jobs = [{**job, "remote": True} for job in _jobs("In", 10)]      # fit the remote half too
    sources["freehire"].jobs = [{**job, "remote": True} for job in _jobs("Fh", 20)]
    summary, batch_id = _click(world, adnans, "hybrid:Austin, TX")
    # Indeed's two searches one after the other: the city, then remote; each asked for 10.
    assert [(ask["place"], call[2]) for ask, call in zip(sources["indeed"].asks, sources["indeed"].calls)] == \
        [("Austin, TX", 10), (REMOTE, 10)]
    assert sources["linkedin"].calls[0][2] == 25
    assert _saved(test_db, adnans) == {"linkedin": 20, "indeed": 10}
    assert sources["freehire"].calls == []                                  # the day was full
    batch = _batch(test_db, batch_id)
    assert batch.state == "success" and batch.meta["counts"]["by_source"]["linkedin"]["saved"] == 20
    assert summary.startswith("LinkedIn 20 · Indeed 10 new")


def test_linkedins_short_share_takes_indeeds_extras_then_freehire_fills_the_rest(world, adnans, sources, test_db):
    """07 Q71: LinkedIn brings 12 of its 20; Indeed's 3 beyond its 10 go first, then freehire.me is asked for 20."""
    sources["linkedin"].jobs = _jobs("Li", 12)
    sources["indeed"].jobs = _jobs("In", 13)
    sources["freehire"].jobs = _jobs("Fh", 20)
    _click(world, adnans, "Austin, TX")
    assert _saved(test_db, adnans) == {"linkedin": 12, "indeed": 13, "freehire": 5}
    assert sources["freehire"].calls[0][2] == 20


def test_linkedins_share_is_held_however_fast_indeed_answers(world, adnans, sources, test_db, monkeypatch):
    """Q146: 15 left today, less than LinkedIn's 20: Indeed answers first but saves nothing until LinkedIn has."""
    monkeypatch.setattr(limits, "JOBS_PER_CANDIDATE_PER_DAY", 15)
    sources["linkedin"].jobs = _jobs("Li", 25)
    sources["indeed"].jobs = _jobs("In", 13)
    sources["freehire"].jobs = _jobs("Fh", 20)
    _click(world, adnans, "Austin, TX")
    assert _saved(test_db, adnans) == {"linkedin": 15}
    assert sources["freehire"].calls == []


def test_remote_is_indeed_first_freehire_only_fills(world, adnans, sources, test_db):
    """07 Q71: no race on Remote: Indeed keeps up to 30 and freehire.me is asked only for the rest."""
    sources["indeed"].jobs = [{**job, "remote": True} for job in _jobs("In", 33)]
    sources["freehire"].jobs = [{**job, "remote": True} for job in _jobs("Fh", 20)]
    _click(world, adnans, REMOTE)
    assert _saved(test_db, adnans) == {"indeed": 30} and sources["freehire"].calls == []
    assert sources["indeed"].calls[0][2] == 33


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


def test_a_source_whose_jobs_did_not_fit_is_read_again_next_time(world, adnans, sources, test_db):
    """Q92: LinkedIn brings 25 and Indeed 13 → the day's 30 is full, 8 don't fit, so both keep their place; freehire.me
    wasn't asked."""
    sources["linkedin"].jobs, sources["linkedin"].next_cursor = _jobs("Li", 25), "li-2"
    sources["indeed"].jobs, sources["indeed"].next_cursor = _jobs("In", 13), "in-2"
    _, batch_id = _click(world, adnans, "Austin, TX")
    legs = _batch(test_db, batch_id).meta["request"]["legs"]
    assert legs["linkedin|Austin, TX"] == legs["indeed|Austin, TX"] == {"cursor": None, "exhausted": False}
    assert "freehire|Austin, TX" not in legs


def test_a_filler_whose_jobs_all_fit_moves_on(world, adnans, sources, test_db):
    """Q92 for freehire.me: asked because the day wasn't full, nothing it brought was left out, so it moves on."""
    sources["linkedin"].jobs, sources["linkedin"].next_cursor = [], None
    sources["indeed"].jobs, sources["indeed"].next_cursor = _jobs("In", 3), None
    sources["freehire"].jobs, sources["freehire"].next_cursor = _jobs("Fh", 4), "40"
    _, batch_id = _click(world, adnans, "Austin, TX")
    assert _saved(test_db, adnans) == {"indeed": 3, "freehire": 4}
    assert _batch(test_db, batch_id).meta["request"]["legs"]["freehire|Austin, TX"] == {"cursor": "40", "exhausted": False}
    sources["freehire"].cursors.clear()
    _click(world, adnans, "Austin, TX")
    assert sources["freehire"].cursors == ["40"]


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
