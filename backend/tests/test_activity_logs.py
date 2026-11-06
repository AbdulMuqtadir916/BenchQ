"""The activity log (backend/auth/ledger.py, backend/api/routes_ledger.py, migration 0016): entries stamped with who was
responsible at the time, history that stays with them, a table that can't be rewritten, and the log's filters, paging
and counts."""
from datetime import datetime, timedelta, timezone
import os
import subprocess
import sys
import uuid

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session
from sqlalchemy.pool import NullPool

from backend.auth import ledger
from backend.logging_setup import request_id
from backend.models.candidates import Candidate
from backend.models.tenancy import ActivityEntry, Firm, LedgerEntry, User
from backend.tests.auth_support import make_firm, make_plan, make_user
from backend.tests.scratch_db import _admin_engine, _url_for


def _as(test_db, user):
    from backend.auth.sessions import start_session
    token, _ = start_session(test_db, user)
    test_db.commit()
    return {"cookie": f"bq_session={token}"}


def _log(test_db, actor, summary, candidate=None, action="UPDATE", **fields):
    entity = {"entity_type": "application", "entity_id": uuid.uuid4(), "entity_label": "Acme"}
    entry = ledger.record(test_db, actor=actor, action=action, firm_id=actor.firm_id, summary=summary,
                          candidate_id=candidate.id if candidate else None, **{**entity, **fields})
    test_db.commit()
    return entry


@pytest.fixture
def firm(test_db, accounts):
    """Mira manages Bea and Ben; Zed manages Cara. Asha is Mira's and Bea's, Ravi is Zed's and Cara's."""
    acme = test_db.get(Firm, accounts.firm_id)
    owner = test_db.get(User, accounts.user_id)
    mira = make_user(test_db, acme, email="mira@acme.test", role="MANAGER", name="Mira")
    zed = make_user(test_db, acme, email="zed@acme.test", role="MANAGER", name="Zed")
    bea = make_user(test_db, acme, email="bea@acme.test", role="BDE", name="Bea")
    ben = make_user(test_db, acme, email="ben@acme.test", role="BDE", name="Ben")
    cara = make_user(test_db, acme, email="cara@acme.test", role="BDE", name="Cara")
    viewer = make_user(test_db, acme, email="vic@acme.test", role="VIEWER", name="Vic")
    bea.manager_id = ben.manager_id = mira.id
    cara.manager_id = zed.id

    def person(name, manager, bde):
        return Candidate(firm_id=acme.id, manager_id=manager.id, bde_id=bde.id if bde else None,
                         created_by_user_id=owner.id, full_name=name, work_auth="H1B")
    asha, ravi = person("Asha", mira, bea), person("Ravi", zed, cara)
    test_db.add_all([asha, ravi])
    test_db.commit()
    return type("World", (), dict(id=acme.id, owner=owner, mira=mira, zed=zed, bea=bea, ben=ben, cara=cara, viewer=viewer,
                                  asha=asha, ravi=ravi, url=f"/api/firms/{acme.id}/ledger"))


def _read(client, world, user, query="", path=""):
    response = client.get(f"{world.url}{path}{query}", headers=_as_session(world, user))
    assert response.status_code == 200, response.text
    return response.json()


def _summaries(client, world, user, query=""):
    return [e["summary"] for e in _read(client, world, user, query)]


def _as_session(world, user):
    return world.sessions[user.id]


@pytest.fixture
def world(firm, test_db):
    firm.sessions = {u.id: _as(test_db, u) for u in (firm.owner, firm.mira, firm.zed, firm.bea, firm.ben, firm.cara,
                                                     firm.viewer)}
    return firm


# ── Stamps ────────────────────────────────────────────────────────────────────────────────────────────────────────


def test_an_entry_records_who_was_responsible_at_the_time(test_db, world):
    entry = _log(test_db, world.bea, "Bea applied", world.asha)
    assert (entry.actor_role, entry.team_manager_id) == ("BDE", world.mira.id)
    assert (entry.candidate_manager_id, entry.candidate_bde_id) == (world.mira.id, world.bea.id)


def test_a_manager_is_their_own_team_and_the_owner_has_none(test_db, world):
    assert _log(test_db, world.mira, "Mira").team_manager_id == world.mira.id
    assert _log(test_db, world.owner, "Owner").team_manager_id is None


