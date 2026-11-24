"""In production no invite goes to a testing domain and no account on one signs in (backend/auth/invites.py;
docs/team/uzair.md, step 6). The demo accounts (docs/03 §3.2) use `.benchq.test` and sign in with a published password,
so a production database that holds one must not let it in, and nobody can make one there. Development is unchanged:
the tests and the demo seed use these domains."""
import pytest

from backend import config
from backend.auth.invites import TEST_EMAIL_REFUSED, is_test_email
from backend.tests.auth_support import TEST_PASSWORD, make_admin, make_user
from backend.tests.problem_support import assert_problem

DEMO = "imran@hyderabad-tech-staffing.benchq.test"
WRONG_PASSWORD = {"type": "about:blank", "title": "Unauthorized", "status": 401,
                  "detail": "Email or password is incorrect.", "code": "UNAUTHENTICATED"}


def _cookie(token):
    return {"cookie": f"bq_session={token}"}


@pytest.fixture
def production(monkeypatch):
    monkeypatch.setattr(config, "IS_PRODUCTION", True)


def _without_id(response) -> dict:
    body = assert_problem(response)
    body.pop("request_id")
    return body


@pytest.mark.parametrize("address, is_test", [
    (DEMO, True), ("sana@admin.benchq.test", True), ("a@x.example", True), ("a@x.invalid", True),
    ("a@localhost", True), ("a@x.localhost", True), ("a@acme.test.", True), ("A@ACME.TEST", True),
    ("a@acme.com", False), ("a@testing.io", False), ("a@example.com", False), ("a@x.tested.com", False),
])
def test_the_testing_domains(address, is_test):
    assert is_test_email(address) is is_test


def test_production_refuses_an_owners_invite_to_a_test_address(anonymous_client, accounts, production):
    r = anonymous_client.post(f"/api/firms/{accounts.firm_id}/invites", json={"email": "x@acme.benchq.test",
                              "role": "VIEWER"}, headers=_cookie(accounts.firm_token))
    assert r.status_code == 400
    assert assert_problem(r)["detail"] == TEST_EMAIL_REFUSED


def test_production_refuses_a_new_firms_owner_on_a_test_address(api_client, accounts, production):
    r = api_client.post("/api/admin/firms", json={
        "name": "Northwind Staffing", "slug": "northwind", "plan_id": str(accounts.plan_id),
        "primary_timezone": "Asia/Kolkata", "client_timezone": "America/New_York", "contact_phone": "+91 98",
        "work_start": "18:30", "work_end": "04:00", "owner_name": "Nora North", "owner_email": "nora@northwind.test"})
    assert r.status_code == 400
    assert assert_problem(r)["detail"] == TEST_EMAIL_REFUSED


def test_production_refuses_a_resend_to_a_test_address(anonymous_client, accounts, test_db, monkeypatch):
    """An invite made before (or seeded) to a test address can't get a new link in production."""
    made = anonymous_client.post(f"/api/firms/{accounts.firm_id}/invites", json={"email": "x@acme.benchq.test",
                                 "role": "VIEWER"}, headers=_cookie(accounts.firm_token))
    assert made.status_code == 201, made.text
    monkeypatch.setattr(config, "IS_PRODUCTION", True)
    r = anonymous_client.post(f"/api/firms/{accounts.firm_id}/invites/{made.json()['invite']['id']}/resend",
                              headers=_cookie(accounts.firm_token))
    assert r.status_code == 400
    assert assert_problem(r)["detail"] == TEST_EMAIL_REFUSED


def test_production_refuses_a_demo_account_at_sign_in_as_a_wrong_password(anonymous_client, accounts, test_db,
                                                                          production):
    from backend.models.tenancy import Firm
    make_user(test_db, test_db.get(Firm, accounts.firm_id), email=DEMO, role="BDE", name="Imran Shaikh")
    make_admin(test_db, email="sana@admin.benchq.test", name="Sana Admin")
    test_db.commit()
    wrong = anonymous_client.post("/api/auth/sign-in", json={"email": "owner@acme.test", "password": "wrong-password"},
                                  headers={"X-Forwarded-For": "10.0.5.1"})
    for email in (DEMO, "sana@admin.benchq.test"):
        r = anonymous_client.post("/api/auth/sign-in", json={"email": email, "password": TEST_PASSWORD},
                                  headers={"X-Forwarded-For": "10.0.5.2"})
        assert r.status_code == 401
        assert _without_id(r) == _without_id(wrong) == WRONG_PASSWORD     # confirms nothing
        assert "bq_session" not in r.headers.get("set-cookie", "")


def test_development_is_unchanged(anonymous_client, accounts, test_db):
    from backend.models.tenancy import Firm
    make_user(test_db, test_db.get(Firm, accounts.firm_id), email=DEMO, role="BDE", name="Imran Shaikh")
    test_db.commit()
    r = anonymous_client.post("/api/auth/sign-in", json={"email": DEMO, "password": TEST_PASSWORD})
    assert r.status_code == 200, r.text
    invite = anonymous_client.post(f"/api/firms/{accounts.firm_id}/invites", json={"email": "x@acme.benchq.test",
                                   "role": "VIEWER"}, headers=_cookie(accounts.firm_token))
    assert invite.status_code == 201, invite.text
