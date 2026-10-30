"""/invite/[token] on the backend (backend/api/routes_invites.py), ported from src/mocks/invite-flow.ts,
src/mocks/invites.ts and their tests: every link state, and accepting creates the account and signs it in."""
from datetime import timedelta

import pytest

GOOD = {"name": "Nora North", "password": "a-strong-pass"}


@pytest.fixture
def owner_invite(api_client, accounts):
    """A new firm's OWNER invite, created through the Super Admin's endpoint: (firm id, invite id, token)."""
    body = api_client.post("/api/admin/firms", json={
        "name": "Northwind Staffing", "slug": "northwind", "plan_id": str(accounts.plan_id),
        "owner_name": "Nora", "owner_email": "nora@northwind.test"}).json()
    return body["firm"]["id"], body["invite"]["id"], body["invite_token"]


def _accept(client, token, **body):
    return client.post(f"/api/invites/{token}/accept", json={**GOOD, **body})


# ── Lookup ───────────────────────────────────────────────────────────────────

def test_lookup_of_a_valid_link(anonymous_client, owner_invite):
    _, _, token = owner_invite
    body = anonymous_client.get(f"/api/invites/{token}").json()
    assert body["status"] == "VALID"
    assert body["firm_name"] == "Northwind Staffing"
    assert body["email"] == "nora@northwind.test"
    assert body["invitee_name"] == "Nora"
    assert body["role"] == "OWNER"


def test_an_unknown_link_shows_nothing(anonymous_client, accounts):
    assert anonymous_client.get("/api/invites/not-a-token").json() == {"status": "INVALID"}


def test_lookup_of_an_expired_link(anonymous_client, owner_invite, test_db):
    from backend.models.tenancy import Invite
    _, invite_id, token = owner_invite
    invite = test_db.get(Invite, invite_id)
    invite.expires_at = invite.expires_at - timedelta(days=8)
    test_db.commit()
    assert anonymous_client.get(f"/api/invites/{token}").json()["status"] == "EXPIRED"


def test_lookup_of_a_suspended_firms_link(anonymous_client, owner_invite, test_db):
    from backend.models.tenancy import Firm
    firm_id, _, token = owner_invite
    test_db.get(Firm, firm_id).status = "SUSPENDED"
    test_db.commit()
    assert anonymous_client.get(f"/api/invites/{token}").json()["status"] == "SUSPENDED"


# ── Accept ───────────────────────────────────────────────────────────────────

def test_the_owner_accepts_and_the_firm_becomes_active(anonymous_client, owner_invite, test_db):
    from backend.models.tenancy import Firm, Invite, LedgerEntry, User
    firm_id, invite_id, token = owner_invite
    r = _accept(anonymous_client, token)
    assert r.status_code == 200, r.text
    session = r.json()
    assert session["principal"]["kind"] == "firm"
    assert session["principal"]["role"] == "OWNER"
    assert session["user"]["name"] == "Nora North"                     # the name they typed wins (Q31)
    assert session["user"]["last_active_at"] is None                    # first run lands on /welcome
    assert session["firm"]["status"] == "ACTIVE"
    assert test_db.get(Firm, firm_id).status == "ACTIVE"
    invite = test_db.get(Invite, invite_id)
    assert invite.status == "ACCEPTED" and invite.accepted_at is not None
    entry = test_db.query(LedgerEntry).filter(LedgerEntry.action == "INVITE_ACCEPTED").one()
    assert entry.summary == "Nora North accepted the OWNER invite; firm is now active"
    assert entry.firm_id is not None and entry.actor_type == "USER"
    # Signed in: the cookie works, and the password works for the next sign-in.
    assert anonymous_client.get("/api/auth/me").json()["user"]["email"] == "nora@northwind.test"
    user = test_db.query(User).filter(User.email == "nora@northwind.test").one()
    assert user.password_hash.startswith("$argon2id$")