def test_an_ai_agent_acts_for_a_person_without_being_them(test_db, world):
    entry = ledger.record_automated(test_db, actor_type="AGENT", actor_name="AI agent (Bea)", action="AI_GENERATE",
                                    entity_type="resume", entity_id=uuid.uuid4(), entity_label="Resume", summary="Drafted",
                                    firm_id=world.id, candidate_id=world.asha.id, on_behalf_of=world.bea)
    test_db.commit()
    assert (entry.actor_user_id, entry.on_behalf_of_user_id) == (None, world.bea.id)
    assert (entry.actor_role, entry.team_manager_id) == (None, world.mira.id)


def test_an_entry_carries_the_requests_id(test_db, world):
    token = request_id.set("req-123")
    try:
        assert _log(test_db, world.bea, "Bea").request_id == "req-123"
    finally:
        request_id.reset(token)


def test_a_change_is_kept_with_contact_details_and_secrets_masked():
    changes = ledger.diff({"city": "Pune", "email": "a@x.test", "phone": "1", "api_key_hash": "h", "rate_min": 10},
                          {"city": "Delhi", "email": "b@x.test", "phone": "1", "api_key_hash": "i", "rate_min": 10})
    assert changes == {"city": {"before": "Pune", "after": "Delhi"},
                       "email": {"before": ledger.MASKED, "after": ledger.MASKED},
                       "api_key_hash": {"before": ledger.MASKED, "after": ledger.MASKED}}


def test_a_long_value_is_left_out_and_no_change_is_none():
    assert ledger.diff({"notes": ""}, {"notes": "x" * 600})["notes"]["after"] == ledger.TOO_LONG
    assert ledger.diff({"city": "Pune"}, {"city": "Pune"}) is None


def test_editing_a_candidate_logs_what_changed(api_client, test_db, world):
    response = api_client.patch(f"/api/firms/{world.id}/candidates/{world.asha.id}", json={"notice_period_days": 30})
    assert response.status_code == 200, response.text
    test_db.expire_all()
    entry = test_db.query(ActivityEntry).filter(ActivityEntry.candidate_id == world.asha.id,
                                                ActivityEntry.action == "UPDATE").one()
    assert entry.changes == {"notice_period_days": {"before": None, "after": 30}}
    assert entry.request_id


# ── The table can't be rewritten ──────────────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("statement", ["UPDATE activity_logs SET summary = 'rewritten'", "DELETE FROM activity_logs"])
def test_the_database_refuses_a_rewrite(test_db, world, statement):
    _log(test_db, world.bea, "Bea")
    with pytest.raises(DBAPIError, match="append-only"):
        test_db.execute(text(statement))
    test_db.rollback()


def test_only_the_named_demo_reset_can_delete_and_never_edit(test_db, world):
    _log(test_db, world.bea, "Bea")
    test_db.execute(text("SET LOCAL benchq.activity_logs_demo_reset = 'on'"))
    with pytest.raises(DBAPIError, match="append-only"):
        test_db.execute(text("UPDATE activity_logs SET summary = 'rewritten'"))
    test_db.rollback()
    test_db.execute(text("SET LOCAL benchq.activity_logs_demo_reset = 'on'"))
    assert test_db.execute(text("DELETE FROM activity_logs")).rowcount >= 1
    test_db.rollback()


# ── Who reads what ────────────────────────────────────────────────────────────────────────────────────────────────


def test_each_role_reads_its_own_part(anonymous_client, test_db, world):
    for actor, summary in ((world.owner, "Owner"), (world.mira, "Mira"), (world.bea, "Bea"), (world.ben, "Ben"),
                           (world.zed, "Zed"), (world.cara, "Cara")):
        _log(test_db, actor, summary)
    everyone = ["Cara", "Zed", "Ben", "Bea", "Mira", "Owner"]
    assert _summaries(anonymous_client, world, world.owner) == everyone
    assert _summaries(anonymous_client, world, world.viewer) == everyone
    assert _summaries(anonymous_client, world, world.mira) == ["Ben", "Bea", "Mira"]
    assert _summaries(anonymous_client, world, world.zed) == ["Cara", "Zed"]
    assert _summaries(anonymous_client, world, world.bea) == ["Bea"]


