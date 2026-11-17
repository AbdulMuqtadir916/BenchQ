"""Job search PR 1 through the API and the pipeline (decided 2026-11-10): who may search (the candidate's BDE only),
the country from the résumé, the caps (100 new jobs per candidate, 20 attempts per BDE, per 6:30 PM IST day), one
search per candidate at a time, the batch and its postings in one transaction, a repeat match refreshed, errors as
fixed codes, and the reads. A fake provider: no network, made-up jobs."""
import asyncio
import time
import uuid
from datetime import timedelta

import pytest

from backend.job_search import limits, pipeline, providers
from backend.job_search.providers import JobFields, ProviderError, SearchResult
from backend.tests.test_candidates_api import _create, world  # noqa: F401  (the fixture)


class FakeProvider:
    name = "fake"
    label = "Fake source"

    def __init__(self):
        self.jobs: list[dict] = []
        self.error: str | None = None
        self.next_cursor: str | None = "more"      # the source has more by default; None: it ran out
        self.calls: list[tuple] = []
        self.cursors: list = []
        self.asks: list[dict] = []                  # the place and the age each search asked for
        self.metadata: dict = {}                    # more of the source's metadata (a count it left out itself)

    async def search(self, query, country, limit, cursor=None, *, place=None, posted_within_days=None, titles=(),
                     years=None, level=None, firm_id=None):
        self.calls.append((query, country, limit))
        self.cursors.append(cursor)
        self.asks.append({"place": place, "posted_within_days": posted_within_days, "titles": list(titles or ()),
                          "years": years, "level": level, "firm_id": firm_id})
        if self.error:
            raise ProviderError(self.error)
        return SearchResult(jobs=list(self.jobs), metadata={"meta": {"total": len(self.jobs)}, **self.metadata},
                            next_cursor=self.next_cursor)

    def read(self, content):
        return JobFields(title=content.get("t", ""), company=content.get("c", ""), description=content.get("d", ""),
                         apply_url=content.get("u"), location=content.get("loc"), is_closed=bool(content.get("closed")),
                         posted_at=content.get("posted"), is_remote=bool(content.get("remote")))


def _job(n, **over):
    return {"t": f"Java Developer #{n}", "c": f"Example {n}", "d": f"Made-up description {n}.",
            "u": f"https://jobs.example.test/{n}", **over}


@pytest.fixture
def fake(monkeypatch, test_db):
    from backend.models.db import Setting
    provider = FakeProvider()
    monkeypatch.setitem(providers.REGISTRY, "fake", provider)
    test_db.merge(Setting(key=providers.SETTING_KEY, value="fake"))
    test_db.commit()
    return provider


@pytest.fixture
def launched(monkeypatch):
    """POST without the background task: the launch is recorded; the batch the POST wrote stays `running`."""
    from backend.api import routes_job_search
    calls = []

    def launch(job_type, func, scope_key=None, meta=None, func_kwargs=None, **kw):
        calls.append({"job_type": job_type, "scope_key": scope_key, "meta": meta, "kwargs": func_kwargs})
        return str(uuid.uuid4())
    monkeypatch.setattr(routes_job_search, "launch_background", launch)
    return calls


def _url(world, candidate, tail):
    return f"/api/firms/{world['firm'].id}/candidates/{candidate['id']}/{tail}"


def _post(client, world, candidate, who="adnan", place=None):
    """"Find jobs": the candidate's target role in `place` (none: their first place)."""
    return client.post(_url(world, candidate, "job-searches"), json={"place": place} if place else {},
                       headers=world["as"][who])


def _open(world, candidate, query="Java Developer", country="us", provider="fake", place="Austin, TX"):
    """The `running` batch, as the POST writes it."""
    from backend.models.db import SessionLocal
    with SessionLocal() as db:
        batch = pipeline.open_batch(db, firm_id=world["firm"].id, candidate_id=uuid.UUID(candidate["id"]),
                                    user_id=world["people"]["adnan"].id, query=query, country=country,
                                    provider=provider, place=place)
        db.commit()
        return batch.batch_id


