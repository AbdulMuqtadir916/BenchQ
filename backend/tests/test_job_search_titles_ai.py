"""The job search's extra titles (backend/job_search/search_titles.py; decided 2026-11-17, Q131–Q144): an AI call after a
candidate is added suggests 2 for the target role (faked here: no network), guarded; they are stored on the active
base's v1, shown and edited by hand on the details tab (up to 4), taken over by a new active base, searched with the
target role (5 at most) and counted by the Match. Every title and candidate is made up."""
import uuid

import pytest

from backend.job_search import search_titles
from backend.models.db import Resume
from backend.tests.test_candidates_api import _create, world  # noqa: F401  (the fixture)
from backend.tests.test_job_search_api import _post, _url, launched  # noqa: F401  (the fixture)


def test_the_ais_titles_are_guarded():
    """No seniority words, nothing generic, nothing the candidate has, at most 2."""
    kept = search_titles.keep(["Senior Business Analyst", "Software Engineer", "Business Systems Analyst",
                               "Lead Data Analyst"], ["Business Analyst"])
    assert kept == ["Business Systems Analyst", "Data Analyst"]
    assert search_titles.keep(["Developer", "Engineer"], []) == []


def test_a_search_asks_for_the_target_roles_titles_then_these_five_at_most():
    assert search_titles.for_search(["GenAI Engineer", "LLM Engineer", "Python Backend Engineer"],
                                    ["AI Engineer", "Machine Learning Engineer", "ML Ops Engineer"]) == [
        "GenAI Engineer", "LLM Engineer", "Python Backend Engineer", "AI Engineer", "Machine Learning Engineer"]
    assert search_titles.for_search(["Java Developer"], None) == ["Java Developer"]


@pytest.fixture
def ai(monkeypatch):
    """The AI call, faked: records the target roles it got; returns `ai.titles`."""
    state = {"titles": ["Senior Java Software Engineer", "Software Engineer", "Backend Java Engineer"], "asked": []}

    async def suggest(roles, setup, firm_id=None):
        state["asked"].append(list(roles))
        return state["titles"]
    monkeypatch.setattr(search_titles, "suggest", suggest)
    return state


def _v1(test_db, candidate):
    test_db.expire_all()
    return test_db.query(Resume).filter(Resume.candidate_id == uuid.UUID(candidate["id"]), Resume.version == 1,
                                        Resume.category == "BASE").one()


def test_adding_a_candidate_makes_two_titles_on_their_active_resume(anonymous_client, world, ai, test_db):
    c = _create(anonymous_client, world, bde="adnan").json()
    assert ai["asked"] == [["Java Developer"]]                            # the target role, never the résumé
    assert _v1(test_db, c).search_titles == ["Java Software Engineer", "Backend Java Engineer"]
    url = f"/api/firms/{world['firm'].id}/candidates/{c['id']}"
    # 07 Q68: the OWNER and a MANAGER see them; the BDE doesn't (the key is left out).
    assert anonymous_client.get(url, headers=world["as"]["owner"]).json()["search_titles"] == \
        ["Java Software Engineer", "Backend Java Engineer"]
    assert "search_titles" not in anonymous_client.get(url, headers=world["as"]["adnan"]).json()


def test_nobody_edits_them(anonymous_client, world, ai, test_db):
    """07 Q68 (2026-11-18): fixed once the candidate is added, like the target role."""
    c = _create(anonymous_client, world, bde="adnan").json()
    r = anonymous_client.patch(f"/api/firms/{world['firm'].id}/candidates/{c['id']}",
                               json={"search_titles": ["Software Engineer"]}, headers=world["as"]["adnan"])
    assert r.status_code == 422
    assert _v1(test_db, c).search_titles == ["Java Software Engineer", "Backend Java Engineer"]


def test_a_search_asks_for_them_and_the_match_counts_them(anonymous_client, world, ai, launched, test_db):
    from backend.match import score as match
    from backend.models.candidates import Candidate
    c = _create(anonymous_client, world, bde="adnan").json()
    assert _post(anonymous_client, world, c).status_code == 202
    assert launched[-1]["kwargs"]["titles"] == ["Java Developer", "Java Software Engineer", "Backend Java Engineer"]
    row = test_db.get(Candidate, uuid.UUID(c["id"]))
    assert "Backend Java Engineer" in match.who(row, "us").wanted


def test_a_failed_ai_call_leaves_the_target_role_alone(anonymous_client, world, ai, launched, test_db):
    ai["titles"] = []
    c = _create(anonymous_client, world, bde="adnan").json()
    assert _v1(test_db, c).search_titles is None
    _post(anonymous_client, world, c)
    assert launched[-1]["kwargs"]["titles"] == ["Java Developer"]


def test_a_new_active_base_takes_the_titles_over(anonymous_client, world, ai, test_db):
    """Q142: they come from the target role, not the résumé."""
    from backend.tests.test_resume_versions import _candidate, _save, _url as resume_url, _v
    c = _candidate(anonymous_client, test_db, world)
    search_titles.generate(world["firm"].id, uuid.UUID(c["id"]))          # the background task, run here
    v1 = _v(anonymous_client, world, c)
    v2 = _save(anonymous_client, world, c, v1, summary="Edited.").json()
    r = anonymous_client.post(resume_url(world, c, f"/{v2['id']}/use-as-base"), headers=world["as"]["owner"])
    assert r.status_code == 200, r.text
    test_db.expire_all()
    new_v1 = test_db.query(Resume).filter(Resume.base_resume_id == uuid.UUID(r.json()["id"]), Resume.version == 1).one()
    assert new_v1.search_titles == ["Java Software Engineer", "Backend Java Engineer"]
