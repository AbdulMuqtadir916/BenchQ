"""Activity Log PR 6: sign-out, failed sign-ins and lockouts, and the Super Admin's own view of the log."""
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from backend.auth import throttle
from backend.auth.passwords import hash_password
from backend.models.tenancy import ActivityEntry, Firm, PlatformUser, User
from backend.tests.auth_support import TEST_PASSWORD, make_firm, make_plan, make_user
from backend.tests.resume_support import make_version

PASSWORD = "A-long-test-password-2026"


def _failed(test_db):
    test_db.expire_all()
    return test_db.query(ActivityEntry).filter(ActivityEntry.action == "SIGN_IN_FAILED").all()


def _sign_in(client, email, password="wrong-password-here"):
    return client.post("/api/auth/sign-in", json={"email": email, "password": password})


@pytest.fixture(autouse=True)
def clean_throttle():
    throttle._hits.clear()
    yield
    throttle._hits.clear()


@pytest.fixture
def people(test_db, accounts):
    firm = test_db.get(Firm, accounts.firm_id)
    bde = make_user(test_db, firm, email="bea@acme.test", role="BDE", name="Bea")
    admin = PlatformUser(email="sana@admin.test", name="Sana", password_hash=hash_password(PASSWORD))
    test_db.add(admin)
    test_db.commit()
    return firm, bde, admin


def _as_admin(client):
    assert _sign_in(client, "sana@admin.test", PASSWORD).status_code == 200
    return client


def test_a_wrong_password_writes_an_entry_on_the_account(anonymous_client, test_db, people):
    firm, bde, _ = people
    assert _sign_in(anonymous_client, bde.email).status_code == 401
    entry = _failed(test_db)[0]
    assert (entry.actor_user_id, entry.actor_name, entry.actor_role, entry.firm_id) == (bde.id, "Bea", "BDE", firm.id)
    assert entry.summary == "Wrong password"
    assert entry.ip_address and entry.attempt_count == 1


def test_an_unknown_email_is_masked_and_belongs_to_no_firm(anonymous_client, test_db):
    assert _sign_in(anonymous_client, "nobody@example.test").status_code == 401
    entry = _failed(test_db)[0]
    assert (entry.actor_type, entry.actor_name, entry.actor_user_id, entry.firm_id) == ("UNKNOWN", "Unknown account", None, None)
    assert entry.summary == "no***@example.test, no such account"
    assert "nobody" not in f"{entry.summary} {entry.entity_label}"


def test_a_deactivated_account_gets_the_same_answer_and_its_own_reason(anonymous_client, test_db, people):
    _, bde, _ = people
    wrong = _sign_in(anonymous_client, "nobody@example.test")
    bde.is_active = False
    test_db.commit()
    refused = _sign_in(anonymous_client, bde.email, TEST_PASSWORD)
    assert (refused.status_code, refused.json()) == (wrong.status_code, wrong.json())
    assert "Account deactivated" in {e.summary for e in _failed(test_db)}


def test_tries_within_ten_seconds_from_one_ip_share_a_row(anonymous_client, test_db, people):
    _, bde, _ = people
    for _ in range(3):
        _sign_in(anonymous_client, bde.email)
    rows = _failed(test_db)
    assert [row.attempt_count for row in rows] == [3]


def test_a_try_after_ten_seconds_starts_a_new_row(anonymous_client, test_db, people):
    _, bde, _ = people
    _sign_in(anonymous_client, bde.email)
    test_db.execute(text("ALTER TABLE activity_logs DISABLE TRIGGER activity_logs_append_only"))
    test_db.execute(text("UPDATE activity_logs SET created_at = created_at - interval '11 seconds'"))
    test_db.execute(text("ALTER TABLE activity_logs ENABLE TRIGGER activity_logs_append_only"))
    test_db.commit()
    _sign_in(anonymous_client, bde.email)
    assert sorted(row.attempt_count for row in _failed(test_db)) == [1, 1]


def test_another_account_or_ip_gets_its_own_row(anonymous_client, test_db, people, monkeypatch):
    _, bde, _ = people
    _sign_in(anonymous_client, bde.email)
    _sign_in(anonymous_client, "nobody@example.test")
    monkeypatch.setattr(throttle, "client_ip", lambda request: "203.0.113.9")
    _sign_in(anonymous_client, bde.email)
    assert len(_failed(test_db)) == 3