def test_the_new_owner_can_sign_in_with_the_chosen_password(anonymous_client, owner_invite):
    _, _, token = owner_invite
    _accept(anonymous_client, token)
    anonymous_client.post("/api/auth/sign-out")
    r = anonymous_client.post("/api/auth/sign-in", json={"email": "nora@northwind.test", "password": "a-strong-pass"})
    assert r.status_code == 200


def test_a_link_works_once(anonymous_client, owner_invite):
    _, _, token = owner_invite
    assert _accept(anonymous_client, token).status_code == 200
    r = _accept(anonymous_client, token)
    assert r.status_code == 410
    assert r.json() == {"detail": "This invite is no longer valid. This invite has already been accepted."}
    assert anonymous_client.get(f"/api/invites/{token}").json()["status"] == "ACCEPTED"


@pytest.mark.parametrize("body,message", [
    ({"name": "  "}, "Enter your name."),
    ({"password": "short"}, "Use at least 8 characters for your password."),
])
def test_accept_checks_the_form(anonymous_client, owner_invite, body, message):
    _, _, token = owner_invite
    r = _accept(anonymous_client, token, **body)
    assert r.status_code == 400
    assert r.json() == {"detail": message}


def test_accept_of_an_unknown_link_is_410(anonymous_client, accounts):
    r = _accept(anonymous_client, "not-a-token")
    assert r.status_code == 410
    assert r.json() == {"detail": "This invite link isn't valid."}


def test_too_many_accepts_from_one_address_are_429(anonymous_client, owner_invite):
    from backend.auth.throttle import INVITE_ACCEPT_LIMIT
    _, _, token = owner_invite
    ip = {"X-Forwarded-For": "10.0.3.1"}
    for _ in range(INVITE_ACCEPT_LIMIT[0]):
        assert anonymous_client.post("/api/invites/not-a-token/accept", json=GOOD, headers=ip).status_code == 410
    r = anonymous_client.post(f"/api/invites/{token}/accept", json=GOOD, headers=ip)
    assert r.status_code == 429
    assert int(r.headers["Retry-After"]) >= 1
    assert r.json() == {"detail": "Too many attempts. Try again in a few minutes."}
    # Another address is unaffected, and the invite is still there to accept.
    assert anonymous_client.post(f"/api/invites/{token}/accept", json=GOOD,
                                 headers={"X-Forwarded-For": "10.0.3.2"}).status_code == 200


def test_the_accept_lock_expires(anonymous_client, accounts, monkeypatch):
    import backend.auth.throttle as throttle_mod
    for _ in range(throttle_mod.INVITE_ACCEPT_LIMIT[0]):
        _accept(anonymous_client, "not-a-token")
    assert _accept(anonymous_client, "not-a-token").status_code == 429
    real = throttle_mod.time.monotonic
    monkeypatch.setattr(throttle_mod.time, "monotonic", lambda: real() + throttle_mod.INVITE_ACCEPT_LIMIT[1] + 1)
    assert _accept(anonymous_client, "not-a-token").status_code == 410


def test_accept_of_a_revoked_or_expired_link_is_410(api_client, anonymous_client, owner_invite, test_db):
    from backend.models.tenancy import Invite
    _, invite_id, token = owner_invite
    invite = test_db.get(Invite, invite_id)
    invite.expires_at = invite.expires_at - timedelta(days=8)
    test_db.commit()
    assert _accept(anonymous_client, token).json() == {"detail": "This invite is no longer valid. This invite has expired."}


def test_a_suspended_firms_invite_is_refused_and_stays_pending(anonymous_client, owner_invite, test_db):
    from backend.models.tenancy import Firm, Invite
    firm_id, invite_id, token = owner_invite
    test_db.get(Firm, firm_id).status = "SUSPENDED"
    test_db.commit()
    r = _accept(anonymous_client, token)
    assert r.status_code == 403
    assert r.json() == {"detail": "Workspace suspended. This invite can't be accepted right now."}
    test_db.expire_all()
    assert test_db.get(Invite, invite_id).status == "PENDING"


