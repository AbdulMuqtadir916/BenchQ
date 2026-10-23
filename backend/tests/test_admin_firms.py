"""The Super Admin's firms, plans and invites (backend/api/routes_admin.py), ported from src/mocks/platform.ts and
its tests, plus the Q38 rules: one transaction, the link shown once, "copy link" = resend."""
from datetime import timedelta
import pathlib
import re

import pytest

from backend.auth.invites import RESERVED_SLUGS
from backend.tests.auth_support import make_plan

ADMIN_FIRMS = "/api/admin/firms"


def _body(accounts, **over):
    body = {"name": "Northwind Staffing", "slug": "northwind", "plan_id": str(accounts.plan_id),
            "primary_timezone": "Asia/Kolkata", "client_timezone": "America/New_York", "contact_phone": " +91 98 ",
            "owner_name": " Nora North ", "owner_email": " Nora@Northwind.test "}
    return {**body, **over}


def _create(api_client, accounts, **over):
    return api_client.post(ADMIN_FIRMS, json=_body(accounts, **over))


# ── Create ───────────────────────────────────────────────────────────────────

def test_create_makes_an_onboarding_firm_with_the_plans_limits_and_an_owner_invite(api_client, accounts, test_db):
    from backend.models.tenancy import Firm, Invite
    r = _create(api_client, accounts)
    assert r.status_code == 201, r.text
    body = r.json()
    firm = body["firm"]
    assert firm["status"] == "ONBOARDING"
    assert (firm["seat_limit"], firm["candidate_limit"]) == (10, 100)       # copied from the plan (A3)
    assert firm["contact_phone"] == "+91 98"
    invite = body["invite"]
    assert invite["role"] == "OWNER"
    assert invite["email"] == "nora@northwind.test"
    assert invite["invitee_name"] == "Nora North"
    assert invite["invited_by_user_id"] == str(accounts.admin_id)
    assert invite["status"] == "PENDING"
    assert re.fullmatch(r"[A-Za-z0-9_-]{43}", body["invite_token"])
    stored = test_db.get(Invite, invite["id"])
    assert stored.token_hash != body["invite_token"]                       # only the hash is kept
    assert test_db.get(Firm, firm["id"]).slug == "northwind"


def test_create_logs_firm_created_and_invite_sent_in_the_firms_ledger(api_client, accounts, test_db):
    from backend.models.tenancy import LedgerEntry
    firm_id = _create(api_client, accounts).json()["firm"]["id"]
    entries = {e.action: e for e in test_db.query(LedgerEntry).filter(LedgerEntry.firm_id == firm_id)}
    assert set(entries) == {"FIRM_CREATED", "INVITE_SENT"}
    assert entries["FIRM_CREATED"].summary == "Created firm on Test plan (10 seats, 100 candidates)"
    assert entries["INVITE_SENT"].summary == "Invited Nora North (nora@northwind.test) as OWNER"
    assert all(e.actor_type == "PLATFORM_ADMIN" and e.actor_user_id == accounts.admin_id for e in entries.values())


@pytest.mark.parametrize("over,message", [
    ({"name": "  "}, "Enter the firm's name."),
    ({"owner_name": ""}, "Enter the owner's name."),
    ({"slug": "ab"}, "Use 3–32 characters."),
    ({"slug": "Northwind"}, "Use only lowercase letters, digits and hyphens."),
    ({"slug": "1north"}, "Start with a letter."),
    ({"slug": "north-"}, "Don't end with a hyphen."),
    ({"slug": "nor--th"}, "Don't use two hyphens in a row."),
    ({"slug": "admin"}, "This word is reserved by BenchQ."),
    ({"slug": "acme"}, "Another firm already uses this slug."),
    ({"owner_email": "not-an-email"}, "Enter a valid email address."),
    ({"primary_timezone": "Mars/Olympus"}, "Unknown timezone: Mars/Olympus"),
])
def test_create_refuses_bad_input_with_the_mocks_messages(api_client, accounts, over, message):
    r = _create(api_client, accounts, **over)
    assert r.status_code == 400
    assert r.json() == {"detail": message}


def test_create_refuses_a_hidden_plan(api_client, accounts, test_db):
    hidden = make_plan(test_db, name="Legacy")
    hidden.is_active = False
    test_db.commit()
    r = _create(api_client, accounts, plan_id=str(hidden.id))
    assert r.status_code == 400
    assert r.json() == {"detail": "That plan isn't offered to new firms."}


def test_create_refuses_an_unknown_plan(api_client, accounts):
    assert _create(api_client, accounts, plan_id="00000000-0000-4000-8000-00000000ffff").status_code == 404


@pytest.mark.parametrize("email", ["owner@acme.test", "admin@benchq.test", "OWNER@acme.test"])
def test_create_refuses_an_email_that_already_has_an_account(api_client, accounts, test_db, email):
    from backend.models.tenancy import Firm
    r = _create(api_client, accounts, owner_email=email)
    assert r.status_code == 409
    assert r.json() == {"detail": "Someone with this email already has an account or a pending invite."}
    assert test_db.query(Firm).filter(Firm.slug == "northwind").count() == 0     # nothing half-made


def test_create_refuses_an_email_with_a_pending_invite(api_client, accounts):
    assert _create(api_client, accounts).status_code == 201
    r = _create(api_client, accounts, slug="southwind")
    assert r.status_code == 409


def test_an_expired_invite_does_not_hold_the_email(api_client, accounts, test_db):
    from backend.models.tenancy import Invite
    invite_id = _create(api_client, accounts).json()["invite"]["id"]
    invite = test_db.get(Invite, invite_id)
    invite.expires_at = invite.expires_at - timedelta(days=8)
    test_db.commit()
    assert _create(api_client, accounts, slug="southwind").status_code == 201
    test_db.refresh(invite)
    assert invite.status == "EXPIRED"