def _run(world, candidate, query="Java Developer", country="us", provider="fake", batch_id=None, place="Austin, TX"):
    batch_id = batch_id or _open(world, candidate, query, country, provider, place)
    return asyncio.run(pipeline.run_search(firm_id=world["firm"].id, candidate_id=uuid.UUID(candidate["id"]),
                                           user_id=world["people"]["adnan"].id, batch_id=batch_id, query=query,
                                           country=country, provider_name=provider, place=place))


@pytest.fixture
def adnans(anonymous_client, world):
    """A candidate whose BDE is Adnan, with US as their résumé country."""
    r = _create(anonymous_client, world, bde="adnan")
    assert r.status_code == 201, r.text
    return r.json()


# ── who ──────────────────────────────────────────────────────────────────────

def test_the_candidates_bde_starts_a_search_in_the_background(anonymous_client, world, adnans, fake, launched,
                                                              test_db):
    from backend.models.job_search import ScrapeJob
    r = _post(anonymous_client, world, adnans)
    assert r.status_code == 202, r.text
    call = launched[0]
    assert call["job_type"] == "job_search" and call["meta"] is None      # the run names nothing of the firm's
    assert call["kwargs"]["query"] == "Java Developer" and call["kwargs"]["country"] == "us"
    assert call["kwargs"]["place"] == "Austin, TX"                         # the first place: the picker's default
    assert call["kwargs"]["provider_name"] == "fake" and call["kwargs"]["user_id"] == world["people"]["adnan"].id
    batch_id = uuid.UUID(r.json()["batch_id"])
    assert call["kwargs"]["batch_id"] == batch_id and call["scope_key"] == str(batch_id)
    row = test_db.query(ScrapeJob).filter(ScrapeJob.batch_id == batch_id).one()
    assert (row.state, row.finished_at, row.user_id) == ("running", None, world["people"]["adnan"].id)
    assert row.meta["run_id"] == r.json()["run_id"] and row.meta["request"]["query"] == "Java Developer"


@pytest.mark.parametrize("who", ["owner", "fatima", "rohan"])
def test_the_owner_a_manager_and_a_viewer_cannot_search(anonymous_client, world, adnans, fake, launched, who):
    assert _post(anonymous_client, world, adnans, who=who).status_code == 403
    assert launched == []


def test_another_bde_does_not_see_the_candidate(anonymous_client, world, adnans, fake, launched):
    assert _post(anonymous_client, world, adnans, who="vikram").status_code == 404


def test_nobody_searches_for_a_candidate_without_a_bde(anonymous_client, world, fake, launched):
    from backend.auth.policy import can_search_jobs
    from backend.auth.sessions import Principal
    c = _create(anonymous_client, world).json()
    bde = Principal(kind="firm", user_id=world["people"]["adnan"].id, session_id=uuid.uuid4(),
                    firm_id=world["firm"].id, role="BDE")
    assert not can_search_jobs(bde, type("C", (), {"bde_id": None})())
    assert _post(anonymous_client, world, c, who="adnan").status_code == 404     # not in Adnan's scope either


def test_another_firm_is_not_found(anonymous_client, world, adnans, fake, launched):
    r = anonymous_client.post(f"/api/firms/{uuid.uuid4()}/candidates/{adnans['id']}/job-searches",
                              json={}, headers=world["as"]["adnan"])
    assert r.status_code == 404


# ── the role and the place (decided 2026-11-14) ─────────────────────────────

def test_the_role_is_the_target_role_never_the_primary_role_or_the_request(anonymous_client, world, fake, launched,
                                                                          test_db):
    from backend.models.candidates import Candidate
    c = _create(anonymous_client, world, bde="adnan", primary_role="Backend Engineer").json()
    # A candidate from before onboarding took one role (Q11) keeps several; the search uses the first.
    test_db.query(Candidate).filter(Candidate.id == uuid.UUID(c["id"])).update(
        {Candidate.target_roles: ["  Data  Engineer ", "Analytics Engineer"]})
    test_db.commit()
    assert anonymous_client.post(_url(world, c, "job-searches"), json={"query": "Anything Else"},
                                 headers=world["as"]["adnan"]).status_code == 202
    assert launched[0]["kwargs"]["query"] == "Data Engineer"               # the first target role


