"""The firm hierarchy on the team routes (docs/candidate-onboarding/06-backend.md PR 2; 07 Q40, Q43, Q46, Q51): a BDE
invite names a manager, accepting it keeps the manager, the OWNER moves a BDE (and their candidates) to another manager,
and sets the firm's BDE capacity."""
import pytest

from backend.tests.auth_support import make_firm, make_plan, make_user


def _cookie(token):
    return {"cookie": f"bq_session={token}"}


def _session_for(test_db, user):
    from backend.auth.sessions import start_session
    token, _ = start_session(test_db, user)
    test_db.commit()
    return _cookie(token)


@pytest.fixture
def firm(test_db, accounts):
    from backend.models.tenancy import Firm
    return test_db.get(Firm, accounts.firm_id)


@pytest.fixture
def owner(accounts):
    return _cookie(accounts.firm_token)


@pytest.fixture
def people(test_db, firm):
    """Two teams: Fatima manages Adnan; Priya manages nobody yet. Old Bob is a BDE from before the hierarchy (Q51)."""
    fatima = make_user(test_db, firm, email="fatima@acme.test", role="MANAGER", name="Fatima Reddy")
    priya = make_user(test_db, firm, email="priya@acme.test", role="MANAGER", name="Priya Shah")
    adnan = make_user(test_db, firm, email="adnan@acme.test", role="BDE", name="Adnan Khan")
    bob = make_user(test_db, firm, email="bob@acme.test", role="BDE", name="Old Bob")
    gone = make_user(test_db, firm, email="gone@acme.test", role="MANAGER", name="Gone Manager", is_active=False)
    adnan.manager_id = fatima.id
    test_db.commit()
    return {"fatima": fatima, "priya": priya, "adnan": adnan, "bob": bob, "gone": gone}


def _invite(client, firm, cookie, **body):
    return client.post(f"/api/firms/{firm.id}/invites", json={"email": "new@acme.test", "role": "BDE", **body},
                       headers=cookie)


# ── Inviting ─────────────────────────────────────────────────────────────────

def test_a_bde_invite_names_an_active_manager_of_the_firm(anonymous_client, test_db, firm, owner, people):
    r = _invite(anonymous_client, firm, owner, manager_id=str(people["fatima"].id))
    assert r.status_code == 201
    assert r.json()["invite"]["manager_id"] == str(people["fatima"].id)
    assert _invite(anonymous_client, firm, owner, email="b@acme.test").status_code == 400          # none named
    assert _invite(anonymous_client, firm, owner, email="c@acme.test",
                   manager_id=str(people["adnan"].id)).status_code == 404                         # a BDE
    assert _invite(anonymous_client, firm, owner, email="d@acme.test",
                   manager_id=str(people["gone"].id)).status_code == 404                          # inactive
    other_plan = make_plan(test_db, name="Other plan")
    other = make_user(test_db, make_firm(test_db, other_plan, slug="other"), email="m@other.test", role="MANAGER")
    test_db.commit()
    assert _invite(anonymous_client, firm, owner, email="e@acme.test",
                   manager_id=str(other.id)).status_code == 404                                   # another firm's


def test_no_other_role_names_a_manager(anonymous_client, firm, owner, people):
    for role in ("MANAGER", "VIEWER"):
        r = _invite(anonymous_client, firm, owner, email=f"{role.lower()}@new.test", role=role,
                    manager_id=str(people["fatima"].id))
        assert r.status_code == 400, role


def test_a_firm_without_a_manager_cant_invite_bdes(anonymous_client, firm, owner):
    r = _invite(anonymous_client, firm, owner)
    assert r.status_code == 409
    assert r.json() == {"detail": "Invite a manager first. Every BDE reports to a manager."}


def test_accepting_a_bde_invite_keeps_the_manager(anonymous_client, test_db, firm, owner, people):
    from backend.models.tenancy import User
    token = _invite(anonymous_client, firm, owner, manager_id=str(people["priya"].id)).json()["invite_token"]
    r = anonymous_client.post(f"/api/invites/{token}/accept", json={"name": "New Bde", "password": "a-long-password"})
    assert r.status_code == 200, r.text
    assert test_db.query(User).filter(User.email == "new@acme.test").one().manager_id == people["priya"].id


