"""A firm's ledger (backend/api/routes_ledger.py; docs/integration/01-ledger.md): the firm's own entries, newest
first; a BDE's own entries only; another firm's ledger and a Super Admin get no answer."""
from datetime import timedelta

import pytest

from backend.models.db import utcnow
from backend.models.tenancy import Firm, LedgerEntry
from backend.tests.auth_support import make_firm, make_plan, make_user
from backend.tests.ledger_support import assert_logged


def _cookie(token):
    return {"cookie": f"bq_session={token}"}


def _session_for(test_db, user):
    from backend.auth.sessions import start_session
    token, _ = start_session(test_db, user)
    test_db.commit()
    return _cookie(token)


def _entry(firm_id, actor, summary, minutes_ago, action="UPDATE"):
    return LedgerEntry(firm_id=firm_id, actor_type="USER", actor_user_id=actor.id if actor else None,
                       actor_name=actor.name if actor else "System", entity_type="candidate", entity_id="c-1",
                       entity_label="Priya", action=action, summary=summary,
                       created_at=utcnow() - timedelta(minutes=minutes_ago))


@pytest.fixture
def ledger(test_db, accounts):
    """In acme: an entry by the owner, one by a BDE, one by a second BDE. In globex: one. And a platform event."""
    from backend.models.tenancy import User
    acme = test_db.get(Firm, accounts.firm_id)
    owner = test_db.get(User, accounts.user_id)
    bde = make_user(test_db, acme, email="bde@acme.test", role="BDE", name="Bea")
    other_bde = make_user(test_db, acme, email="bde2@acme.test", role="BDE", name="Ben")
    globex = make_firm(test_db, make_plan(test_db, name="Other plan"), slug="globex")
    test_db.add_all([
        _entry(acme.id, owner, "Owner edit", 3),
        _entry(acme.id, bde, "Bea edit", 2),
        _entry(acme.id, other_bde, "Ben edit", 1),
        _entry(globex.id, make_user(test_db, globex, email="o@globex.test"), "Globex edit", 0),
        _entry(None, None, "Platform event", 0, action="FIRM_CREATED"),
    ])
    test_db.commit()
    return {"bde": _session_for(test_db, bde), "bde_user": bde,
            "manager": _session_for(test_db, make_user(test_db, acme, email="m@acme.test", role="MANAGER")),
            "viewer": _session_for(test_db, make_user(test_db, acme, email="v@acme.test", role="VIEWER")),
            "globex": globex}


def _url(firm_id, query=""):
    return f"/api/firms/{firm_id}/ledger{query}"


def _summaries(resp):
    assert resp.status_code == 200, resp.text
    return [e["summary"] for e in resp.json()]


def test_the_owner_sees_the_firms_entries_newest_first(api_client, accounts, ledger):
    assert _summaries(api_client.get(_url(accounts.firm_id))) == ["Ben edit", "Bea edit", "Owner edit"]


@pytest.mark.parametrize("role", ["manager", "viewer"])
def test_a_manager_and_a_viewer_see_the_whole_firm(anonymous_client, accounts, ledger, role):
    resp = anonymous_client.get(_url(accounts.firm_id), headers=ledger[role])
    assert _summaries(resp) == ["Ben edit", "Bea edit", "Owner edit"]


def test_a_bde_sees_only_their_own_entries(anonymous_client, accounts, ledger):
    """Enforced by the backend (07 §2.2 `own`); the page's scopeLedger is the same rule as UX."""
    resp = anonymous_client.get(_url(accounts.firm_id), headers=ledger["bde"])
    assert _summaries(resp) == ["Bea edit"]
    assert resp.json()[0]["actor_user_id"] == str(ledger["bde_user"].id)


def test_paging(api_client, accounts, ledger):
    assert _summaries(api_client.get(_url(accounts.firm_id, "?limit=2"))) == ["Ben edit", "Bea edit"]
    assert _summaries(api_client.get(_url(accounts.firm_id, "?limit=2&offset=2"))) == ["Owner edit"]
    assert api_client.get(_url(accounts.firm_id, "?limit=501")).status_code == 422


def test_the_entry_has_the_frontends_shape(api_client, accounts, ledger):
    entry = api_client.get(_url(accounts.firm_id, "?limit=1")).json()[0]
    assert set(entry) == {"id", "firm_id", "actor_user_id", "actor_type", "actor_name", "entity_type", "entity_id",
                          "entity_label", "action", "summary", "note", "model_id", "prompt_version", "evidence_ids",
                          "claim_state", "created_at"}
    assert entry["firm_id"] == str(accounts.firm_id) and entry["evidence_ids"] == []


def test_another_firms_ledger_is_not_found(api_client, ledger):
    assert api_client.get(_url(ledger["globex"].id)).status_code == 404


def test_a_missing_firm_is_not_found(api_client):
    assert api_client.get(_url("00000000-0000-4000-8000-0000000000ff")).status_code == 404


def test_a_super_admin_is_refused(anonymous_client, accounts, ledger):
    """Until the support-view endpoints let a Super Admin read a firm (07 F3)."""
    resp = anonymous_client.get(_url(accounts.firm_id), headers=_cookie(accounts.admin_token))
    assert resp.status_code == 403


def test_signed_out_is_refused(anonymous_client, accounts):
    assert anonymous_client.get(_url(accounts.firm_id)).status_code == 401


