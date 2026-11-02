"""Additional edge cases for the approval-based recovery flow (07 Q54)."""
from datetime import timedelta

import pytest

from backend.models.db import utcnow
from backend.tests.auth_support import TEST_PASSWORD, make_firm, make_plan, make_user


def test_public_request_response_is_generic_for_unknown_inactive_and_platform_accounts(
    anonymous_client, accounts, test_db
):
    from backend.models.notifications import PasswordResetRequest
    from backend.models.tenancy import Firm, PlatformUser

    firm = test_db.get(Firm, accounts.firm_id)
    inactive = make_user(test_db, firm, email="inactive@acme.test", role="BDE", is_active=False)
    test_db.commit()

    responses = [
        anonymous_client.post("/api/auth/password-reset/request", json={"email": "owner@acme.test"}),
        anonymous_client.post("/api/auth/password-reset/request", json={"email": "missing@example.test"}),
        anonymous_client.post("/api/auth/password-reset/request", json={"email": inactive.email}),
        anonymous_client.post("/api/auth/password-reset/request", json={"email": "admin@benchq.test"}),
    ]
    assert [response.status_code for response in responses] == [202] * len(responses)
    assert all(response.json() == responses[0].json() for response in responses)
    assert test_db.query(PasswordResetRequest).count() == 1
    assert test_db.query(PasswordResetRequest).filter_by(requester_user_id=inactive.id).count() == 0
    admin = test_db.get(PlatformUser, accounts.admin_id)
    assert admin is not None


def test_duplicate_requests_do_not_extend_or_duplicate_the_pending_request(anonymous_client, accounts, test_db):
    from backend.models.notifications import Notification, PasswordResetRequest
    from backend.models.tenancy import Firm

    bde = make_user(test_db, test_db.get(Firm, accounts.firm_id), email="repeat@acme.test", role="BDE")
    test_db.commit()
    first = anonymous_client.post("/api/auth/password-reset/request", json={"email": bde.email})
    row = test_db.query(PasswordResetRequest).filter_by(requester_user_id=bde.id).one()
    original_expiry = row.expires_at
    second = anonymous_client.post("/api/auth/password-reset/request", json={"email": bde.email})
    test_db.refresh(row)

    assert first.status_code == second.status_code == 202
    assert test_db.query(PasswordResetRequest).filter_by(requester_user_id=bde.id).count() == 1
    assert row.expires_at == original_expiry
    assert test_db.query(Notification).filter_by(type="PASSWORD_RESET", entity_id=str(row.id)).count() == 1


def test_no_active_approver_does_not_freeze_the_requester(anonymous_client, accounts, test_db):
    from backend.models.notifications import PasswordResetRequest
    from backend.models.tenancy import Firm, User

    owner = test_db.get(User, accounts.user_id)
    assert owner is not None
    owner.is_active = False
    bde = make_user(test_db, test_db.get(Firm, accounts.firm_id), email="no-owner@acme.test", role="BDE")
    test_db.commit()

    response = anonymous_client.post("/api/auth/password-reset/request", json={"email": bde.email})
    login = anonymous_client.post("/api/auth/sign-in", json={"email": bde.email, "password": TEST_PASSWORD})

    assert response.status_code == 202
    assert test_db.query(PasswordResetRequest).filter_by(requester_user_id=bde.id).count() == 0
    assert login.status_code == 200