def test_the_fifth_try_writes_one_lockout(anonymous_client, test_db, people):
    _, bde, _ = people
    for _ in range(6):
        _sign_in(anonymous_client, bde.email)
    test_db.expire_all()
    locked = test_db.query(ActivityEntry).filter(ActivityEntry.action == "LOCKED_OUT").all()
    assert [e.summary for e in locked] == ["Locked for 15 minutes after 5 tries"]
    assert locked[0].actor_user_id == bde.id and locked[0].ip_address


def test_the_row_can_only_gain_a_try(test_db, anonymous_client, people):
    _, bde, _ = people
    _sign_in(anonymous_client, bde.email)
    entry_id = _failed(test_db)[0].id
    for change in ("summary = 'Edited'", "attempt_count = 9", "ip_address = '1.1.1.1', attempt_count = attempt_count + 1"):
        with pytest.raises(DBAPIError, match="append-only"):
            test_db.execute(text(f"UPDATE activity_logs SET {change} WHERE id = :id"), {"id": entry_id})
        test_db.rollback()
    with pytest.raises(DBAPIError, match="append-only"):
        test_db.execute(text("DELETE FROM activity_logs WHERE id = :id"), {"id": entry_id})
    test_db.rollback()


def test_signing_out_is_logged_for_the_person_and_for_a_super_admin(anonymous_client, test_db, people):
    firm, bde, admin = people
    _sign_in(anonymous_client, bde.email, TEST_PASSWORD)
    anonymous_client.post("/api/auth/sign-out")
    _as_admin(anonymous_client)
    anonymous_client.post("/api/auth/sign-out")
    test_db.expire_all()
    rows = test_db.query(ActivityEntry).filter(ActivityEntry.action == "LOGOUT").order_by(ActivityEntry.created_at).all()
    assert [(e.summary, e.firm_id) for e in rows] == [("Bea signed out", firm.id), ("Sana signed out", None)]


def test_signing_out_with_no_session_logs_nothing(anonymous_client, test_db):
    assert anonymous_client.post("/api/auth/sign-out").status_code == 204
    assert test_db.query(ActivityEntry).filter(ActivityEntry.action == "LOGOUT").count() == 0


def test_no_firm_reader_gets_a_failed_sign_in(anonymous_client, api_client, test_db, accounts, people):
    owner = test_db.get(User, accounts.user_id)
    _sign_in(anonymous_client, owner.email)
    for _ in range(5):
        _sign_in(anonymous_client, "nobody@example.test")
    url = f"/api/firms/{accounts.firm_id}/ledger"
    assert {e["action"] for e in api_client.get(url).json()} & {"SIGN_IN_FAILED", "LOCKED_OUT"} == set()
    assert api_client.get(url, params={"action": "SIGN_IN_FAILED"}).json() == []
    assert api_client.get(f"{url}/days", params={"action": "SIGN_IN_FAILED"}).json() == []
    assert api_client.get(f"{url}/people", params={"action": "SIGN_IN_FAILED"}).json()["total"] == 0


def test_a_firm_reader_cant_reach_the_super_admins_log(anonymous_client, test_db, people):
    _, bde, _ = people
    assert _sign_in(anonymous_client, bde.email, TEST_PASSWORD).status_code == 200
    assert anonymous_client.get("/api/admin/activity").status_code in (403, 404)
    assert anonymous_client.get(f"/api/admin/activity/{uuid.uuid4()}/ip").status_code in (403, 404)


def test_the_super_admin_reads_every_firm_and_the_platform(anonymous_client, test_db, people):
    firm, bde, _ = people
    _sign_in(anonymous_client, bde.email)
    _sign_in(anonymous_client, bde.email, TEST_PASSWORD)
    client = _as_admin(anonymous_client)
    rows = client.get("/api/admin/activity").json()
    assert {"SIGN_IN_FAILED", "LOGIN"} <= {r["action"] for r in rows}
    assert next(r for r in rows if r["action"] == "SIGN_IN_FAILED")["firm_name"] == firm.name
    assert all("ip_address" not in r for r in rows)
    in_firm = client.get("/api/admin/activity", params={"firm_id": str(firm.id)}).json()
    assert in_firm and {r["firm_id"] for r in in_firm} == {str(firm.id)}


