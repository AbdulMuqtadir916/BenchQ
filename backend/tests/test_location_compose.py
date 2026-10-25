"""`location` holds a place, `country` holds the country, and one string carries both.

Indeed reads the country from `country_indeed` only. LinkedIn, ZipRecruiter and
Google read no country parameter at all: `location` is their only geography
signal. So a search for "Toronto" with country "usa" used to return 20 jobs from
Pittsburgh, PA and store them as new — no exception, no warning, wrong country.

The scraper now composes one location string, "<place>, <country label>", and
sends it to every board. These tests pin the composition, pin that both call
sites build the same string, and pin that the write path refuses a pair that disagrees.
"""
import pytest

from backend.models.db import Search
from backend.models.tenancy import DEFAULT_FIRM_ID

pytestmark = pytest.mark.usefixtures("default_firm")


def _search(db, **kw):
    kw.setdefault("sources", ["indeed"])
    kw.setdefault("title_include_keywords", [])
    kw.setdefault("title_exclude_keywords", [])
    kw.setdefault("company_filter", [])
    kw.setdefault("company_exclude", [])
    kw.setdefault("country", "usa")
    kw.setdefault("search_mode", "keyword")
    s = Search(firm_id=DEFAULT_FIRM_ID, name="Location probe", active=True,
               search_term="program manager", **kw)
    db.add(s)
    db.commit()
    return s


def _record_kwargs(monkeypatch, calls):
    """Replace the real scrape_jobs and keep every kwargs dict it receives."""
    import jobspy
    import pandas as pd

    def scrape_jobs(**kwargs):
        calls.append(kwargs)
        return pd.DataFrame([])

    monkeypatch.setattr(jobspy, "scrape_jobs", scrape_jobs)


# ── the composition ──────────────────────────────────────────────────────────

@pytest.mark.parametrize("location,country,expected", [
    # A plain city gets the country spelled out. This is the case LinkedIn got
    # wrong: "Austin" alone resolved to Austin, Colorado.
    ("Austin", "usa", "Austin, United States"),
    ("Toronto", "canada", "Toronto, Canada"),
    # A city that already carries its country does not carry it twice.
    ("Toronto, Canada", "canada", "Toronto, Canada"),
    ("Cambridge, United Kingdom", "uk", "Cambridge, United Kingdom"),
    # `country` wins over the text, because the user picked that field.
    ("Toronto, Canada", "usa", "Toronto, United States"),
    # A region is not a country, so it survives. "ON" matches no jobspy alias.
    ("Toronto, ON", "canada", "Toronto, ON, Canada"),
    # An empty place gives the label alone: "Canada" is a valid query and
    # ", Canada" is not.
    ("", "canada", "Canada"),
    (None, "usa", "United States"),
    ("   ", "poland", "Poland"),
    # A location that is only a country name carries no place, so the text goes
    # and the country field decides. "United States" is the column default.
    ("United States", "usa", "United States"),
    ("US", "usa", "United States"),
    # A location that names ANOTHER country is refused by the write path, so
    # only a row stored before this change reaches the composition. See
    # `test_create_rejects_a_location_that_names_another_country`.
    ("Canada", "usa", "United States"),
    # Text that names no place still receives the country. Measured with "usa":
    # Indeed answers both spellings with the same 20 "Remote, US" rows, so the
    # country costs it nothing, while LinkedIn answers a bare "Remote" with jobs
    # in Taiwan, Japan and India. The forms point at the `is_remote` field.
    ("Remote", "usa", "Remote, United States"),
    ("Bay Area", "usa", "Bay Area, United States"),
    # An unknown or missing country falls back the way `country_indeed` does.
    ("Austin", None, "Austin, United States"),
    ("Austin", "Atlantis", "Austin, United States"),
])
def test_compose_location(location, country, expected):
    from backend.countries import compose_location
    assert compose_location(location, country) == expected