def test_accept_refuses_an_email_that_got_an_account_meanwhile(anonymous_client, owner_invite, test_db):
    from backend.tests.auth_support import make_admin
    _, _, token = owner_invite
    make_admin(test_db, email="nora@northwind.test")
    test_db.commit()
    r = _accept(anonymous_client, token)
    assert r.status_code == 409


def test_accepting_replaces_this_browsers_session(anonymous_client, owner_invite, accounts):
    _, _, token = owner_invite
    anonymous_client.post("/api/auth/sign-in", json={"email": "admin@benchq.test", "password": "correct-horse-battery"})
    assert anonymous_client.get("/api/auth/me").json()["principal"]["kind"] == "platform"
    _accept(anonymous_client, token)
    assert anonymous_client.get("/api/auth/me").json()["principal"]["kind"] == "firm"


def test_a_member_invite_into_an_active_firm_keeps_the_firm_as_it_is(anonymous_client, accounts, test_db):
    """The OWNER's member invites arrive in PR 5; the accept side already handles them."""
    from backend.auth.invites import send_invite
    from backend.models.db import utcnow
    from backend.models.tenancy import Firm, User
    owner = test_db.get(User, accounts.user_id)
    _, token = send_invite(test_db, inviter=owner, firm=test_db.get(Firm, accounts.firm_id), email="bea@acme.test",
                           role="BDE", invitee_name=None, summary="Invited bea@acme.test as BDE", now=utcnow())
    test_db.commit()
    session = _accept(anonymous_client, token, name="Bea").json()
    assert session["principal"]["role"] == "BDE"
    assert session["firm"]["id"] == str(accounts.firm_id)
    assert session["firm"]["status"] == "ACTIVE"


def test_a_platform_team_invite_creates_a_super_admin(anonymous_client, accounts, test_db):
    from backend.auth.invites import send_invite
    from backend.models.db import utcnow
    from backend.models.tenancy import LedgerEntry, PlatformUser
    admin = test_db.get(PlatformUser, accounts.admin_id)
    _, token = send_invite(test_db, inviter=admin, firm=None, email="pat@benchq.test", role="PLATFORM_ADMIN",
                           invitee_name=None, summary="Invited pat@benchq.test to the platform team", now=utcnow())
    test_db.commit()
    assert anonymous_client.get(f"/api/invites/{token}").json()["firm_name"] is None
    session = _accept(anonymous_client, token, name="Pat").json()
    assert session["principal"]["kind"] == "platform"
    entry = test_db.query(LedgerEntry).filter(LedgerEntry.action == "INVITE_ACCEPTED").one()
    assert entry.firm_id is None and entry.summary == "Pat joined the platform team"


# ── A firm by its slug ───────────────────────────────────────────────────────

def test_a_firm_user_opens_only_their_own_firm_by_slug(anonymous_client, owner_invite, accounts):
    cookie = {"cookie": f"bq_session={accounts.firm_token}"}
    assert anonymous_client.get("/api/firms/by-slug/acme", headers=cookie).json()["id"] == str(accounts.firm_id)
    other = anonymous_client.get("/api/firms/by-slug/northwind", headers=cookie)
    unknown = anonymous_client.get("/api/firms/by-slug/nowhere", headers=cookie)
    assert other.status_code == unknown.status_code == 404
    assert other.json() == unknown.json()                               # never confirms a firm exists


def test_a_super_admin_opens_any_firm_by_slug(anonymous_client, owner_invite, accounts):
    cookie = {"cookie": f"bq_session={accounts.admin_token}"}
    assert anonymous_client.get("/api/firms/by-slug/northwind", headers=cookie).json()["name"] == "Northwind Staffing"
    assert anonymous_client.get("/api/firms/by-slug/nowhere", headers=cookie).status_code == 404