def test_a_write_shows_up_in_the_ledger(anonymous_client, accounts, ledger, test_db):
    """The chain a track copies: a write logs through backend/auth/ledger.py, assert_logged checks it, and the
    firm's ledger shows it."""
    owner = _cookie(accounts.firm_token)
    resp = anonymous_client.post(f"/api/firms/{accounts.firm_id}/invites", headers=owner,
                                 json={"email": "new@acme.test", "role": "VIEWER"})   # a BDE would need a manager (07 Q40)
    assert resp.status_code == 201, resp.text
    invite_id = resp.json()["invite"]["id"]
    assert_logged(test_db, action="INVITE_SENT", entity_type="invite", entity_id=invite_id,
                  firm_id=accounts.firm_id, actor_user_id=accounts.user_id)
    newest = anonymous_client.get(_url(accounts.firm_id, "?limit=1"), headers=owner).json()[0]
    assert newest["action"] == "INVITE_SENT" and newest["entity_id"] == invite_id


# 07 Q52: a BDE also reads the ASSIGN entries about the candidates they work now; and every reader can filter.

def _candidate(test_db, firm, manager, bde, name):
    from backend.models.candidates import Candidate
    candidate = Candidate(firm_id=firm.id, manager_id=manager.id, bde_id=bde.id if bde else None,
                          created_by_user_id=manager.id, full_name=name, work_auth="H1B")
    test_db.add(candidate)
    test_db.flush()
    return candidate


def _assign(firm_id, actor, candidate, summary, minutes_ago, note=None):
    entry = _entry(firm_id, actor, summary, minutes_ago, action="ASSIGN")
    entry.entity_id, entry.entity_label, entry.note = str(candidate.id), candidate.full_name, note
    entry.candidate_id = candidate.id          # as ledger.record sets it for an entry about a candidate (Q53h)
    return entry


@pytest.fixture
def assignments(test_db, accounts, ledger):
    """Bea works Asha (assigned by a manager); Ben works Ravi; Kiran is in the manager's queue. Plus a manager's
    UPDATE on Asha, which Bea must not see (only ASSIGN entries widen her view)."""
    from backend.models.tenancy import User
    acme = test_db.get(Firm, accounts.firm_id)
    manager = make_user(test_db, acme, email="mgr@acme.test", role="MANAGER", name="Mira")
    bea = ledger["bde_user"]
    ben = test_db.query(User).filter(User.email == "bde2@acme.test").one()
    asha = _candidate(test_db, acme, manager, bea, "Asha")
    ravi = _candidate(test_db, acme, manager, ben, "Ravi")
    kiran = _candidate(test_db, acme, manager, None, "Kiran")
    update = _entry(acme.id, manager, "Mira edited Asha", 4)
    update.entity_id, update.candidate_id = str(asha.id), asha.id
    test_db.add_all([
        _assign(acme.id, manager, asha, "Assigned Asha to Bea", 6, note="Push banking."),
        _assign(acme.id, manager, ravi, "Assigned Ravi to Ben", 5),
        _assign(acme.id, manager, kiran, "Kiran to Mira's queue", 7),
        update,
    ])
    test_db.commit()
    return {"asha": asha, "ravi": ravi}


def test_a_bde_also_sees_who_assigned_them_their_candidates(anonymous_client, accounts, ledger, assignments):
    resp = anonymous_client.get(_url(accounts.firm_id), headers=ledger["bde"])
    assert _summaries(resp) == ["Bea edit", "Assigned Asha to Bea"]
    assert resp.json()[1]["note"] == "Push banking."


def test_a_candidate_moved_away_takes_its_assignments_with_it(anonymous_client, accounts, ledger, assignments, test_db):
    from backend.models.tenancy import User
    assignments["asha"].bde_id = test_db.query(User).filter(User.email == "bde2@acme.test").one().id
    test_db.commit()
    assert _summaries(anonymous_client.get(_url(accounts.firm_id), headers=ledger["bde"])) == ["Bea edit"]


def test_filters_by_entity_and_action(api_client, accounts, ledger, assignments):
    asha = str(assignments["asha"].id)
    assert _summaries(api_client.get(_url(accounts.firm_id, f"?entity_type=candidate&entity_id={asha}"))) == \
        ["Mira edited Asha", "Assigned Asha to Bea"]
    assert _summaries(api_client.get(_url(accounts.firm_id, f"?entity_id={asha}&action=ASSIGN"))) == ["Assigned Asha to Bea"]
    assert _summaries(api_client.get(_url(accounts.firm_id, "?action=ASSIGN"))) == \
        ["Assigned Ravi to Ben", "Assigned Asha to Bea", "Kiran to Mira's queue"]
    assert _summaries(api_client.get(_url(accounts.firm_id, "?entity_type=invite"))) == []


def test_a_bde_filtering_stays_inside_their_scope(anonymous_client, accounts, ledger, assignments):
    ravi = str(assignments["ravi"].id)
    assert _summaries(anonymous_client.get(_url(accounts.firm_id, f"?entity_id={ravi}"), headers=ledger["bde"])) == []


def test_filters_by_candidate_their_whole_activity(api_client, accounts, ledger, assignments, test_db):
    """07 Q53h: everything about a candidate, whatever the entry's entity (an application here)."""
    from backend.auth import ledger as ledger_log
    from backend.models.tenancy import User
    owner = test_db.get(User, accounts.user_id)
    asha = assignments["asha"]
    ledger_log.record(test_db, actor=owner, action="CREATE", entity_type="application", entity_id=asha.id,
                      entity_label="Acme", summary="Applied for Asha", firm_id=accounts.firm_id, candidate_id=asha.id)
    test_db.commit()
    assert _summaries(api_client.get(_url(accounts.firm_id, f"?candidate_id={asha.id}"))) == \
        ["Applied for Asha", "Mira edited Asha", "Assigned Asha to Bea"]
