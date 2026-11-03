"""Approval based reset: hierarchy, password freeze, one-use manual link, and generic public response."""
from datetime import timedelta

from backend.models.db import utcnow
from backend.tests.auth_support import TEST_PASSWORD, make_user


def test_bde_routes_only_to_assigned_manager_and_freezes_old_password(api_client, anonymous_client, accounts, test_db):
    from backend.auth.sessions import COOKIE_NAME, start_session
    from backend.models.notifications import Notification, PasswordResetRequest
    from backend.models.tenancy import User

    from backend.models.tenancy import Firm
    firm = test_db.get(Firm, accounts.firm_id)
    owner = test_db.get(User, accounts.user_id)
    manager = make_user(test_db, firm, email="manager@acme.test", role="MANAGER", name="Mina Manager")
    bde = make_user(test_db, firm, email="bde@acme.test", role="BDE", name="Bilal BDE")
    bde.manager_id = manager.id
    manager_token, _ = start_session(test_db, manager)
    requester_token, _ = start_session(test_db, bde)
    test_db.commit()

    response = anonymous_client.post("/api/auth/password-reset/request", json={"email": " BDE@acme.test "})
    assert response.status_code == 202
    assert response.json()["message"]
    request_row = test_db.query(PasswordResetRequest).filter_by(requester_user_id=bde.id).one()
    assert request_row.status == "PENDING"
    assert request_row.approver_user_id == manager.id
    assert test_db.query(Notification).filter_by(type="PASSWORD_RESET", user_id=manager.id).count() == 1
    assert test_db.query(Notification).filter_by(type="PASSWORD_RESET", user_id=owner.id).count() == 0
    assert anonymous_client.get("/api/auth/me", headers={"cookie": f"{COOKIE_NAME}={requester_token}"}).status_code == 401
    assert anonymous_client.post("/api/auth/sign-in", json={"email": bde.email, "password": TEST_PASSWORD}).status_code == 401

    api_client.cookies.set(COOKIE_NAME, manager_token)
    notification = api_client.get("/api/notifications").json()["items"][0]
    approved = api_client.post(f"/api/notifications/{notification['id']}/password-reset-decision",
                               json={"approve": True})
    assert approved.status_code == 200
    link = approved.json()["resetLink"]
    assert link.startswith("http://localhost:3000/reset-password#")
    assert "no-store" in approved.headers["cache-control"]
    raw = link.split("#", 1)[1]
    refreshed = api_client.post(f"/api/notifications/{notification['id']}/password-reset-link")
    assert refreshed.status_code == 200
    fresh_raw = refreshed.json()["resetLink"].split("#", 1)[1]
    assert fresh_raw != raw
    assert anonymous_client.post("/api/auth/password-reset/complete",
                                 json={"token": raw, "password": "a-new-safe-password"}).status_code == 400
    same_as_old = anonymous_client.post("/api/auth/password-reset/complete",
                                        json={"token": fresh_raw, "password": TEST_PASSWORD})
    assert same_as_old.status_code == 422
    completed = anonymous_client.post("/api/auth/password-reset/complete",
                                      json={"token": fresh_raw, "password": "a-new-safe-password"})
    assert completed.status_code == 200
    assert anonymous_client.post("/api/auth/password-reset/complete",
                                 json={"token": fresh_raw, "password": "another-safe-password"}).status_code == 400
    assert anonymous_client.post("/api/auth/sign-in", json={"email": bde.email,
                                                              "password": "a-new-safe-password"}).status_code == 200


def test_bde_without_manager_goes_to_same_firm_owner(api_client, anonymous_client, accounts, test_db):
    from backend.models.notifications import PasswordResetRequest
    from backend.models.tenancy import Firm, User
    firm = test_db.get(Firm, accounts.firm_id)
    owner = test_db.get(User, accounts.user_id)
    bde = make_user(test_db, firm, email="unmanaged@acme.test", role="BDE")
    test_db.commit()
    response = anonymous_client.post("/api/auth/password-reset/request", json={"email": bde.email})
    assert response.status_code == 202
    row = test_db.query(PasswordResetRequest).filter_by(requester_user_id=bde.id).one()
    assert row.approver_user_id == owner.id


def test_bde_with_inactive_assigned_manager_falls_back_to_own_firm_owner(anonymous_client, accounts, test_db):
    from backend.models.notifications import PasswordResetRequest
    from backend.models.tenancy import Firm, User
    firm = test_db.get(Firm, accounts.firm_id)
    owner = test_db.get(User, accounts.user_id)
    manager = make_user(test_db, firm, email="inactive-manager@acme.test", role="MANAGER", is_active=False)
    bde = make_user(test_db, firm, email="bde-inactive-chain@acme.test", role="BDE")
    bde.manager_id = manager.id
    test_db.commit()
    response = anonymous_client.post("/api/auth/password-reset/request", json={"email": bde.email})
    assert response.status_code == 202
    row = test_db.query(PasswordResetRequest).filter_by(requester_user_id=bde.id).one()
    assert row.approver_user_id == owner.id