@pytest.mark.parametrize("location,expected", [
    ("Toronto, Canada", ("Toronto", "canada")),
    ("Toronto, ON", ("Toronto, ON", None)),
    ("Toronto, ON, Canada", ("Toronto, ON", "canada")),
    ("Canada", ("", "canada")),
    ("  Warsaw ,  Poland  ", ("Warsaw", "poland")),
    ("Remote", ("Remote", None)),
    ("", ("", None)),
    (None, ("", None)),
])
def test_split_country_suffix(location, expected):
    from backend.countries import split_country_suffix
    assert split_country_suffix(location) == expected


# ── both call sites compose the same string ──────────────────────────────────

@pytest.mark.parametrize("location,country", [
    ("Austin", "usa"),
    ("Toronto", "canada"),
    ("Toronto, Canada", "usa"),
    ("Toronto, ON", "canada"),
    ("", "canada"),
    ("Remote", "uk"),
])
def test_the_scraper_and_the_test_preview_send_the_same_location(
    api_client, test_db, monkeypatch, location, country
):
    """One composition, two callers. This test fails if either side drifts."""
    from backend.scraper.sources.jobspy import _run_sync

    search = _search(test_db, location=location, country=country)

    calls = []
    _record_kwargs(monkeypatch, calls)

    _run_sync(search)
    resp = api_client.post(f"/api/searches/{search.id}/test")
    assert resp.status_code == 200, f"Unexpected {resp.status_code}: {resp.text}"

    assert len(calls) == 2, f"expected one call per site, got {len(calls)}"
    scraper_loc, preview_loc = calls[0]["location"], calls[1]["location"]
    assert scraper_loc == preview_loc, \
        f"the two call sites drifted: {scraper_loc!r} vs {preview_loc!r}"

    from backend.countries import compose_location
    assert scraper_loc == compose_location(location, country)


def test_the_scraper_sends_the_country_to_indeed_and_to_the_location(test_db, monkeypatch):
    """`country_indeed` still reaches Indeed, and the composed string reaches the rest."""
    from backend.scraper.sources.jobspy import _run_sync

    calls = []
    _record_kwargs(monkeypatch, calls)
    _run_sync(_search(test_db, location="Austin", country="usa",
                      sources=["indeed", "linkedin", "zip_recruiter", "google"]))

    assert calls[0]["country_indeed"] == "usa"
    assert calls[0]["location"] == "Austin, United States"


def test_an_empty_location_does_not_send_a_leading_comma(test_db, monkeypatch):
    """", Canada" is not a query. "Canada" is, and it returns rows."""
    from backend.scraper.sources.jobspy import _run_sync

    calls = []
    _record_kwargs(monkeypatch, calls)
    _run_sync(_search(test_db, location="", country="canada"))

    assert calls[0]["location"] == "Canada"


# ── the write path refuses a pair that disagrees ─────────────────────────────

def _payload(**kw):
    body = {"name": "New search", "search_mode": "keyword", "search_term": "pm"}
    body.update(kw)
    return body


def test_create_rejects_a_location_that_names_another_country(api_client, test_db):
    """The pair used to fail loudly: Indeed answered zero rows and the health
    check raised a warning. Composed, it becomes a silent wrong-country scrape,
    so the API refuses it instead of choosing a side for the user."""
    resp = api_client.post("/api/searches",
                           json=_payload(location="Toronto, Canada", country="usa"))

    assert resp.status_code == 400, f"Unexpected {resp.status_code}: {resp.text}"
    assert "canada" in resp.json()["detail"].lower()
    assert test_db.query(Search).filter(Search.name == "New search").count() == 0


def test_create_rejects_a_location_that_is_another_country(api_client, test_db):
    """The case the composition would otherwise swallow whole: the text vanishes."""
    resp = api_client.post("/api/searches",
                           json=_payload(location="Canada", country="usa"))
    assert resp.status_code == 400, f"Unexpected {resp.status_code}: {resp.text}"


@pytest.mark.parametrize("location,country", [
    ("Toronto, Canada", "canada"),   # the text agrees with the field
    ("Toronto, ON", "canada"),       # a region is not a country
    ("Toronto", "canada"),
    ("Remote", "usa"),
    ("", "canada"),
])
def test_create_accepts_a_location_that_does_not_disagree(api_client, test_db,
                                                          location, country):
    resp = api_client.post("/api/searches",
                           json=_payload(location=location, country=country))
    assert resp.status_code == 200, f"Unexpected {resp.status_code}: {resp.text}"


