"""Activity logs: a Super Admin's own operations (settings, companies, searches, scrapes, backups, Telegram and LinkedIn
controls) are entries with no firm and the Super Admin as the actor. Which routes carry the dependency is checked by
test_ledger_rules.py; this file checks what the dependency writes."""
import uuid

from fastapi import Depends, FastAPI, HTTPException
from fastapi.testclient import TestClient

from backend.api.routes_auth import current_principal
from backend.auth.passwords import hash_password
from backend.auth.platform_actions import logs_platform_action
from backend.auth.sessions import Principal
from backend.models.tenancy import ActivityEntry, PlatformUser


def _platform_entries(test_db):
    test_db.expire_all()
    return test_db.query(ActivityEntry).filter(ActivityEntry.actor_type == "PLATFORM_ADMIN", ActivityEntry.firm_id.is_(None),
                                               ActivityEntry.action != "LOGIN").order_by(ActivityEntry.created_at).all()


def test_the_dependency_writes_one_entry_on_success_and_none_on_failure(test_db):
    admin = PlatformUser(email="op@admin.test", name="Sana", password_hash=hash_password("A-long-test-password-2026"))
    test_db.add(admin)
    test_db.commit()
    app = FastAPI()

    @app.post("/ok/{thing_id}", dependencies=[Depends(logs_platform_action("Changed a thing", entity_type="thing",
                                                                           action="UPDATE", id_param="thing_id", fields=True))])
    def ok(thing_id: str, body: dict):
        return {}

    @app.post("/bad", dependencies=[Depends(logs_platform_action("Did a bad thing", entity_type="thing"))])
    def bad():
        raise HTTPException(status_code=400, detail="No.")

    app.dependency_overrides[current_principal] = lambda: Principal(
        kind="platform", user_id=admin.id, session_id=uuid.uuid4(), role="PLATFORM_ADMIN")
    client = TestClient(app)
    assert client.post("/bad").status_code == 400
    assert _platform_entries(test_db) == []                                    # a failed route writes nothing
    assert client.post("/ok/abc-123", json={"api_key": "SECRET-VALUE-9", "name": "x"}).status_code == 200
    (entry,) = _platform_entries(test_db)
    assert (entry.actor_type, entry.actor_user_id, entry.actor_name, entry.firm_id) == ("PLATFORM_ADMIN", admin.id, "Sana", None)
    assert (entry.action, entry.entity_type, entry.entity_id, entry.candidate_id) == ("UPDATE", "thing", "abc-123", None)
    assert entry.summary == "Changed a thing (abc-123): api_key, name."          # the names, never the values
    assert "SECRET-VALUE-9" not in entry.summary and "SECRET-VALUE-9" not in (entry.changes or "")


def test_a_settings_change_is_an_entry_with_the_field_names_only(api_client, test_db):
    assert api_client.patch("/api/settings", json={"scrape_interval_minutes": "17"}).status_code == 200
    (entry,) = _platform_entries(test_db)
    assert (entry.action, entry.entity_type, entry.actor_type, entry.firm_id) == ("UPDATE", "setting", "PLATFORM_ADMIN", None)
    assert entry.summary == "Changed settings: scrape_interval_minutes." and "17" not in entry.summary


def test_a_company_is_created_changed_and_deleted_and_a_missing_one_writes_nothing(api_client, test_db):
    created = api_client.post("/api/companies", json={"name": "Entry Corp"})
    assert created.status_code == 200, created.text
    company_id = created.json()["id"]
    assert api_client.patch(f"/api/companies/{company_id}", json={"name": "Entry Corp Two"}).status_code == 200
    assert api_client.delete(f"/api/companies/{company_id}").status_code == 200
    assert api_client.patch(f"/api/companies/{uuid.uuid4()}", json={"name": "Nobody"}).status_code == 404
    entries = _platform_entries(test_db)
    assert [(e.action, e.entity_type) for e in entries] == [("CREATE", "company"), ("UPDATE", "company"), ("DELETE", "company")]
    assert entries[1].summary == f"Changed a company ({company_id}): name." and entries[2].entity_id == company_id


def test_the_super_admin_sees_them_and_no_firm_reader_does(api_client, test_db, accounts):
    assert api_client.patch("/api/settings", json={"scrape_interval_minutes": "19"}).status_code == 200
    seen = api_client.get("/api/admin/activity", params={"limit": 50}).json()
    assert "Changed settings: scrape_interval_minutes." in [row["summary"] for row in seen]
    firm_rows = api_client.get(f"/api/firms/{accounts.firm_id}/ledger", params={"limit": 200}).json()
    assert "Changed settings: scrape_interval_minutes." not in [row["summary"] for row in firm_rows]
