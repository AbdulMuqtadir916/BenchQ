"""The OWNER invites MANAGER / BDE / VIEWER (backend/api/routes_team.py; docs/07 Phase M, 07 Q38), and the whole
onboarding flow end to end: Super Admin creates a firm, the owner accepts and invites, the members accept."""
from datetime import timedelta

import pytest

from backend.tests.auth_support import TEST_PASSWORD, make_firm, make_user


def _cookie(token):
    return {"cookie": f"bq_session={token}"}


def _session_for(test_db, user):
    from backend.auth.sessions import start_session
    token, _ = start_session(test_db, user)
    test_db.commit()
    return _cookie(token)


@pytest.fixture
def owner(accounts):
    return _cookie(accounts.firm_token)


@pytest.fixture
def team(test_db, accounts):
    """A MANAGER, BDE and VIEWER in the owner's firm, each with a session."""
    from backend.models.tenancy import Firm
    firm = test_db.get(Firm, accounts.firm_id)
    return {role: _session_for(test_db, make_user(test_db, firm, email=f"{role.lower()}@acme.test", role=role,
                                                  name=role.title()))
            for role in ("MANAGER", "BDE", "VIEWER")}


def _invites(accounts):
    return f"/api/firms/{accounts.firm_id}/invites"


def _invite(client, accounts, cookie, **body):
    return client.post(_invites(accounts), json={"email": "bea@acme.test", "role": "BDE", **body}, headers=cookie)


# ── Inviting ─────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("role", ["MANAGER", "BDE", "VIEWER"])
def test_the_owner_invites_each_member_role(anonymous_client, accounts, owner, role, test_db):
    from backend.models.tenancy import LedgerEntry
    r = _invite(anonymous_client, accounts, owner, role=role, invitee_name=" Bea ")
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["invite"]["role"] == role
    assert body["invite"]["firm_id"] == str(accounts.firm_id)
    assert body["invite"]["invited_by_user_id"] == str(accounts.user_id)
    assert body["invite"]["invitee_name"] == "Bea"
    assert len(body["invite_token"]) == 43
    entry = test_db.query(LedgerEntry).filter(LedgerEntry.action == "INVITE_SENT").one()
    assert entry.summary == f"Invited Bea (bea@acme.test) as {role}"
    assert entry.actor_type == "USER" and entry.firm_id == accounts.firm_id


@pytest.mark.parametrize("role", ["OWNER", "PLATFORM_ADMIN", "bde", ""])
def test_never_an_owner_or_anything_else(anonymous_client, accounts, owner, role):
    r = _invite(anonymous_client, accounts, owner, role=role)
    assert r.status_code == 400
    assert r.json() == {"detail": "Choose Manager, BDE or Viewer."}


@pytest.mark.parametrize("who", ["MANAGER", "BDE", "VIEWER"])
def test_only_the_owner_invites(anonymous_client, accounts, team, who):
    assert _invite(anonymous_client, accounts, team[who]).status_code == 403


def test_another_firm_is_404(anonymous_client, accounts, owner, test_db):
    from backend.models.tenancy import Plan
    other = make_firm(test_db, test_db.get(Plan, accounts.plan_id), slug="globex")
    test_db.commit()
    r = anonymous_client.post(f"/api/firms/{other.id}/invites", json={"email": "x@globex.test", "role": "BDE"},
                              headers=owner)
    assert r.status_code == 404
    assert anonymous_client.get(f"/api/firms/{other.id}/members", headers=owner).status_code == 404


def test_a_super_admin_cant_invite_into_a_firm(anonymous_client, accounts):
    assert _invite(anonymous_client, accounts, _cookie(accounts.admin_token)).status_code == 403


def test_one_email_one_account(anonymous_client, accounts, owner):
    assert _invite(anonymous_client, accounts, owner, email="owner@acme.test").status_code == 409
    assert _invite(anonymous_client, accounts, owner, email="admin@benchq.test").status_code == 409
    assert _invite(anonymous_client, accounts, owner).status_code == 201
    assert _invite(anonymous_client, accounts, owner, email="BEA@acme.test").status_code == 409


# ── Seats (A1, A4) ───────────────────────────────────────────────────────────

def _set_seats(test_db, accounts, limit):
    from backend.models.tenancy import Firm
    test_db.get(Firm, accounts.firm_id).seat_limit = limit
    test_db.commit()


