"""What a search asks for (decided 2026-11-14): the candidate's target role and their places. Pure: a stand-in
candidate, no database. The places are made up."""
from types import SimpleNamespace

import pytest

from backend.job_search import places
from backend.job_search.providers import REMOTE


def _candidate(**over):
    base = {"target_roles": ["Data Engineer"], "city": "Austin", "state": "TX", "preferred_locations": [],
            "work_settings": ["ONSITE"]}
    return SimpleNamespace(**{**base, **over})


@pytest.mark.parametrize("roles,role", [(["Data Engineer"], "Data Engineer"), (["  ", " Data   Engineer "], "Data Engineer"),
                                        (["Data Engineer", "Analytics Engineer"], "Data Engineer"), ([], None),
                                        (None, None)])
def test_the_role_is_the_first_target_role(roles, role):
    assert places.search_role(_candidate(target_roles=roles)) == role


def test_the_home_place_needs_the_city_and_the_state():
    assert [p["value"] for p in places.places(_candidate(), "us")] == ["Austin, TX"]
    assert places.places(_candidate(state=""), "us") == []                   # a city alone is ambiguous (Q13)
    assert places.places(_candidate(city=None), "us") == []


def test_the_places_are_home_then_preferred_then_remote_once_each():
    c = _candidate(preferred_locations=["Dallas, TX", "austin,  tx", " ", "Remote", "Seattle, WA"],
                   work_settings=["HYBRID", "REMOTE"])
    got = places.places(c, "us")
    # "austin,  tx" is the home place again; the blank one is nothing; "Remote" is the remote place. Places only, each
    # once, never a mode (Zuhair 2026-11-17).
    assert [(p["value"], p["kind"]) for p in got] == [
        ("Austin, TX", "home"), ("Dallas, TX", "preferred"), ("Seattle, WA", "preferred"), (REMOTE, "remote")]
    assert [p["label"] for p in got[:3]] == ["Austin, TX", "Dallas, TX", "Seattle, WA"]


def test_the_same_place_twice_is_one():
    c = _candidate(preferred_locations=["Austin, TX", "AUSTIN, TX"])
    assert [p["value"] for p in places.places(c, "us")] == ["Austin, TX"]


@pytest.mark.parametrize("said", ["Remote", "remote (US)", "Anywhere", "Work from home", "WFH"])
def test_a_preferred_location_that_says_remote_is_the_remote_place(said):
    got = places.places(_candidate(city="", preferred_locations=[said]), "ca")
    assert got == [{"value": REMOTE, "label": "Remote (anywhere in Canada)", "kind": "remote"}]


def test_remote_only_when_the_work_settings_or_a_preferred_location_say_so():
    assert REMOTE not in [p["value"] for p in places.places(_candidate(work_settings=["ONSITE", "HYBRID"]), "us")]
    assert places.places(_candidate(work_settings=["REMOTE"]), "in")[-1]["label"] == "Remote (anywhere in India)"


def test_pick_finds_the_candidates_place_in_any_case_and_nothing_else():
    c = _candidate(preferred_locations=["Dallas, TX"], work_settings=["REMOTE"])
    assert places.pick(c, "us", "dallas, tx")["value"] == "Dallas, TX"
    assert places.pick(c, "us", "REMOTE")["value"] == REMOTE
    assert places.pick(c, "us", "Seattle, WA") is None


def test_a_place_reads_as_remote_or_its_text():
    assert (places.label(REMOTE), places.label("Austin, TX"), places.label(None)) == (
        "Remote", "Austin, TX", "the whole country")
    assert places.label("hybrid:Austin, TX") == "Austin, TX"                # never the mode


def test_a_place_says_its_mode():
    """Q122: city = on-site, "hybrid:" + city = hybrid, remote = remote."""
    assert places.mode_of("Austin, TX") == ("onsite", "Austin, TX")
    assert places.mode_of("hybrid:Austin, TX") == ("hybrid", "Austin, TX")
    assert places.mode_of(REMOTE) == ("remote", None)


def test_a_citys_mode_comes_from_the_work_settings():
    """Hybrid when the candidate takes it or says nothing; on-site otherwise; Remote stays remote."""
    assert places.searched_place(_candidate(work_settings=["ONSITE"]), "Austin, TX") == "Austin, TX"
    assert places.searched_place(_candidate(work_settings=["ONSITE", "HYBRID"]), "Austin, TX") == "hybrid:Austin, TX"
    assert places.searched_place(_candidate(work_settings=[]), "Austin, TX") == "hybrid:Austin, TX"
    assert places.searched_place(_candidate(work_settings=["HYBRID", "REMOTE"]), REMOTE) == REMOTE