@pytest.mark.parametrize("stale_reason", ["deactivated", "relationship changed"])
def test_stale_approver_after_request_expires_it_without_rerouting(
    anonymous_client, accounts, test_db, stale_reason
):
    from backend.models.notifications import Notification, PasswordResetRequest
    from backend.models.tenancy import Firm, User

    firm = test_db.get(Firm, accounts.firm_id)
    owner = test_db.get(User, accounts.user_id)
    manager = make_user(test_db, firm, email="stale-manager@acme.test", role="MANAGER")
    replacement = make_user(test_db, firm, email="replacement-manager@acme.test", role="MANAGER")
    bde = make_user(test_db, firm, email="stale-chain@acme.test", role="BDE")
    bde.manager_id = manager.id
    test_db.commit()
    assert anonymous_client.post("/api/auth/password-reset/request", json={"email": bde.email}).status_code == 202
    row = test_db.query(PasswordResetRequest).filter_by(requester_user_id=bde.id).one()
    if stale_reason == "deactivated":
        manager.is_active = False
    else:
        bde.manager_id = replacement.id
    test_db.commit()

    login = anonymous_client.post("/api/auth/sign-in", json={"email": bde.email, "password": TEST_PASSWORD})
    test_db.refresh(row)
    manager_notice = test_db.query(Notification).filter_by(type="PASSWORD_RESET", user_id=manager.id).one()

    assert login.status_code == 200
    assert row.status == "EXPIRED"
    assert manager_notice.resolved_at is not None
    assert test_db.query(Notification).filter_by(type="PASSWORD_RESET", user_id=owner.id).count() == 0


def test_viewer_request_routes_to_same_firm_owner(anonymous_client, accounts, test_db):
    from backend.models.notifications import PasswordResetRequest
    from backend.models.tenancy import Firm, User

    owner = test_db.get(User, accounts.user_id)
    viewer = make_user(test_db, test_db.get(Firm, accounts.firm_id), email="viewer@acme.test", role="VIEWER")
    test_db.commit()
    response = anonymous_client.post("/api/auth/password-reset/request", json={"email": viewer.email})
    row = test_db.query(PasswordResetRequest).filter_by(requester_user_id=viewer.id).one()

    assert response.status_code == 202
    assert row.approver_user_id == owner.id
    assert row.approver_role == "OWNER"


def test_expired_approved_link_can_be_reissued_only_by_its_original_approver(
    api_client, anonymous_client, accounts, test_db
):
    from backend.models.notifications import PasswordResetRequest
    from backend.models.tenancy import Firm, User

    bde = make_user(test_db, test_db.get(Firm, accounts.firm_id), email="expired-link@acme.test", role="BDE")
    other_manager = make_user(test_db, test_db.get(Firm, accounts.firm_id), email="other-manager@acme.test", role="MANAGER")
    test_db.commit()
    assert anonymous_client.post("/api/auth/password-reset/request", json={"email": bde.email}).status_code == 202
    notice = next(item for item in api_client.get("/api/notifications").json()["items"]
                  if item["type"] == "PASSWORD_RESET")
    approved = api_client.post(f"/api/notifications/{notice['id']}/password-reset-decision", json={"approve": True})
    old_token = approved.json()["resetLink"].split("#", 1)[1]
    row = test_db.query(PasswordResetRequest).filter_by(requester_user_id=bde.id).one()
    row.reset_token_expires_at = utcnow() - timedelta(seconds=1)
    test_db.commit()

    expired = anonymous_client.post("/api/auth/password-reset/complete", json={
        "token": old_token, "password": "a-new-safe-password",
    })
    request_notice = api_client.patch(f"/api/notifications/{notice['id']}/read")
    from backend.auth.sessions import COOKIE_NAME, start_session
    other_token, _ = start_session(test_db, other_manager)
    test_db.commit()
    api_client.cookies.set(COOKIE_NAME, other_token)
    wrong_approver = api_client.post(f"/api/notifications/{notice['id']}/password-reset-link")
    api_client.cookies.set(COOKIE_NAME, accounts.firm_token)
    refreshed = api_client.post(f"/api/notifications/{notice['id']}/password-reset-link")
    fresh_token = refreshed.json()["resetLink"].split("#", 1)[1]
    replay_old = anonymous_client.post("/api/auth/password-reset/complete", json={
        "token": old_token, "password": "another-new-safe-password",
    })

    assert expired.status_code == 400
    assert request_notice.status_code == 200
    assert wrong_approver.status_code == 404
    assert refreshed.status_code == 200
    assert fresh_token != old_token
    assert replay_old.status_code == 400