def test_patch_rejects_a_location_that_contradicts_the_stored_country(api_client, test_db):
    search = _search(test_db, location="Austin", country="usa")

    resp = api_client.patch(f"/api/searches/{search.id}",
                            json={"location": "Toronto, Canada"})

    assert resp.status_code == 400, f"Unexpected {resp.status_code}: {resp.text}"
    test_db.refresh(search)
    assert search.location == "Austin", "a rejected write must leave the row alone"


def test_patch_rejects_a_country_that_contradicts_the_stored_location(api_client, test_db):
    """The same pair, reached from the other field."""
    search = _search(test_db, location="Toronto, Canada", country="canada")

    resp = api_client.patch(f"/api/searches/{search.id}", json={"country": "usa"})

    assert resp.status_code == 400, f"Unexpected {resp.status_code}: {resp.text}"
    test_db.refresh(search)
    assert search.country == "canada", "a rejected write must leave the row alone"


def test_patch_accepts_the_pair_when_both_fields_move_together(api_client, test_db):
    """Changing both at once is how a user moves a search to another country."""
    search = _search(test_db, location="Toronto, Canada", country="canada")

    resp = api_client.patch(f"/api/searches/{search.id}",
                            json={"location": "Austin", "country": "usa"})

    assert resp.status_code == 200, f"Unexpected {resp.status_code}: {resp.text}"
    test_db.refresh(search)
    assert (search.location, search.country) == ("Austin", "usa")


def test_patch_leaves_the_pair_alone_when_neither_field_moves(api_client, test_db):
    """A legacy row stays editable: renaming it must not fail on its own text."""
    search = _search(test_db, location="Toronto, Canada", country="usa")

    resp = api_client.patch(f"/api/searches/{search.id}", json={"name": "Renamed"})

    assert resp.status_code == 200, f"Unexpected {resp.status_code}: {resp.text}"


# ── jobright reads the location raw ───────────────────────────────────────────

class _FakeResponse:
    text = '<script id="__NEXT_DATA__" type="application/json">' \
           '{"props": {"pageProps": {"jobList": [], "totalJobs": 0}}}</script>'

    def raise_for_status(self):
        return None


def _record_jobright_params(monkeypatch, sent):
    """Stub the session and the HTTP client, and keep the params of every GET."""
    from backend.scraper.sources import jobright

    async def _session(force_relogin=False):
        return "session"

    class _Client:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def get(self, url, params=None, **kwargs):
            sent.append(dict(params or {}))
            return _FakeResponse()

    monkeypatch.setattr(jobright, "_ensure_session", _session)
    monkeypatch.setattr(jobright.httpx, "AsyncClient", _Client)


def test_a_new_jobright_search_sends_no_location(api_client, test_db, monkeypatch):
    """A search created now stores "", and jobright receives no location parameter.

    The search goes through the real write path, so this test fails if the
    column default or the SearchCreate default returns to a country name.
    """
    import asyncio
    from backend.scraper.sources import jobright

    resp = api_client.post("/api/searches", json={
        "name": "New jobright", "search_mode": "jobright", "search_term": "program manager",
    })
    assert resp.status_code == 200, f"Unexpected {resp.status_code}: {resp.text}"
    search = test_db.query(Search).filter(Search.name == "New jobright").one()
    assert search.location == ""

    sent = []
    _record_jobright_params(monkeypatch, sent)
    asyncio.run(jobright.preview(search, test_db))

    assert sent, "the SSR search was never requested"
    assert "location" not in sent[0], f"a new jobright search sent {sent[0]}"


def test_an_old_jobright_search_still_sends_its_stored_location(test_db, monkeypatch):
    """The other population, pinned so that the difference stays a decision.

    The strip skips jobright rows, so an old row keeps the old default and sends
    it. Measured, jobright answers it the same way as no location.
    """
    import asyncio
    from backend.scraper.sources import jobright

    search = _search(test_db, search_mode="jobright", location="United States")

    sent = []
    _record_jobright_params(monkeypatch, sent)
    asyncio.run(jobright.preview(search, test_db))

    assert sent and sent[0].get("location") == "United States"