def test_the_bde_picks_one_of_the_candidates_places(anonymous_client, world, fake, launched, test_db):
    c = _create(anonymous_client, world, bde="adnan", city="Plano", state="TX",
                preferred_locations=["Austin, TX", "Remote"], work_settings=["HYBRID"]).json()
    body = anonymous_client.get(_url(world, c, "job-searches"), headers=world["as"]["adnan"]).json()
    assert body["role"] == "Java Developer"
    assert [(p["value"], p["kind"]) for p in body["places"]] == [
        ("Plano, TX", "home"), ("Austin, TX", "preferred"), ("remote", "remote")]
    assert body["places"][2]["label"] == "Remote (anywhere in the US)"
    assert _post(anonymous_client, world, c, place="austin, tx").status_code == 202
    assert _post(anonymous_client, world, c, place="remote").status_code == 409      # one already runs
    assert launched[0]["kwargs"]["place"] == "Austin, TX"


@pytest.mark.parametrize("place", ["Seattle, WA", "x" * 201, ""])
def test_a_place_that_isnt_the_candidates_is_refused(anonymous_client, world, adnans, fake, launched, place):
    r = _post(anonymous_client, world, adnans, place=place) if place else anonymous_client.post(
        _url(world, adnans, "job-searches"), json={"place": ""}, headers=world["as"]["adnan"])
    assert r.status_code == 422 and launched == []


def test_no_search_without_a_target_role_or_a_place(anonymous_client, world, fake, launched, test_db):
    from backend.models.candidates import Candidate
    c = _create(anonymous_client, world, bde="adnan").json()
    # A candidate from before onboarding required a place (Q14, Q23) may have none.
    test_db.query(Candidate).filter(Candidate.id == uuid.UUID(c["id"])).update({Candidate.preferred_locations: []})
    test_db.commit()
    r = _post(anonymous_client, world, c)
    assert r.status_code == 422 and "city and state on their résumé, or a preferred location" in r.json()["detail"]
    test_db.query(Candidate).filter(Candidate.id == uuid.UUID(c["id"])).update(
        {Candidate.target_roles: [], Candidate.preferred_locations: ["Austin, TX"]})
    test_db.commit()
    r = _post(anonymous_client, world, c)
    assert r.status_code == 422 and "target role" in r.json()["detail"] and launched == []


def test_remote_is_a_place_when_the_work_settings_say_so(anonymous_client, world, fake, launched):
    c = _create(anonymous_client, world, bde="adnan", work_settings=["REMOTE"]).json()
    body = anonymous_client.get(_url(world, c, "job-searches"), headers=world["as"]["adnan"]).json()
    assert [p["value"] for p in body["places"]] == ["Austin, TX", "remote"]


# ── what a search leaves out (decided 2026-11-14) ───────────────────────────

def _counts(test_db, candidate):
    return _rows(test_db, candidate)[0][-1].meta["counts"]


def test_a_job_posted_over_14_days_ago_is_left_out_and_one_without_a_date_is_kept(world, adnans, fake, test_db):
    from datetime import timedelta
    from backend.models.db import utcnow
    day = lambda n: (utcnow() - timedelta(days=n)).date().isoformat()   # noqa: E731
    fake.jobs = [_job(1, posted=day(14)), _job(2, posted=day(15)), _job(3, posted=day(400)), _job(4),
                 _job(5, posted="not a date")]
    assert _run(world, adnans) == "3 new, 0 seen again"
    assert _counts(test_db, adnans)["skipped_too_old"] == 2


def test_a_remote_search_keeps_only_remote_jobs(world, adnans, fake, test_db):
    from backend.job_search.providers import REMOTE
    fake.jobs = [_job(1, remote=True), _job(2), _job(3, remote=True)]
    assert _run(world, adnans, place=REMOTE) == "2 new, 0 seen again"
    assert _counts(test_db, adnans)["skipped_not_remote"] == 1
    fake.jobs = [_job(4)]
    assert _run(world, adnans) == "1 new, 0 seen again"                  # a city search keeps on-site jobs


