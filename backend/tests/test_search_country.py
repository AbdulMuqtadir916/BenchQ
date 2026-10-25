"""searches.country picks the Indeed domain and the `indeed-co` API header.

The field used to be the literal "USA" at both call sites, so a search for
Canadian cities asked the US Indeed site. Indeed answered HTTP 200 with an empty
result list: no exception, no error row, no rows. These tests pin the country as
a per-search value and pin the backfill that derives it from existing rows.
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
    s = Search(firm_id=DEFAULT_FIRM_ID, name="Country probe", search_mode="keyword", active=True,
               search_term="program manager", **kw)
    db.add(s)
    db.commit()
    return s


def _record_kwargs(monkeypatch, calls):
    """Replace the real scrape_jobs and keep every kwargs dict it receives (same stubbing style as test_routes_searches._stub_jobspy)."""
    import jobspy
    import pandas as pd

    def scrape_jobs(**kwargs):
        calls.append(kwargs)
        return pd.DataFrame([])

    monkeypatch.setattr(jobspy, "scrape_jobs", scrape_jobs)


# ── the scraper hands the search's own country to jobspy ─────────────────────

@pytest.mark.parametrize("stored,expected", [
    ("canada", "canada"),
    ("poland", "poland"),
    ("usa", "usa"),
])
def test_scrape_kwargs_carry_the_search_country(test_db, monkeypatch, stored, expected):
    from backend.scraper.sources.jobspy import _run_sync

    calls = []
    _record_kwargs(monkeypatch, calls)
    _run_sync(_search(test_db, location="Toronto, Canada", country=stored))

    assert calls, "scrape_jobs was never called"
    assert calls[0]["country_indeed"] == expected


def test_country_indeed_is_not_a_constant(test_db, monkeypatch):
    """Two searches, two countries, one run each — a hardcoded literal fails here."""
    from backend.scraper.sources.jobspy import _run_sync

    calls = []
    _record_kwargs(monkeypatch, calls)
    _run_sync(_search(test_db, location="Toronto, Canada", country="canada"))
    _run_sync(_search(test_db, location="Warsaw, Poland", country="poland"))

    sent = [c["country_indeed"] for c in calls]
    assert sent == ["canada", "poland"]
    assert len(set(sent)) == 2, f"country_indeed did not vary between searches: {sent}"


def test_test_preview_sends_the_search_country(api_client, test_db, monkeypatch):
    """The /test preview built the same kwargs dict and carried the same literal."""
    search = _search(test_db, location="Toronto, Canada", country="canada")

    calls = []
    _record_kwargs(monkeypatch, calls)
    resp = api_client.post(f"/api/searches/{search.id}/test")

    assert resp.status_code == 200, f"Unexpected {resp.status_code}: {resp.text}"
    assert calls[0]["country_indeed"] == "canada"


# ── the API write path validates the field ───────────────────────────────────

def _payload(**kw):
    body = {"name": "New search", "search_mode": "keyword", "search_term": "pm"}
    body.update(kw)
    return body


def test_create_rejects_an_unknown_country(api_client, test_db):
    resp = api_client.post("/api/searches", json=_payload(country="Atlantis"))
    assert resp.status_code == 400, f"Unexpected {resp.status_code}: {resp.text}"
    assert "Atlantis" in resp.json()["detail"]


def test_create_stores_the_canonical_spelling(api_client, test_db):
    """jobspy accepts several aliases per country; one of them is stored."""
    resp = api_client.post("/api/searches", json=_payload(country="United States"))
    assert resp.status_code == 200, f"Unexpected {resp.status_code}: {resp.text}"
    assert resp.json()["country"] == "usa"

    resp = api_client.post("/api/searches", json=_payload(name="Second", country="CANADA"))
    assert resp.status_code == 200, f"Unexpected {resp.status_code}: {resp.text}"
    assert resp.json()["country"] == "canada"


def test_create_defaults_to_usa(api_client, test_db):
    resp = api_client.post("/api/searches", json=_payload())
    assert resp.status_code == 200, f"Unexpected {resp.status_code}: {resp.text}"
    assert resp.json()["country"] == "usa"


def test_patch_rejects_an_unknown_country(api_client, test_db):
    search = _search(test_db, country="usa")
    resp = api_client.patch(f"/api/searches/{search.id}", json={"country": "Narnia"})
    assert resp.status_code == 400, f"Unexpected {resp.status_code}: {resp.text}"

    test_db.refresh(search)
    assert search.country == "usa", "a rejected write must leave the row alone"


def test_patch_accepts_a_known_country(api_client, test_db):
    search = _search(test_db, country="usa")
    resp = api_client.patch(f"/api/searches/{search.id}", json={"country": "Canada"})
    assert resp.status_code == 200, f"Unexpected {resp.status_code}: {resp.text}"
    assert resp.json()["country"] == "canada"


def test_countries_endpoint_lists_the_library_names(api_client, test_db):
    resp = api_client.get("/api/searches/countries")
    assert resp.status_code == 200, f"Unexpected {resp.status_code}: {resp.text}"
    rows = resp.json()

    by_value = {r["value"]: r["label"] for r in rows}
    assert by_value["usa"] == "United States"
    assert by_value["canada"] == "Canada"
    assert by_value["uk"] == "United Kingdom"
    # ZipRecruiter's and LinkedIn's internal routing members are not places.
    assert "usa/ca" not in by_value and "worldwide" not in by_value


# ── reading a country out of a location ──────────────────────────────────────

@pytest.mark.parametrize("location,expected", [
    ("Toronto, Canada", "canada"),          # last comma-separated segment
    ("Warsaw, Poland", "poland"),
    ("Canada", "canada"),                   # the whole trimmed string
    ("  poland  ", "poland"),
    ("United States", "usa"),
    ("US", "usa"),                          # any alias jobspy accepts
    ("Remote", "usa"),                      # no match -> the default
    ("", "usa"),
    (None, "usa"),
    ("Springfield, Nowhereland", "usa"),
])
def test_country_from_location(location, expected):
    from backend.countries import country_from_location
    assert country_from_location(location) == expected


def test_aliases_survive_a_plain_string_enum_value():
    """If a later jobspy drops the tuple, value[0] would be the letter "u" and "usa" would silently become an invalid country."""
    from backend.countries import _aliases

    class _Member:
        value = "usa,us,united states"

    assert _aliases(_Member) == ["usa", "us", "united states"]