def test_an_invite_is_blocked_at_the_seat_limit(anonymous_client, accounts, owner, test_db):
    _set_seats(test_db, accounts, 2)                     # the owner holds one seat
    assert _invite(anonymous_client, accounts, owner).status_code == 201
    r = _invite(anonymous_client, accounts, owner, email="cal@acme.test")
    assert r.status_code == 409
    assert r.json() == {"detail": "Your plan allows 2 seats; 2 are in use."}


def test_a_revoked_or_expired_invite_frees_its_seat(anonymous_client, accounts, owner, test_db):
    from backend.models.tenancy import Invite
    _set_seats(test_db, accounts, 2)
    invite_id = _invite(anonymous_client, accounts, owner).json()["invite"]["id"]
    anonymous_client.post(f"{_invites(accounts)}/{invite_id}/revoke", headers=owner)
    second = _invite(anonymous_client, accounts, owner, email="cal@acme.test").json()["invite"]["id"]
    invite = test_db.get(Invite, second)
    invite.expires_at = invite.expires_at - timedelta(days=8)
    test_db.commit()
    assert _invite(anonymous_client, accounts, owner, email="dee@acme.test").status_code == 201


def test_a_deactivated_member_frees_their_seat(anonymous_client, accounts, owner, team, test_db):
    from backend.models.tenancy import User
    _set_seats(test_db, accounts, 4)                     # owner + three members
    assert _invite(anonymous_client, accounts, owner).status_code == 409
    test_db.query(User).filter(User.email == "viewer@acme.test").one().is_active = False
    test_db.commit()
    assert _invite(anonymous_client, accounts, owner).status_code == 201


def test_a_suspended_firm_cant_invite_and_its_pending_invites_keep_their_seats(anonymous_client, accounts, owner,
                                                                             test_db):
    from backend.models.tenancy import Firm, Invite
    token = _invite(anonymous_client, accounts, owner).json()["invite_token"]
    test_db.get(Firm, accounts.firm_id).status = "SUSPENDED"
    test_db.commit()
    r = _invite(anonymous_client, accounts, owner, email="cal@acme.test")
    assert r.status_code == 403
    assert r.json() == {"detail": "This workspace is suspended."}
    test_db.expire_all()
    assert [i.status for i in test_db.query(Invite)] == ["PENDING"]
    assert anonymous_client.get(f"/api/invites/{token}").json()["status"] == "SUSPENDED"


# ── Lists, resend, revoke ────────────────────────────────────────────────────

def test_who_sees_the_invites(anonymous_client, accounts, owner, team):
    _invite(anonymous_client, accounts, owner)
    assert len(anonymous_client.get(_invites(accounts), headers=owner).json()) == 1
    assert len(anonymous_client.get(_invites(accounts), headers=team["MANAGER"]).json()) == 1   # read-only (Q15)
    assert anonymous_client.get(_invites(accounts), headers=team["BDE"]).status_code == 403
    assert anonymous_client.get(_invites(accounts), headers=team["VIEWER"]).status_code == 403


def test_every_member_sees_the_members(anonymous_client, accounts, team):
    for cookie in team.values():
        members = anonymous_client.get(f"/api/firms/{accounts.firm_id}/members", headers=cookie).json()
        assert {m["role"] for m in members} == {"OWNER", "MANAGER", "BDE", "VIEWER"}


def test_resend_and_revoke(anonymous_client, accounts, owner, team, test_db):
    body = _invite(anonymous_client, accounts, owner).json()
    url = f"{_invites(accounts)}/{body['invite']['id']}"
    assert anonymous_client.post(f"{url}/resend", headers=team["MANAGER"]).status_code == 403
    resent = anonymous_client.post(f"{url}/resend", headers=owner)
    assert resent.status_code == 200
    assert resent.json()["invite_token"] != body["invite_token"]
    assert anonymous_client.get(f"/api/invites/{body['invite_token']}").json() == {"status": "INVALID"}
    revoked = anonymous_client.post(f"{url}/revoke", headers=owner)
    assert revoked.json()["status"] == "REVOKED"