def test_a_job_whose_text_rules_out_the_candidates_work_authorization_is_left_out(world, adnans, fake, test_db):
    """Adnan's candidate is H-1B and needs sponsorship and a transfer (the test body)."""
    fake.jobs = [_job(1, d="We do not sponsor visas."), _job(2, d="US citizens only."), _job(3, d="No H1B transfers."),
                 _job(4, d="Green card holders only."), _job(5, d="Build pipelines."), _job(6, t="Engineer (USC only)",
                 d="Python.")]
    assert _run(world, adnans) == "1 new, 0 seen again"                  # the title counts too ("USC only")
    assert _counts(test_db, adnans)["skipped_work_auth"] == 5


def test_a_citizen_keeps_citizens_only_jobs(anonymous_client, world, fake, test_db):
    c = _create(anonymous_client, world, bde="adnan", work_auth="USC", needs_sponsorship=False,
                needs_transfer=False).json()
    fake.jobs = [_job(1, d="US citizens only."), _job(2, d="Active secret clearance.")]
    assert _run(world, c) == "2 new, 0 seen again"


def test_each_place_continues_from_its_own_last_search(world, adnans, fake):
    """The next 100 of a role is per place: Dallas starts at the top after Austin's search went on."""
    fake.next_cursor = "page-2"
    _run(world, adnans)
    _run(world, adnans, place="Dallas, TX")
    _run(world, adnans)
    assert fake.cursors == [None, None, "page-2"]
    assert [a["place"] for a in fake.asks] == ["Austin, TX", "Dallas, TX", "Austin, TX"]


# ── the country ──────────────────────────────────────────────────────────────

@pytest.mark.parametrize("country", [None, "Germany"])
def test_no_search_without_a_us_canada_or_india_resume_country(anonymous_client, world, test_db, fake, launched,
                                                               country):
    from backend.models.db import Resume
    c = _create(anonymous_client, world, bde="adnan").json()
    test_db.query(Resume).filter(Resume.candidate_id == uuid.UUID(c["id"])).update({Resume.country: country})
    test_db.commit()
    r = _post(anonymous_client, world, c)
    assert r.status_code == 422 and "country" in r.json()["detail"]
    assert launched == []


# ── caps and one at a time ───────────────────────────────────────────────────

def test_a_second_search_while_one_runs_is_refused(anonymous_client, world, adnans, fake, launched):
    assert _post(anonymous_client, world, adnans).status_code == 202
    r = _post(anonymous_client, world, adnans, place="Austin, TX")
    assert r.status_code == 409 and len(launched) == 1


def _lose(test_db, batch_id):
    """The batch started longer ago than a search may run: a restart lost it."""
    from backend.models.db import utcnow
    from backend.models.job_search import ScrapeJob
    test_db.query(ScrapeJob).filter(ScrapeJob.batch_id == batch_id).update(
        {ScrapeJob.created_at: utcnow() - limits.RUNNING_FOR_AT_MOST - timedelta(minutes=1)})
    test_db.commit()


def test_a_search_lost_by_a_restart_stops_blocking_and_becomes_an_error(anonymous_client, world, adnans, fake,
                                                                        launched, test_db):
    from backend.models.job_search import ScrapeJob
    lost = _open(world, adnans)
    _lose(test_db, lost)
    body = anonymous_client.get(_url(world, adnans, "job-searches"), headers=world["as"]["owner"]).json()
    assert body["running"] is None and (body["searches"][0]["state"], body["searches"][0]["error_code"]) == (
        "error", "internal")
    test_db.expire_all()
    assert test_db.query(ScrapeJob).filter(ScrapeJob.batch_id == lost).one().state == "running"   # a read writes nothing
    assert _post(anonymous_client, world, adnans).status_code == 202
    test_db.expire_all()
    row = test_db.query(ScrapeJob).filter(ScrapeJob.batch_id == lost).one()
    assert (row.state, row.error.split(":")[0]) == ("error", "internal") and row.finished_at is not None