def test_a_bde_reads_what_their_ai_agent_did_and_so_does_their_manager(anonymous_client, test_db, world):
    ledger.record_automated(test_db, actor_type="AGENT", actor_name="AI agent (Bea)", action="AI_GENERATE",
                            entity_type="resume", entity_id=uuid.uuid4(), entity_label="Resume", summary="AI drafted",
                            firm_id=world.id, candidate_id=world.asha.id, on_behalf_of=world.bea)
    test_db.commit()
    assert _summaries(anonymous_client, world, world.bea) == ["AI drafted"]
    assert _summaries(anonymous_client, world, world.mira) == ["AI drafted"]
    assert _summaries(anonymous_client, world, world.ben) == []


def test_history_stays_with_the_manager_when_a_bde_moves(anonymous_client, test_db, world):
    _log(test_db, world.bea, "Under Mira")
    world.bea.manager_id = world.zed.id
    test_db.commit()
    _log(test_db, world.bea, "Under Zed")
    assert _summaries(anonymous_client, world, world.mira) == ["Under Mira"]
    assert _summaries(anonymous_client, world, world.zed) == ["Under Zed"]
    assert _summaries(anonymous_client, world, world.bea) == ["Under Zed", "Under Mira"]


def test_a_picked_candidate_shows_only_the_time_it_was_theirs(anonymous_client, test_db, world):
    _log(test_db, world.owner, "While Bea's", world.asha)
    world.asha.bde_id = world.ben.id
    test_db.commit()
    _log(test_db, world.owner, "While Ben's", world.asha)
    picked = f"?candidate_id={world.asha.id}"
    assert _summaries(anonymous_client, world, world.bea, picked) == ["While Bea's"]
    assert _summaries(anonymous_client, world, world.ben, picked) == ["While Ben's"]
    assert _summaries(anonymous_client, world, world.owner, picked) == ["While Ben's", "While Bea's"]
    assert _summaries(anonymous_client, world, world.cara, picked) == []


def test_another_teams_candidate_can_be_picked_for_nothing(anonymous_client, test_db, world):
    _log(test_db, world.cara, "Cara applied", world.ravi)
    assert _summaries(anonymous_client, world, world.mira, f"?candidate_id={world.ravi.id}") == []
    assert _summaries(anonymous_client, world, world.bea, f"?candidate_id={world.ravi.id}") == []


def test_an_assignment_is_seen_from_both_sides(anonymous_client, api_client, test_db, world):
    response = api_client.post(f"/api/firms/{world.id}/candidates/{world.asha.id}/assign",
                               json={"manager_id": str(world.mira.id), "bde_id": str(world.ben.id)})
    assert response.status_code == 200, response.text
    test_db.expire_all()
    assert len(_summaries(anonymous_client, world, world.bea)) == 1      # it came from them
    assert len(_summaries(anonymous_client, world, world.ben)) == 1      # it went to them
    assert _summaries(anonymous_client, world, world.cara) == []


def test_a_support_view_cant_search_what_it_cant_read(test_db, world):
    from backend.api.routes_ledger import Filters
    entry = ledger.record(test_db, actor=world.bea, action="CREATE", entity_type="email", entity_id=uuid.uuid4(),
                          entity_label="Message", summary="Offer from Acme", firm_id=world.id,
                          candidate_id=world.asha.id, changes={"subject": {"before": None, "after": "Offer"}})
    test_db.commit()
    from backend.auth.serialize import ledger_entry_json
    assert ledger_entry_json(entry, hide_email=True)["changes"] is None
    filters = Filters(None, None, None, None, None, None, None, None, None, "Offer")
    query = test_db.query(ActivityEntry).filter(ActivityEntry.firm_id == world.id)
    assert filters.apply(query, test_db, world.id, hide_email=True).count() == 0
    assert filters.apply(query, test_db, world.id, hide_email=False).count() == 1


# ── Filters ───────────────────────────────────────────────────────────────────────────────────────────────────────


def test_filters_by_person_including_what_their_ai_did(anonymous_client, test_db, world):
    _log(test_db, world.bea, "Bea")
    _log(test_db, world.ben, "Ben")
    ledger.record_automated(test_db, actor_type="AGENT", actor_name="AI agent (Bea)", action="AI_GENERATE",
                            entity_type="resume", entity_id=uuid.uuid4(), entity_label="Resume", summary="AI for Bea",
                            firm_id=world.id, candidate_id=world.asha.id, on_behalf_of=world.bea)
    test_db.commit()
    assert _summaries(anonymous_client, world, world.owner, f"?actor_id={world.bea.id}") == ["AI for Bea", "Bea"]
    assert _summaries(anonymous_client, world, world.owner, "?actor_type=AGENT") == ["AI for Bea"]


