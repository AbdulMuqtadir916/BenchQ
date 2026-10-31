"""The per-user rate limit (backend/auth/throttle.py `check_user`, the `limit_per_user` middleware in main.py;
docs/team/uzair.md §1): every signed-in firm user's requests, 429 with Retry-After over budget. The Super Admin is
never limited, in or out of a support view; signed-out requests are left to the per-IP rules."""
import pytest

from backend.tests.auth_support import make_user

LIMIT = 3
TOO_MANY = {"detail": "Too many attempts. Try again in a few minutes."}


def _cookie(token):
    return {"cookie": f"bq_session={token}"}


@pytest.fixture(autouse=True)
def _small_limit(monkeypatch):
    """A handful of requests instead of 300, so the tests stay fast."""
    import backend.auth.throttle as throttle_mod
    monkeypatch.setattr(throttle_mod, "USER_LIMIT", (LIMIT, 60.0))


def _me(client, token):
    return client.get("/api/auth/me", headers=_cookie(token))


def test_a_user_over_the_limit_gets_429_with_retry_after(anonymous_client, accounts):
    for _ in range(LIMIT):
        assert _me(anonymous_client, accounts.firm_token).status_code == 200
    r = _me(anonymous_client, accounts.firm_token)
    assert r.status_code == 429
    assert 1 <= int(r.headers["Retry-After"]) <= 61
    assert r.json() == TOO_MANY


def test_the_limit_applies_to_every_route_not_just_one(anonymous_client, accounts):
    for _ in range(LIMIT):
        _me(anonymous_client, accounts.firm_token)
    r = anonymous_client.get(f"/api/firms/{accounts.firm_id}/members", headers=_cookie(accounts.firm_token))
    assert r.status_code == 429


def test_another_user_in_the_same_firm_is_unaffected(anonymous_client, accounts, test_db):
    from backend.auth.sessions import start_session
    from backend.models.tenancy import Firm
    other = make_user(test_db, test_db.get(Firm, accounts.firm_id), email="bde@acme.test", role="BDE", name="Bea BDE")
    other_token, _ = start_session(test_db, other)
    test_db.commit()
    for _ in range(LIMIT):
        _me(anonymous_client, accounts.firm_token)
    assert _me(anonymous_client, accounts.firm_token).status_code == 429
    assert _me(anonymous_client, other_token).status_code == 200


def test_the_limit_expires(anonymous_client, accounts, monkeypatch):
    import backend.auth.throttle as throttle_mod
    for _ in range(LIMIT):
        _me(anonymous_client, accounts.firm_token)
    assert _me(anonymous_client, accounts.firm_token).status_code == 429
    real = throttle_mod.time.monotonic
    monkeypatch.setattr(throttle_mod.time, "monotonic", lambda: real() + throttle_mod.USER_LIMIT[1] + 1)
    assert _me(anonymous_client, accounts.firm_token).status_code == 200


def test_a_refused_request_is_not_counted(anonymous_client, accounts, monkeypatch):
    import backend.auth.throttle as throttle_mod
    real = throttle_mod.time.monotonic
    start = real()
    monkeypatch.setattr(throttle_mod.time, "monotonic", lambda: start)
    for _ in range(LIMIT):
        _me(anonymous_client, accounts.firm_token)
    for _ in range(5):
        assert _me(anonymous_client, accounts.firm_token).status_code == 429
    # Once the first counted request leaves the window, there's room again: the refused ones never counted.
    monkeypatch.setattr(throttle_mod.time, "monotonic", lambda: start + throttle_mod.USER_LIMIT[1] + 1)
    assert _me(anonymous_client, accounts.firm_token).status_code == 200


def test_the_super_admin_is_never_limited(anonymous_client, accounts):
    for _ in range(LIMIT * 3):
        assert _me(anonymous_client, accounts.admin_token).status_code == 200


def test_the_super_admin_in_a_support_view_is_never_limited(anonymous_client, accounts):
    r = anonymous_client.post("/api/support-views", json={"firm_id": str(accounts.firm_id),
                              "reason": "Customer reported a missing application"}, headers=_cookie(accounts.admin_token))
    assert r.status_code in (200, 201)
    for _ in range(LIMIT * 3):
        r = anonymous_client.get(f"/api/firms/{accounts.firm_id}/members", headers=_cookie(accounts.admin_token))
        assert r.status_code == 200


def test_signed_out_requests_are_not_counted_per_user(anonymous_client, accounts):
    for _ in range(LIMIT * 3):
        assert anonymous_client.get("/health").status_code == 200
        assert anonymous_client.get("/api/invites/not-a-token").status_code != 429
    # The signed-out traffic used none of the user's budget.
    assert _me(anonymous_client, accounts.firm_token).status_code == 200