def test_a_task_that_finishes_after_its_search_was_marked_lost_writes_nothing(anonymous_client, world, adnans, fake,
                                                                              launched, test_db):
    fake.jobs = [_job(1)]
    lost = _open(world, adnans)
    _lose(test_db, lost)
    assert _post(anonymous_client, world, adnans).status_code == 202          # marks it lost
    assert _run(world, adnans, batch_id=lost) == "dropped: the search was no longer running"
    _, postings = _rows(test_db, adnans)
    assert postings == []


def test_a_candidate_with_100_new_jobs_today_is_refused_without_a_row(anonymous_client, world, adnans, fake, launched):
    fake.jobs = [_job(n) for n in range(100)]
    _run(world, adnans)
    r = _post(anonymous_client, world, adnans)
    assert r.status_code == 429 and "100 jobs" in r.json()["detail"] and "IST" in r.json()["detail"]
    assert launched == []


def test_a_bde_has_20_attempts_a_day_whatever_the_outcome(anonymous_client, world, adnans, fake, launched):
    fake.error = "timeout"
    for _ in range(limits.ATTEMPTS_PER_BDE_PER_DAY):
        _run(world, adnans)
    r = _post(anonymous_client, world, adnans)
    assert r.status_code == 429 and "20 searches" in r.json()["detail"]


def test_yesterdays_jobs_and_attempts_do_not_count(anonymous_client, world, adnans, fake, launched, test_db):
    from backend.models.job_search import JobPosting, ScrapeJob
    fake.jobs = [_job(n) for n in range(100)]
    _run(world, adnans)
    earlier = limits.day_start() - timedelta(minutes=1)
    test_db.query(JobPosting).update({JobPosting.discovered_at: earlier})
    test_db.query(ScrapeJob).update({ScrapeJob.created_at: earlier})
    test_db.commit()
    assert _post(anonymous_client, world, adnans).status_code == 202


# ── the pipeline ─────────────────────────────────────────────────────────────

def _rows(test_db, candidate):
    from backend.models.job_search import JobPosting, ScrapeJob
    test_db.expire_all()
    cid = uuid.UUID(candidate["id"])
    return (test_db.query(ScrapeJob).filter(ScrapeJob.candidate_id == cid).order_by(ScrapeJob.created_at).all(),
            test_db.query(JobPosting).filter(JobPosting.candidate_id == cid).all())


def test_a_search_writes_its_batch_and_the_jobs_as_the_source_sent_them(world, adnans, fake, test_db):
    from backend.models.tenancy import LedgerEntry
    fake.jobs = [_job(1), _job(2), _job(3, closed=True), {"t": "No company"}, _job(1)]
    assert _run(world, adnans) == "2 new, 0 seen again"
    assert fake.calls == [("Java Developer", "us", 100)]
    # The last 14 days (2026-11-14, Q7); 9 years held: up to 12 asked (9 + 40%, Q74); the search's firm (Q81).
    assert fake.asks == [{"place": "Austin, TX", "posted_within_days": 14, "titles": [], "years": 12,
                          "level": "senior", "firm_id": world["firm"].id}]                 # 9 years: senior (Q96)
    (batch,), postings = _rows(test_db, adnans)
    assert (batch.state, batch.error, batch.user_id) == ("success", None, world["people"]["adnan"].id)
    assert batch.meta["counts"] == {"found": 5, "saved": 2, "refreshed": 0, "skipped_closed": 1,
                                    "skipped_unreadable": 1, "skipped_duplicate": 1, "skipped_over_cap": 0,
                                    "skipped_too_old": 0, "skipped_not_remote": 0, "skipped_work_auth": 0,
                                    "skipped_level": 0, "skipped_adzuna": 0}
    assert batch.meta["request"] == {"query": "Java Developer", "titles": [], "country": "us", "place": "Austin, TX",
                                     "provider": "fake", "limit": 100, "posted_within_days": 14, "cursor": None,
                                     "exhausted": False}
    assert batch.meta["meta"] == {"total": 5}
    assert sorted(p.content["t"] for p in postings) == ["Java Developer #1", "Java Developer #2"]
    assert {p.batch_id for p in postings} == {batch.batch_id} and {p.source for p in postings} == {"fake"}
    entry = test_db.query(LedgerEntry).filter(LedgerEntry.entity_type == "job_search").one()
    assert (entry.candidate_id, entry.actor_user_id) == (uuid.UUID(adnans["id"]), world["people"]["adnan"].id)
    assert entry.summary == "Searched jobs for 'Java Developer' in Austin, TX: 2 new, 0 seen again (US)"