def test_filters_by_team(anonymous_client, test_db, world):
    _log(test_db, world.bea, "Bea")
    _log(test_db, world.cara, "Cara")
    assert _summaries(anonymous_client, world, world.owner, f"?team_id={world.mira.id}") == ["Bea"]


def test_a_filter_cant_widen_what_a_role_reads(anonymous_client, test_db, world):
    _log(test_db, world.cara, "Cara")
    assert _summaries(anonymous_client, world, world.mira, f"?actor_id={world.cara.id}") == []
    assert _summaries(anonymous_client, world, world.mira, f"?team_id={world.zed.id}") == []


def test_search_covers_summary_person_and_record_and_takes_wildcards_literally(anonymous_client, test_db, world):
    _log(test_db, world.bea, "Moved to 100% remote", entity_label="Globex")
    _log(test_db, world.ben, "Other")
    for query, expected in (("?q=REMOTE", 1), ("?q=globex", 1), ("?q=Ben", 1), ("?q=100%25", 1), ("?q=%25", 1),
                            ("?q=_", 0), ("?q=nothing", 0)):
        assert len(_summaries(anonymous_client, world, world.owner, query)) == expected, query


def test_days_are_the_firms_own(anonymous_client, test_db, world):
    """20:00 UTC on the 3rd is 01:30 on the 4th in Asia/Kolkata, and 20:00 on the 3rd in UTC."""
    moment = datetime(2026, 3, 3, 20, 0, tzinfo=timezone.utc)
    ledger.record(test_db, actor=world.bea, action="UPDATE", entity_type="user", entity_id=world.bea.id,
                  entity_label="Bea", summary="Late", firm_id=world.id, candidate_id=None, at=moment)
    test_db.commit()
    assert test_db.get(Firm, world.id).primary_timezone == "Asia/Kolkata"
    assert _summaries(anonymous_client, world, world.owner, "?from_date=2026-03-04&to_date=2026-03-04") == ["Late"]
    assert _summaries(anonymous_client, world, world.owner, "?from_date=2026-03-03&to_date=2026-03-03") == []
    test_db.get(Firm, world.id).primary_timezone = "UTC"
    test_db.commit()
    assert _summaries(anonymous_client, world, world.owner, "?from_date=2026-03-03&to_date=2026-03-03") == ["Late"]
    assert _summaries(anonymous_client, world, world.owner, "?from_date=2026-03-04&to_date=2026-03-04") == []


# ── Paging ────────────────────────────────────────────────────────────────────────────────────────────────────────


def test_paging_by_cursor_never_repeats_or_skips_even_with_equal_times(anonymous_client, test_db, world):
    moment = datetime(2026, 3, 3, 12, 0, tzinfo=timezone.utc)
    for number in range(5):
        ledger.record(test_db, actor=world.bea, action="UPDATE", entity_type="user", entity_id=world.bea.id,
                      entity_label="Bea", summary=str(number), firm_id=world.id, candidate_id=None, at=moment)
    test_db.commit()
    seen, cursor = [], None
    while True:
        rows = _read(anonymous_client, world, world.owner, "?limit=2" + (f"&cursor={cursor}" if cursor else ""))
        if not rows:
            break
        seen += [row["summary"] for row in rows]
        cursor = rows[-1]["cursor"]
    assert sorted(seen) == ["0", "1", "2", "3", "4"]


def test_a_row_added_while_paging_doesnt_shift_the_next_page(anonymous_client, test_db, world):
    for number in range(3):
        _log(test_db, world.bea, str(number))
    first = _read(anonymous_client, world, world.owner, "?limit=2")
    _log(test_db, world.bea, "new")
    rest = _read(anonymous_client, world, world.owner, f"?limit=2&cursor={first[-1]['cursor']}")
    assert [row["summary"] for row in rest] == ["0"]


@pytest.mark.parametrize("cursor", ["nonsense", "12_notauuid", "x_y", f"99999999999999999999_{uuid.uuid4()}"])
def test_a_bad_cursor_is_refused(api_client, world, cursor):
    assert api_client.get(f"{world.url}?cursor={cursor}").status_code == 400


