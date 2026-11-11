"""Tests for /api/searches guards on the built-in extension searches ("Extension"/"Extension LI" have no scraper; the v2 UI hides Run/Test/Delete for them, and PATCH stays allowed)."""
import pytest
from backend.models.tenancy import DEFAULT_FIRM_ID

pytestmark = pytest.mark.usefixtures("default_firm")


def _mk_search(db, mode):
    from backend.models.db import Search
    s = Search(firm_id=DEFAULT_FIRM_ID, name=f"Extension {mode}", search_mode=mode, active=True)
    db.add(s)
    db.commit()
    return str(s.id)



@pytest.mark.parametrize("mode", ["extension", "linkedin_extension"])
def test_delete_rejects_extension_search(api_client, test_db, mode):
    sid = _mk_search(test_db, mode)
    resp = api_client.delete(f"/api/searches/{sid}")
    assert resp.status_code == 409, f"Unexpected {resp.status_code}: {resp.text}"

    from backend.models.db import Search
    assert test_db.query(Search).filter(Search.id == sid).first() is not None


@pytest.mark.parametrize("mode", ["extension", "linkedin_extension"])
def test_patch_still_allowed_on_extension_search(api_client, test_db, mode):
    """The editor saves filters via PATCH — it must stay open."""
    sid = _mk_search(test_db, mode)
    resp = api_client.patch(f"/api/searches/{sid}", json={"title_exclude_keywords": ["intern"]})
    assert resp.status_code == 200, f"Unexpected {resp.status_code}: {resp.text}"
    assert resp.json()["title_exclude_keywords"] == ["intern"]



# ── the test preview must apply title_exclude_global, same as the run does ──
# (scraper/sources/jobspy.py:285) and same as the Companies preview (routes_companies.py:603).

def _seed_global_exclude(db, keywords):
    import json
    from backend.models.db import Setting
    db.add(Setting(key="title_exclude_global", value=json.dumps(keywords)))
    db.commit()


def _mk_keyword_search(db, **kw):
    from backend.models.db import Search
    # title_exclude_keywords defaults to ["intern", "junior", "associate"]; blank it so these
    # tests measure only the global list, unless a test deliberately exercises the per-search layer.
    kw.setdefault("title_exclude_keywords", [])
    s = Search(firm_id=DEFAULT_FIRM_ID, name="Global exclude probe", search_mode="keyword", active=True,
               sources=["indeed"], search_term="program manager", **kw)
    db.add(s)
    db.commit()
    return str(s.id)


def _stub_jobspy(monkeypatch, titles):
    """Make jobspy.scrape_jobs return one row per title (patching the module attribute works since the handler imports it inside the function)."""
    import jobspy
    import pandas as pd
    df = pd.DataFrame([{
        "title": t, "company": f"Co {i}", "job_url": f"https://example.com/{i}",
        "site": "indeed", "location": "United States", "description": "",
        "min_amount": None, "max_amount": None,
    } for i, t in enumerate(titles)])
    monkeypatch.setattr(jobspy, "scrape_jobs", lambda **kwargs: df)