def test_a_job_seen_again_is_refreshed_not_duplicated(world, adnans, fake, test_db):
    fake.jobs = [_job(1)]
    _run(world, adnans)
    (_, ), (first,) = _rows(test_db, adnans)
    discovered = first.discovered_at
    fake.jobs = [_job(1, u="https://jobs.example.test/moved", loc="Remote")]
    assert _run(world, adnans) == "0 new, 1 seen again"
    batches, (again,) = _rows(test_db, adnans)
    assert again.id == first.id and again.discovered_at == discovered
    assert again.batch_id == batches[1].batch_id and again.content["u"] == "https://jobs.example.test/moved"
    assert again.last_seen_at > discovered


def test_the_cap_keeps_the_sources_order_and_still_refreshes(world, adnans, fake, test_db):
    fake.jobs = [_job(n) for n in range(90)]
    _run(world, adnans)
    fake.jobs = [_job(n) for n in range(85, 110)]          # 5 seen again, 20 new with room for 10
    assert _run(world, adnans) == "10 new, 5 seen again"
    batches, postings = _rows(test_db, adnans)
    assert len(postings) == 100 and batches[1].meta["counts"]["skipped_over_cap"] == 10
    assert {p.content["t"] for p in postings} >= {f"Java Developer #{n}" for n in range(90, 100)}
    assert not {p.content["t"] for p in postings} & {f"Java Developer #{n}" for n in range(100, 110)}


def test_no_jobs_is_an_empty_batch(world, adnans, fake, test_db):
    assert _run(world, adnans) == "0 new, 0 seen again"
    (batch,), postings = _rows(test_db, adnans)
    assert (batch.state, postings) == ("empty", [])


def test_a_failed_search_is_an_error_row_with_a_fixed_code_and_no_jobs(world, adnans, fake, test_db, log):
    fake.error = "provider_unavailable"
    assert _run(world, adnans, query="Secret Query Text") == "failed: provider_unavailable"
    (batch,), postings = _rows(test_db, adnans)
    assert batch.state == "error" and batch.error.startswith("provider_unavailable: ") and postings == []
    assert batch.meta["error_code"] == "provider_unavailable"
    assert "Secret Query Text" not in log.getvalue()


def test_a_provider_bug_is_an_internal_error_without_its_message(world, adnans, fake, test_db, log, monkeypatch):
    async def broken(query, country, limit):
        raise RuntimeError("https://source.test/?api_key=SHOULD-NOT-LEAK")
    monkeypatch.setattr(fake, "search", broken)
    assert _run(world, adnans) == "failed: internal"
    (batch,), _ = _rows(test_db, adnans)
    assert batch.meta["error_code"] == "internal" and "SHOULD-NOT-LEAK" not in (batch.error + log.getvalue())


def test_control_characters_never_reach_the_database(world, adnans, fake, test_db):
    fake.jobs = [_job(1, extra="bad\x00byte\x07here")]
    _run(world, adnans)
    _, (posting,) = _rows(test_db, adnans)
    assert posting.content["extra"] == "badbytehere"


# ── the reads ────────────────────────────────────────────────────────────────