def test_manager_routes_to_owner_and_owner_routes_to_platform_admin(anonymous_client, accounts, test_db):
    from backend.models.notifications import Notification, PasswordResetRequest
    from backend.models.tenancy import Firm, User
    firm = test_db.get(Firm, accounts.firm_id)
    owner = test_db.get(User, accounts.user_id)
    manager = make_user(test_db, firm, email="requesting-manager@acme.test", role="MANAGER")
    test_db.commit()
    assert anonymous_client.post("/api/auth/password-reset/request", json={"email": manager.email}).status_code == 202
    manager_request = test_db.query(PasswordResetRequest).filter_by(requester_user_id=manager.id).one()
    assert manager_request.approver_user_id == owner.id
    assert anonymous_client.post("/api/auth/password-reset/request", json={"email": owner.email}).status_code == 202
    owner_request = test_db.query(PasswordResetRequest).filter_by(requester_user_id=owner.id).one()
    assert owner_request.is_platform_approval is True
    assert owner_request.approver_user_id is None
    assert test_db.query(Notification).filter_by(type="PASSWORD_RESET", platform_user_id=accounts.admin_id).count() == 1


def test_expired_pending_request_unfreezes_the_unchanged_old_password(anonymous_client, accounts, test_db):
    from backend.models.notifications import PasswordResetRequest
    from backend.models.tenancy import Firm
    firm = test_db.get(Firm, accounts.firm_id)
    bde = make_user(test_db, firm, email="expire-me@acme.test", role="BDE")
    test_db.commit()
    assert anonymous_client.post("/api/auth/password-reset/request", json={"email": bde.email}).status_code == 202
    row = test_db.query(PasswordResetRequest).filter_by(requester_user_id=bde.id).one()
    now = utcnow()
    row.created_at = now - timedelta(hours=30)
    row.expires_at = now - timedelta(hours=6)
    old_hash = bde.password_hash
    test_db.commit()
    login = anonymous_client.post("/api/auth/sign-in", json={"email": bde.email, "password": TEST_PASSWORD})
    assert login.status_code == 200
    test_db.refresh(row)
    test_db.refresh(bde)
    assert row.status == "EXPIRED"
    assert bde.password_hash == old_hash


def test_denial_restores_the_existing_password(api_client, anonymous_client, accounts, test_db):
    from backend.models.notifications import PasswordResetRequest
    from backend.models.tenancy import Firm
    bde = make_user(test_db, test_db.get(Firm, accounts.firm_id), email="denied@acme.test", role="BDE")
    old_hash = bde.password_hash
    test_db.commit()
    assert anonymous_client.post("/api/auth/password-reset/request", json={"email": bde.email}).status_code == 202
    notice = next(item for item in api_client.get("/api/notifications").json()["items"]
                  if item["type"] == "PASSWORD_RESET")
    denied = api_client.post(f"/api/notifications/{notice['id']}/password-reset-decision", json={"approve": False})
    assert denied.status_code == 200
    assert denied.json() == {"status": "DENIED", "resetLink": None}
    login = anonymous_client.post("/api/auth/sign-in", json={"email": bde.email, "password": TEST_PASSWORD})
    assert login.status_code == 200
    test_db.refresh(bde)
    row = test_db.query(PasswordResetRequest).filter_by(requester_user_id=bde.id).one()
    assert row.status == "DENIED"
    assert bde.password_hash == old_hash


def test_unknown_and_super_admin_receive_same_generic_response_without_request(anonymous_client, accounts, test_db):
    from backend.models.notifications import PasswordResetRequest
    from backend.models.tenancy import User
    bde = make_user(test_db, test_db.get(__import__("backend.models.tenancy", fromlist=["Firm"]).Firm, accounts.firm_id),
                    email="unapproved@acme.test", role="BDE")
    test_db.commit()
    unknown = anonymous_client.post("/api/auth/password-reset/request", json={"email": "missing@example.test"})
    platform = anonymous_client.post("/api/auth/password-reset/request", json={"email": "admin@benchq.test"})
    assert unknown.status_code == platform.status_code == 202
    assert unknown.json() == platform.json()
    assert test_db.query(PasswordResetRequest).filter_by(requester_user_id=bde.id).count() == 0
    assert anonymous_client.post("/api/auth/sign-in", json={"email": bde.email, "password": TEST_PASSWORD}).status_code == 200
