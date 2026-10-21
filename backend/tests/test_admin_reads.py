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
    from backend.models.tenancy import LedgerEntry
    now = utcnow()
    for minutes, firm_id, action in [(2, accounts.firm_id, "LOGIN"), (1, None, "CREATE")]:
        test_db.add(LedgerEntry(firm_id=firm_id, actor_type="SYSTEM", actor_name="test", entity_type="firm",
                                entity_id="x", entity_label="x", action=action, summary=action,
                                created_at=now - timedelta(minutes=minutes)))
    test_db.commit()
    entries = api_client.get("/api/admin/audit").json()
    assert [(e["action"], e["firm_id"]) for e in entries[:2]] == [("CREATE", None), ("LOGIN", str(accounts.firm_id))]
    assert entries[0]["evidence_ids"] == [] and entries[0]["actor_user_id"] is None
    assert len(api_client.get("/api/admin/audit", params={"limit": 1}).json()) == 1


@pytest.mark.parametrize("path", ["/api/admin/users", "/api/admin/team", "/api/admin/audit"])
def test_only_a_super_admin_reads_them(anonymous_client, accounts, path):
    assert anonymous_client.get(path).status_code == 401
    assert anonymous_client.get(path, headers={"cookie": f"bq_session={accounts.firm_token}"}).status_code == 403