# ── People and candidates ─────────────────────────────────────────────────────────────────────────────────────────


def _people(client, world, user, query=""):
    body = _read(client, world, user, query, "/people")
    return body, {p["name"]: p for p in body["people"]}


def test_the_owner_gets_everyone_with_derived_counts(anonymous_client, test_db, world):
    _log(test_db, world.bea, "One")
    _log(test_db, world.bea, "Two")
    _log(test_db, world.cara, "Three")
    body, people = _people(anonymous_client, world, world.owner)
    assert (people["Bea"]["actions"], people["Cara"]["actions"], people["Mira"]["actions"]) == (2, 1, 0)
    assert people["Bea"]["manager_id"] == str(world.mira.id)
    assert body["total"] == 3 and body["timezone"] == "Asia/Kolkata"
    assert body["actor_types"] == ["USER", "SYSTEM", "AGENT", "PLATFORM_ADMIN"]


def test_an_ai_action_counts_for_the_person_it_worked_for(anonymous_client, test_db, world):
    ledger.record_automated(test_db, actor_type="AGENT", actor_name="AI agent (Bea)", action="AI_GENERATE",
                            entity_type="resume", entity_id=uuid.uuid4(), entity_label="Resume", summary="AI",
                            firm_id=world.id, candidate_id=world.asha.id, on_behalf_of=world.bea)
    test_db.commit()
    assert _people(anonymous_client, world, world.owner)[1]["Bea"]["actions"] == 1


def test_a_manager_gets_their_team_and_no_system_filter(anonymous_client, world):
    body, people = _people(anonymous_client, world, world.mira)
    assert set(people) == {"Mira", "Bea", "Ben"}
    assert body["actor_types"] == ["USER", "AGENT"]


def test_a_bde_gets_only_themselves_and_no_type_filter(anonymous_client, test_db, world):
    _log(test_db, world.bea, "One")
    body, people = _people(anonymous_client, world, world.bea)
    assert list(people) == ["Bea"] and people["Bea"]["actions"] == 1
    assert body["actor_types"] == []


def test_someone_who_left_is_a_former_member_only_if_they_have_rows(anonymous_client, test_db, world):
    _log(test_db, world.bea, "Before moving")
    world.bea.manager_id = world.zed.id
    world.ben.manager_id = world.zed.id
    test_db.commit()
    _, people = _people(anonymous_client, world, world.mira)
    assert people["Bea"]["is_former"] is True
    assert "Ben" not in people


def test_the_owner_assigning_a_candidate_doesnt_join_the_managers_team(anonymous_client, api_client, test_db, world):
    response = api_client.post(f"/api/firms/{world.id}/candidates/{world.asha.id}/assign",
                               json={"manager_id": str(world.mira.id), "bde_id": str(world.ben.id)})
    assert response.status_code == 200, response.text
    assert len(_summaries(anonymous_client, world, world.mira)) == 1
    assert set(_people(anonymous_client, world, world.mira)[1]) == {"Mira", "Bea", "Ben"}


def test_a_deactivated_user_is_former(anonymous_client, test_db, world):
    _log(test_db, world.ben, "One")
    world.ben.is_active = False
    world.cara.is_active = False
    test_db.commit()
    _, people = _people(anonymous_client, world, world.owner)
    assert people["Ben"]["is_former"] is True
    assert "Cara" not in people


def test_counts_ignore_who_is_picked_but_follow_the_other_filters(anonymous_client, test_db, world):
    _log(test_db, world.bea, "Bea", world.asha)
    _log(test_db, world.ben, "Ben")
    _, people = _people(anonymous_client, world, world.owner, f"?actor_id={world.bea.id}")
    assert people["Ben"]["actions"] == 1
    _, people = _people(anonymous_client, world, world.owner, f"?candidate_id={world.asha.id}")
    assert (people["Bea"]["actions"], people["Ben"]["actions"]) == (1, 0)


def test_the_candidate_list_is_what_the_reader_can_see_narrowed_by_person(anonymous_client, test_db, world):
    _log(test_db, world.bea, "Bea", world.asha)
    _log(test_db, world.cara, "Cara", world.ravi)
    names = lambda user, query="": [c["name"] for c in _read(anonymous_client, world, user, query, "/candidates")]
    assert names(world.owner) == ["Asha", "Ravi"]
    assert names(world.owner, f"?actor_id={world.cara.id}") == ["Ravi"]
    assert names(world.owner, f"?team_id={world.mira.id}") == ["Asha"]
    assert names(world.mira) == ["Asha"]
    assert names(world.cara) == ["Ravi"]