def test_foreign_firm_cannot_list_or_act_on_another_firms_reset_notification(
    api_client, anonymous_client, accounts, test_db
):
    from backend.auth.sessions import COOKIE_NAME, start_session
    from backend.models.tenancy import Firm, User

    bde = make_user(test_db, test_db.get(Firm, accounts.firm_id), email="private-notice@acme.test", role="BDE")
    test_db.commit()
    assert anonymous_client.post("/api/auth/password-reset/request", json={"email": bde.email}).status_code == 202
    notice = next(item for item in api_client.get("/api/notifications").json()["items"]
                  if item["type"] == "PASSWORD_RESET")

    plan = make_plan(test_db, name="Other firm plan")
    other_firm = make_firm(test_db, plan, slug="other-firm")
    other_owner = make_user(test_db, other_firm, email="owner@other.test", role="OWNER")
    other_token, _ = start_session(test_db, other_owner)
    test_db.commit()
    api_client.cookies.set(COOKIE_NAME, other_token)

    inbox = api_client.get("/api/notifications")
    decision = api_client.post(f"/api/notifications/{notice['id']}/password-reset-decision", json={"approve": True})
    reissue = api_client.post(f"/api/notifications/{notice['id']}/password-reset-link")
    mark_read = api_client.patch(f"/api/notifications/{notice['id']}/read")

    assert inbox.status_code == 200 and inbox.json()["items"] == []
    assert decision.status_code == reissue.status_code == mark_read.status_code == 404


def test_owner_request_is_approved_from_the_platform_inbox(api_client, anonymous_client, accounts, test_db):
    from backend.auth.sessions import COOKIE_NAME
    from backend.models.notifications import PasswordResetRequest
    from backend.models.tenancy import PlatformUser, User

    owner = test_db.get(User, accounts.user_id)
    admin = test_db.get(PlatformUser, accounts.admin_id)
    assert anonymous_client.post("/api/auth/password-reset/request", json={"email": owner.email}).status_code == 202
    row = test_db.query(PasswordResetRequest).filter_by(requester_user_id=owner.id).one()
    api_client.cookies.set(COOKIE_NAME, accounts.admin_token)
    items = api_client.get("/api/notifications").json()["items"]
    notice = next(item for item in items if item["entityId"] == str(row.id))
    approved = api_client.post(f"/api/notifications/{notice['id']}/password-reset-decision", json={"approve": True})

    assert admin is not None
    assert approved.status_code == 200
    assert approved.json()["status"] == "APPROVED"
    assert approved.json()["resetLink"].startswith("http://localhost:3000/reset-password#")


def test_reset_request_is_rate_limited_without_revealing_account_existence(anonymous_client):
    responses = [anonymous_client.post("/api/auth/password-reset/request", json={"email": "unknown@example.test"})
                 for _ in range(3)]
    limited = anonymous_client.post("/api/auth/password-reset/request", json={"email": "unknown@example.test"})

    assert [response.status_code for response in responses] == [202, 202, 202]
    assert all(response.json() == responses[0].json() for response in responses)
    assert limited.status_code == 429
    assert "retry-after" in limited.headers


def test_owner_request_with_no_active_platform_approver_does_not_freeze_account(
    anonymous_client, accounts, test_db
):
    from backend.models.notifications import PasswordResetRequest
    from backend.models.tenancy import PlatformUser, User

    owner = test_db.get(User, accounts.user_id)
    admin = test_db.get(PlatformUser, accounts.admin_id)
    assert owner is not None and admin is not None
    admin.is_active = False
    test_db.commit()

    response = anonymous_client.post("/api/auth/password-reset/request", json={"email": owner.email})
    login = anonymous_client.post("/api/auth/sign-in", json={"email": owner.email, "password": TEST_PASSWORD})

    assert response.status_code == 202
    assert test_db.query(PasswordResetRequest).filter_by(requester_user_id=owner.id).count() == 0
    assert login.status_code == 200