# ── Changing a BDE's manager ─────────────────────────────────────────────────

def _move(client, firm, cookie, user, manager):
    return client.patch(f"/api/firms/{firm.id}/members/{user.id}/manager", json={"manager_id": str(manager.id)},
                        headers=cookie)


def test_the_owner_moves_a_bde_and_their_candidates_follow(anonymous_client, test_db, firm, owner, people):
    from backend.models.candidates import Candidate
    from backend.models.tenancy import LedgerEntry
    adnan, fatima, priya = people["adnan"], people["fatima"], people["priya"]
    worked = [Candidate(firm_id=firm.id, manager_id=fatima.id, bde_id=adnan.id, created_by_user_id=fatima.id,
                        full_name=f"Candidate {n}", work_auth="H1B") for n in range(2)]
    queued = Candidate(firm_id=firm.id, manager_id=fatima.id, bde_id=None, created_by_user_id=fatima.id,
                       full_name="Waiting", work_auth="GC")
    test_db.add_all([*worked, queued])
    test_db.commit()

    r = _move(anonymous_client, firm, owner, adnan, priya)
    assert r.status_code == 200
    assert r.json()["manager_id"] == str(priya.id)
    test_db.expire_all()
    assert [test_db.get(Candidate, c.id).manager_id for c in worked] == [priya.id, priya.id]
    assert test_db.get(Candidate, queued.id).manager_id == fatima.id          # a queue stays with its manager
    entry = test_db.query(LedgerEntry).filter(LedgerEntry.entity_id == str(adnan.id)).one()
    assert (entry.action, entry.summary) == ("UPDATE", "Adnan Khan now reports to Priya Shah (was Fatima Reddy); "
                                                       "2 candidates moved")


def test_a_bde_without_a_manager_gets_one_the_same_way(anonymous_client, test_db, firm, owner, people):
    from backend.models.tenancy import LedgerEntry
    assert _move(anonymous_client, firm, owner, people["bob"], people["fatima"]).status_code == 200
    entry = test_db.query(LedgerEntry).filter(LedgerEntry.entity_id == str(people["bob"].id)).one()
    assert entry.summary == "Old Bob now reports to Fatima Reddy; 0 candidates moved"


def test_only_a_bde_moves_and_only_to_an_active_manager(anonymous_client, firm, owner, people):
    assert _move(anonymous_client, firm, owner, people["fatima"], people["priya"]).status_code == 404   # not a BDE
    assert _move(anonymous_client, firm, owner, people["adnan"], people["gone"]).status_code == 404     # inactive
    assert _move(anonymous_client, firm, owner, people["adnan"], people["adnan"]).status_code == 404    # a BDE


def test_only_the_owner_moves_a_bde(anonymous_client, test_db, firm, people):
    for who in ("fatima", "adnan"):
        cookie = _session_for(test_db, people[who])
        assert _move(anonymous_client, firm, cookie, people["adnan"], people["priya"]).status_code == 403, who


# ── BDE capacity ─────────────────────────────────────────────────────────────

def test_the_owner_sets_the_bde_capacity(anonymous_client, test_db, firm, owner, people):
    from backend.models.tenancy import LedgerEntry
    r = anonymous_client.patch(f"/api/firms/{firm.id}/settings", json={"bde_capacity": 8}, headers=owner)
    assert r.status_code == 200
    assert r.json()["bde_capacity"] == 8
    entry = test_db.query(LedgerEntry).filter(LedgerEntry.entity_type == "firm", LedgerEntry.action == "UPDATE").one()
    assert entry.summary == "BDE capacity 10 → 8"
    for bad in (0, 51):
        assert anonymous_client.patch(f"/api/firms/{firm.id}/settings", json={"bde_capacity": bad},
                                      headers=owner).status_code == 422
    manager = _session_for(test_db, people["fatima"])
    assert anonymous_client.patch(f"/api/firms/{firm.id}/settings", json={"bde_capacity": 5},
                                  headers=manager).status_code == 403