def test_candidates_are_named_from_their_resumes_in_every_firm(anonymous_client, test_db, people):
    """07 Q57: the name is the résumé's, read per firm, in the log and in the list to pick one from."""
    firm, bde, _ = people
    other = make_firm(test_db, make_plan(test_db, name="Other plan"), slug="globex")
    asha = make_version(test_db, firm.id, candidate_name="Asha Rao").candidate_id
    ravi = make_version(test_db, other.id, candidate_name="Ravi Teja").candidate_id
    for firm_id, candidate_id in ((firm.id, asha), (other.id, ravi)):
        test_db.add(ActivityEntry(firm_id=firm_id, actor_type="SYSTEM", actor_name="test", entity_type="candidate",
                                  entity_id=str(candidate_id), entity_label="A candidate", action="UPDATE",
                                  summary="Edited.", candidate_id=candidate_id))
    test_db.commit()
    client = _as_admin(anonymous_client)
    rows = client.get("/api/admin/activity").json()
    assert {r["candidate_id"]: r["candidate_name"] for r in rows if r["candidate_id"]} == {
        str(asha): "Asha Rao", str(ravi): "Ravi Teja"}
    assert client.get("/api/admin/activity/candidates").json() == [
        {"id": str(asha), "name": "Asha Rao"}, {"id": str(ravi), "name": "Ravi Teja"}]


def test_the_failed_view_holds_only_failures(anonymous_client, test_db, people):
    _, bde, _ = people
    for _ in range(5):
        _sign_in(anonymous_client, bde.email)
    throttle._hits.clear()
    client = _as_admin(anonymous_client)
    rows = client.get("/api/admin/activity", params={"failed": True}).json()
    assert {r["action"] for r in rows} == {"SIGN_IN_FAILED", "LOCKED_OUT"}
    assert next(r for r in rows if r["action"] == "SIGN_IN_FAILED")["attempt_count"] == 5
    assert client.get("/api/admin/activity/overview").json()["failed"] == 2


def test_the_overview_counts_the_platform_me_and_each_firm(anonymous_client, test_db, people):
    firm, bde, admin = people
    _sign_in(anonymous_client, bde.email, TEST_PASSWORD)
    client = _as_admin(anonymous_client)
    body = client.get("/api/admin/activity/overview").json()
    assert body["me"]["user_id"] == str(admin.id) and body["me"]["actions"] == 1
    assert next(f for f in body["firms"] if f["id"] == str(firm.id))["actions"] >= 1
    assert body["timezone"] == "Asia/Kolkata" and body["total"] >= 2


def test_a_firms_people_come_with_their_counts(anonymous_client, test_db, people):
    firm, bde, _ = people
    _sign_in(anonymous_client, bde.email, TEST_PASSWORD)
    client = _as_admin(anonymous_client)
    body = client.get("/api/admin/activity/people", params={"firm_id": str(firm.id)}).json()
    assert next(p for p in body["people"] if p["user_id"] == str(bde.id))["actions"] == 1
    assert client.get("/api/admin/activity/people", params={"firm_id": str(uuid.uuid4())}).status_code == 404


def test_the_ip_comes_one_failed_row_at_a_time(anonymous_client, test_db, people):
    _, bde, _ = people
    _sign_in(anonymous_client, bde.email)
    _sign_in(anonymous_client, bde.email, TEST_PASSWORD)
    test_db.expire_all()
    failed = _failed(test_db)[0]
    login = test_db.query(ActivityEntry).filter(ActivityEntry.action == "LOGIN").first()
    client = _as_admin(anonymous_client)
    assert client.get(f"/api/admin/activity/{failed.id}/ip").json() == {"ip_address": failed.ip_address}
    assert client.get(f"/api/admin/activity/{login.id}/ip").status_code == 404
    assert client.get(f"/api/admin/activity/{uuid.uuid4()}/ip").status_code == 404