@pytest.mark.parametrize("path", ["/people", "/candidates"])
def test_another_firms_people_and_candidates_are_not_found(anonymous_client, test_db, world, path):
    other = make_firm(test_db, make_plan(test_db, name="Other plan"), slug="other")
    test_db.commit()
    response = anonymous_client.get(f"/api/firms/{other.id}/ledger{path}", headers=_as_session(world, world.owner))
    assert response.status_code == 404


# ── The migration ─────────────────────────────────────────────────────────────────────────────────────────────────


@pytest.fixture
def at_0015():
    name = f"jn_activity_{uuid.uuid4().hex[:8]}_test"
    admin = _admin_engine()
    with admin.connect() as conn:
        conn.execute(text(f'CREATE DATABASE "{name}"'))
    url = _url_for(name)
    engine = create_engine(url, poolclass=NullPool)
    _alembic(url, "upgrade", "0015")
    try:
        yield url, engine
    finally:
        engine.dispose()
        with admin.connect() as conn:
            conn.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        admin.dispose()


def _alembic(url, *arguments):
    done = subprocess.run([sys.executable, "-m", "alembic", "-c", "backend/alembic.ini", *arguments],
                          env={**os.environ, "DATABASE_URL": url}, capture_output=True, text=True)
    assert done.returncode == 0, f"{done.stdout}\n{done.stderr}"


def test_the_old_ledger_is_copied_stamped_from_today_and_left_as_it_was(at_0015):
    url, engine = at_0015
    with Session(engine) as db:
        firm = make_firm(db, make_plan(db, name="Plan"), slug="copied")
        manager = make_user(db, firm, email="m@copied.test", role="MANAGER", name="Mira")
        bde = make_user(db, firm, email="b@copied.test", role="BDE", name="Bea")
        bde.manager_id = manager.id
        candidate = Candidate(firm_id=firm.id, manager_id=manager.id, bde_id=bde.id, created_by_user_id=manager.id,
                              full_name="Asha", work_auth="H1B")
        db.add(candidate)
        db.flush()
        when = datetime(2026, 1, 2, 3, 4, tzinfo=timezone.utc)
        entry_id, firm_id, manager_id, bde_id, candidate_id = uuid.uuid4(), firm.id, manager.id, bde.id, candidate.id
        db.add(LedgerEntry(id=entry_id, firm_id=firm.id, actor_type="USER", actor_user_id=bde.id, actor_name="Bea",
                           entity_type="candidate", entity_id=str(candidate.id), entity_label="Asha", action="ASSIGN",
                           summary="Old", note="Handoff", candidate_id=candidate.id, created_at=when))
        db.add(LedgerEntry(firm_id=None, actor_type="SYSTEM", actor_name="script", entity_type="firm", entity_id="x",
                           entity_label="x", action="CREATE", summary="Platform"))
        db.commit()

    _alembic(url, "upgrade", "0016")
    with Session(engine) as db:
        assert db.query(ActivityEntry).count() == 2 == db.query(LedgerEntry).count()
        row = db.get(ActivityEntry, entry_id)
        assert (row.summary, row.note, row.created_at, row.firm_id) == ("Old", "Handoff", when, firm_id)
        assert (row.actor_role, row.team_manager_id) == ("BDE", manager_id)
        assert (row.candidate_manager_id, row.candidate_bde_id, row.candidate_id) == (manager_id, bde_id, candidate_id)
        assert (row.on_behalf_of_user_id, row.changes, row.request_id) == (None, None, None)
        db.add(ActivityEntry(firm_id=firm_id, actor_type="SYSTEM", actor_name="new", entity_type="firm", entity_id="y",
                             entity_label="y", action="CREATE", summary="Written after"))
        db.commit()

    _alembic(url, "downgrade", "0015")
    with Session(engine) as db:
        assert db.execute(text("SELECT to_regclass('activity_logs')")).scalar() is None
        assert db.query(LedgerEntry).count() == 3
        assert db.query(LedgerEntry).filter(LedgerEntry.summary == "Written after").count() == 1
