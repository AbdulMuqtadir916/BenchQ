"""The Super Admin's read-only lists the /admin screens need beside firms and invites: firm users, the platform team
and the audit log (backend/api/routes_admin.py; the spec is src/mocks/platform.ts)."""
from datetime import timedelta

import pytest

from backend.tests.auth_support import make_firm, make_plan, make_user


def test_users_lists_every_firm_user_or_one_firms(api_client, accounts, test_db):
    other = make_firm(test_db, make_plan(test_db, name="Other"), slug="globex")
    make_user(test_db, other, email="bde@globex.test", role="BDE", name="Gary Globex")
    test_db.commit()
    everyone = api_client.get("/api/admin/users").json()
    assert {u["email"] for u in everyone} == {"owner@acme.test", "bde@globex.test"}
    acme = api_client.get("/api/admin/users", params={"firm_id": str(accounts.firm_id)}).json()
    assert [(u["email"], u["role"], u["firm_id"]) for u in acme] == [("owner@acme.test", "OWNER", str(accounts.firm_id))]


def test_team_lists_the_super_admins(api_client, accounts):
    team = api_client.get("/api/admin/team").json()
    assert [(a["id"], a["role"], a["is_active"]) for a in team] == [(str(accounts.admin_id), "PLATFORM_ADMIN", True)]


def test_audit_lists_platform_and_firm_entries_newest_first(api_client, accounts, test_db):
    from backend.models.db import utcnow
    from backend.models.tenancy import ActivityEntry
    now = utcnow()
    for minutes, firm_id, action in [(2, accounts.firm_id, "LOGIN"), (1, None, "CREATE")]:
        test_db.add(ActivityEntry(firm_id=firm_id, actor_type="SYSTEM", actor_name="test", entity_type="firm",
                                entity_id="x", entity_label="x", action=action, summary=action,
                                created_at=now - timedelta(minutes=minutes)))
    test_db.commit()
    entries = api_client.get("/api/admin/audit").json()
    assert [(e["action"], e["firm_id"]) for e in entries[:2]] == [("CREATE", None), ("LOGIN", str(accounts.firm_id))]
    assert "claim_state" not in entries[0] and entries[0]["actor_user_id"] is None


def _audit_row(test_db, created_at, firm_id=None, actor_type="USER", action="UPDATE", summary="row"):
    from backend.models.tenancy import ActivityEntry
    test_db.add(ActivityEntry(firm_id=firm_id, actor_type=actor_type, actor_name="test", entity_type="firm", entity_id="x",
                              entity_label="x", action=action, summary=summary, created_at=created_at))


def test_background_rows_never_push_a_firms_numbers_out_of_the_audit(api_client, accounts, test_db):
    """The Firms page's Last activity, plan history and open support views come from this list."""
    from backend.models.db import utcnow
    now = utcnow()
    _audit_row(test_db, now - timedelta(days=30), accounts.firm_id, summary="Latest in this firm")
    _audit_row(test_db, now - timedelta(days=60), accounts.firm_id, action="PLAN_CHANGED", summary="Old plan change")
    _audit_row(test_db, now - timedelta(days=60), accounts.firm_id, action="ADMIN_ACCESS", summary="Old support view")
    for minutes in range(120):
        _audit_row(test_db, now - timedelta(minutes=minutes), actor_type="SYSTEM", action="CREATE", summary="Background")
    _audit_row(test_db, now - timedelta(minutes=1), actor_type="PLATFORM_ADMIN", action="LOGIN", summary="Newest")
    test_db.commit()
    entries = api_client.get("/api/admin/audit", params={"limit": 1}).json()
    summaries = [e["summary"] for e in entries]
    assert summaries.count("Background") == 100
    assert {"Newest", "Latest in this firm", "Old plan change", "Old support view"} <= set(summaries)
    assert [e["created_at"] for e in entries] == sorted((e["created_at"] for e in entries), reverse=True)


@pytest.mark.parametrize("path", ["/api/admin/users", "/api/admin/team", "/api/admin/audit"])
def test_only_a_super_admin_reads_them(anonymous_client, accounts, path):
    assert anonymous_client.get(path).status_code == 401
    assert anonymous_client.get(path, headers={"cookie": f"bq_session={accounts.firm_token}"}).status_code == 403