def test_the_owners_own_invite_is_the_super_admins(anonymous_client, accounts, owner, test_db):
    """A pending OWNER invite in the firm (made by the Super Admin) can't be resent or revoked from inside."""
    from backend.auth.invites import send_invite
    from backend.models.db import utcnow
    from backend.models.tenancy import Firm, Invite, PlatformUser
    invite, _ = send_invite(test_db, inviter=test_db.get(PlatformUser, accounts.admin_id),
                            firm=test_db.get(Firm, accounts.firm_id), email="new-owner@acme.test", role="OWNER",
                            invitee_name=None, summary="Invited new-owner@acme.test as OWNER", now=utcnow())
    test_db.commit()
    r = anonymous_client.post(f"{_invites(accounts)}/{invite.id}/revoke", headers=owner)
    assert r.status_code == 403
    assert test_db.get(Invite, invite.id).status == "PENDING"


def test_an_invite_of_another_firm_is_404(anonymous_client, accounts, owner, test_db):
    from backend.auth.invites import send_invite
    from backend.models.db import utcnow
    from backend.models.tenancy import Plan
    other = make_firm(test_db, test_db.get(Plan, accounts.plan_id), slug="globex")
    their_owner = make_user(test_db, other, email="o@globex.test")
    invite, _ = send_invite(test_db, inviter=their_owner, firm=other, email="x@globex.test", role="BDE",
                            invitee_name=None, summary="Invited x@globex.test as BDE", now=utcnow())
    test_db.commit()
    assert anonymous_client.post(f"{_invites(accounts)}/{invite.id}/revoke", headers=owner).status_code == 404


# ── The whole flow (07 Q38: today's goal) ────────────────────────────────────

def test_onboarding_end_to_end(test_db, accounts, api_client):
    """Super Admin creates a firm → the owner accepts and signs in → invites a MANAGER and a BDE → each accepts
    and signs in. Every step through the HTTP API, each person in their own browser."""
    from fastapi.testclient import TestClient
    from backend.main import app
    from backend.models.tenancy import LedgerEntry

    def browser():
        return TestClient(app)

    with browser() as admin:
        assert admin.post("/api/auth/sign-in",
                          json={"email": "admin@benchq.test", "password": TEST_PASSWORD}).status_code == 200
        created = admin.post("/api/admin/firms", json={
            "name": "Northwind Staffing", "slug": "northwind", "plan_id": str(accounts.plan_id),
            "owner_name": "Nora North", "owner_email": "nora@northwind.test"}).json()
    firm_id = created["firm"]["id"]
    assert created["firm"]["status"] == "ONBOARDING"

    with browser() as nora:
        assert nora.get(f"/api/invites/{created['invite_token']}").json()["status"] == "VALID"
        session = nora.post(f"/api/invites/{created['invite_token']}/accept",
                            json={"name": "Nora North", "password": "nora-pass-1"}).json()
        assert session["firm"]["status"] == "ACTIVE"
        assert nora.get("/api/firms/by-slug/northwind").json()["id"] == firm_id
        links = {}
        for email, role in (("mo@northwind.test", "MANAGER"), ("bo@northwind.test", "BDE")):
            r = nora.post(f"/api/firms/{firm_id}/invites", json={"email": email, "role": role})
            assert r.status_code == 201, r.text
            links[role] = r.json()["invite_token"]

    for role, token in links.items():
        with browser() as member:
            session = member.post(f"/api/invites/{token}/accept",
                                  json={"name": role.title(), "password": f"{role.lower()}-pass-1"}).json()
            assert session["principal"] == {**session["principal"], "kind": "firm", "firm_id": firm_id, "role": role}
            member.post("/api/auth/sign-out")
            email = f"{'mo' if role == 'MANAGER' else 'bo'}@northwind.test"
            assert member.post("/api/auth/sign-in",
                               json={"email": email, "password": f"{role.lower()}-pass-1"}).status_code == 200
            assert member.get("/api/auth/me").json()["firm"]["slug"] == "northwind"

    with browser() as nora:
        nora.post("/api/auth/sign-in", json={"email": "nora@northwind.test", "password": "nora-pass-1"})
        roles = sorted(m["role"] for m in nora.get(f"/api/firms/{firm_id}/members").json())
        assert roles == ["BDE", "MANAGER", "OWNER"]
        assert {i["status"] for i in nora.get(f"/api/firms/{firm_id}/invites").json()} == {"ACCEPTED"}

    actions = [e.action for e in test_db.query(LedgerEntry).filter(LedgerEntry.firm_id == firm_id)
               .order_by(LedgerEntry.created_at)]
    assert actions.count("INVITE_SENT") == 3 and actions.count("INVITE_ACCEPTED") == 3
    assert "FIRM_CREATED" in actions and "LOGIN" in actions