def test_only_a_super_admin_creates_firms(anonymous_client, accounts):
    r = anonymous_client.post(ADMIN_FIRMS, json=_body(accounts), headers={"cookie": f"bq_session={accounts.firm_token}"})
    assert r.status_code == 403


def test_the_reserved_slugs_match_the_frontends():
    ts = pathlib.Path(__file__).parents[2] / "src" / "lib" / "schemas" / "tenancy.ts"
    if not ts.exists():
        pytest.skip("the frontend isn't in this checkout (the backend container)")
    block = re.search(r"RESERVED_SLUGS = \[(.*?)\] as const", ts.read_text(), re.S).group(1)
    assert tuple(re.findall(r'"([^"]+)"', block)) == RESERVED_SLUGS


# ── Reads ────────────────────────────────────────────────────────────────────

def test_lists(api_client, accounts):
    _create(api_client, accounts)
    assert [p["name"] for p in api_client.get("/api/admin/plans").json()] == ["Test plan"]
    firms = api_client.get(ADMIN_FIRMS).json()
    assert [f["slug"] for f in firms] == ["acme", "northwind"]
    northwind = firms[1]["id"]
    assert api_client.get(f"{ADMIN_FIRMS}/{northwind}").json()["name"] == "Northwind Staffing"
    assert len(api_client.get("/api/admin/invites").json()) == 1
    assert len(api_client.get("/api/admin/invites", params={"firm_id": str(accounts.firm_id)}).json()) == 0


def test_an_unknown_firm_is_404(api_client, accounts):
    assert api_client.get(f"{ADMIN_FIRMS}/00000000-0000-4000-8000-00000000ffff").status_code == 404


# ── Resend, revoke ───────────────────────────────────────────────────────────

def _invite(api_client, accounts):
    body = _create(api_client, accounts).json()
    return body["invite"]["id"], body["invite_token"]


def test_resend_issues_a_new_link_and_the_old_one_stops_working(api_client, anonymous_client, accounts, test_db):
    from backend.models.tenancy import LedgerEntry
    invite_id, old = _invite(api_client, accounts)
    r = api_client.post(f"/api/admin/invites/{invite_id}/resend")
    assert r.status_code == 200
    new = r.json()["invite_token"]
    assert new != old
    assert anonymous_client.get(f"/api/invites/{old}").json() == {"status": "INVALID"}
    assert anonymous_client.get(f"/api/invites/{new}").json()["status"] == "VALID"
    summaries = [e.summary for e in test_db.query(LedgerEntry).filter(LedgerEntry.action == "INVITE_SENT")]
    assert "Invite resent to nora@northwind.test" in summaries


def test_resend_revives_an_expired_invite_for_seven_more_days(api_client, accounts, test_db):
    from backend.models.db import utcnow
    from backend.models.tenancy import Invite
    invite_id, _ = _invite(api_client, accounts)
    invite = test_db.get(Invite, invite_id)
    invite.expires_at = utcnow() - timedelta(hours=1)
    test_db.commit()
    assert api_client.get("/api/admin/invites").json()[0]["status"] == "EXPIRED"
    body = api_client.post(f"/api/admin/invites/{invite_id}/resend").json()["invite"]
    assert body["status"] == "PENDING"
    test_db.refresh(invite)
    assert invite.expires_at > utcnow() + timedelta(days=6, hours=23)


def test_resending_an_expired_invite_needs_a_free_seat(api_client, accounts, test_db):
    from backend.models.db import utcnow
    from backend.models.tenancy import Firm, Invite, User
    from backend.tests.auth_support import password_hash
    invite_id, _ = _invite(api_client, accounts)
    invite = test_db.get(Invite, invite_id)
    invite.expires_at = utcnow() - timedelta(hours=1)
    firm = test_db.get(Firm, invite.firm_id)
    firm.seat_limit = 1
    test_db.add(User(firm_id=firm.id, role="MANAGER", name="M", email="m@northwind.test", password_hash=password_hash()))
    test_db.commit()
    r = api_client.post(f"/api/admin/invites/{invite_id}/resend")
    assert r.status_code == 409
    assert r.json() == {"detail": "Your plan allows 1 seat; 1 is in use."}


def test_revoke_kills_the_link_and_logs_it(api_client, anonymous_client, accounts, test_db):
    from backend.models.tenancy import LedgerEntry
    invite_id, token = _invite(api_client, accounts)
    r = api_client.post(f"/api/admin/invites/{invite_id}/revoke")
    assert r.status_code == 200
    assert r.json()["status"] == "REVOKED"
    assert anonymous_client.get(f"/api/invites/{token}").json()["status"] == "REVOKED"
    assert test_db.query(LedgerEntry).filter(LedgerEntry.action == "INVITE_REVOKED").count() == 1
    # Neither a revoked invite can be revoked again nor resent.
    assert api_client.post(f"/api/admin/invites/{invite_id}/revoke").status_code == 409
    assert api_client.post(f"/api/admin/invites/{invite_id}/resend").status_code == 409


def test_a_revoked_invite_frees_the_email(api_client, accounts):
    invite_id, _ = _invite(api_client, accounts)
    api_client.post(f"/api/admin/invites/{invite_id}/revoke")
    assert _create(api_client, accounts, slug="southwind").status_code == 201


def test_an_unknown_invite_is_404(api_client, accounts):
    assert api_client.post("/api/admin/invites/00000000-0000-4000-8000-00000000ffff/resend").status_code == 404