def test_everyone_who_sees_the_candidate_reads_its_jobs(anonymous_client, world, adnans, fake):
    fake.jobs = [_job(1, loc="Austin, TX"), _job(2)]
    _run(world, adnans)
    for who in ("adnan", "fatima", "owner", "rohan"):
        r = anonymous_client.get(_url(world, adnans, "job-postings"), headers=world["as"][who])
        assert r.status_code == 200, (who, r.text)
        body = r.json()
        assert body["total"] == 2 and {i["title"] for i in body["items"]} == {"Java Developer #1", "Java Developer #2"}
        assert "description" not in body["items"][0] and "content" not in body["items"][0]
    for who in ("vikram", "priya"):
        assert anonymous_client.get(_url(world, adnans, "job-postings"), headers=world["as"][who]).status_code == 404


def test_one_posting_has_its_description_and_404s_outside_the_candidate(anonymous_client, world, adnans, fake):
    fake.jobs = [_job(1, loc="Austin, TX")]
    _run(world, adnans)
    item = anonymous_client.get(_url(world, adnans, "job-postings"), headers=world["as"]["adnan"]).json()["items"][0]
    r = anonymous_client.get(_url(world, adnans, f"job-postings/{item['id']}"), headers=world["as"]["adnan"])
    assert r.status_code == 200 and r.json()["description"] == "Made-up description 1."
    assert r.json()["location"] == "Austin, TX" and r.json()["apply_url"] == "https://jobs.example.test/1"
    other = _create(anonymous_client, world, bde="sneha").json()
    r = anonymous_client.get(_url(world, other, f"job-postings/{item['id']}"), headers=world["as"]["owner"])
    assert r.status_code == 404


def test_postings_page_newest_first(anonymous_client, world, adnans, fake):
    fake.jobs = [_job(n) for n in range(5)]
    _run(world, adnans)
    r = anonymous_client.get(_url(world, adnans, "job-postings?page=2&size=2"), headers=world["as"]["owner"])
    assert (r.json()["total"], len(r.json()["items"]), r.json()["page"]) == (5, 2, 2)
    assert anonymous_client.get(_url(world, adnans, "job-postings?size=101"),
                                headers=world["as"]["owner"]).status_code == 422


def test_the_history_shows_the_running_search_the_finished_ones_and_todays_usage(anonymous_client, world, adnans,
                                                                                 fake, launched):
    fake.jobs = [_job(1)]
    _run(world, adnans)
    fake.error = "timeout"
    _run(world, adnans, query="Spring Developer")
    assert _post(anonymous_client, world, adnans).status_code == 202
    body = anonymous_client.get(_url(world, adnans, "job-searches"), headers=world["as"]["fatima"]).json()
    assert body["running"]["query"] == "Java Developer" and body["running"]["state"] == "running"
    assert body["running"]["place"] == "Austin, TX"
    assert body["running"]["finished_at"] is None and body["searches"][0]["finished_at"]
    assert [(s["query"], s["state"], s["error_code"]) for s in body["searches"]] == [
        ("Spring Developer", "error", "timeout"), ("Java Developer", "success", None)]
    usage = body["usage"]
    assert (usage["jobs_saved_today"], usage["jobs_cap"], usage["attempts_today"], usage["attempts_cap"]) == (
        1, 100, 3, 20)
    assert usage["resets_at"]


# ── end to end, with the real background launcher ───────────────────────────

def test_a_search_runs_in_the_background_and_finishes(anonymous_client, world, adnans, fake):
    from backend.models.db import JobRun, SessionLocal
    fake.jobs = [_job(1), _job(2)]
    r = _post(anonymous_client, world, adnans)
    assert r.status_code == 202, r.text
    run_id = uuid.UUID(r.json()["run_id"])
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        with SessionLocal() as db:
            if db.get(JobRun, run_id).status != "running":
                break
        time.sleep(0.05)
    with SessionLocal() as db:
        run = db.get(JobRun, run_id)
        assert run.status == "completed" and run.meta is None
    body = anonymous_client.get(_url(world, adnans, "job-searches"), headers=world["as"]["adnan"]).json()
    assert body["running"] is None and body["searches"][0]["counts"]["saved"] == 2
    assert (body["searches"][0]["state"], body["searches"][0]["run_id"]) == ("success", str(run_id))
