"""PR #105 review: races and gaps in the reset flow (07 Q54).

Each race is made deterministic: a wrapper around a function the route calls between its first read and its lock
commits a competing change from another session (the test's own), exactly where a concurrent request would. Each
test fails on the code before the review fixes (a lock without populate_existing() returns the copy already loaded).
"""
from backend.models.db import utcnow
from backend.tests.auth_support import TEST_PASSWORD, make_user


def _bde_with_request(anonymous_client, api_client, test_db, accounts, email):
    """A BDE without a manager (so the signed-in OWNER approves), with a pending request, and the OWNER's notice."""
    from backend.models.notifications import PasswordResetRequest
    from backend.models.tenancy import Firm

    bde = make_user(test_db, test_db.get(Firm, accounts.firm_id), email=email, role="BDE", name="Bina BDE")
    test_db.commit()
    assert anonymous_client.post("/api/auth/password-reset/request", json={"email": bde.email}).status_code == 202
    notice = next(item for item in api_client.get("/api/notifications").json()["items"]
                  if item["type"] == "PASSWORD_RESET")
    row = test_db.query(PasswordResetRequest).filter_by(requester_user_id=bde.id).one()
    return bde, notice, row


def _approve(api_client, notice):
    response = api_client.post(f"/api/notifications/{notice['id']}/password-reset-decision", json={"approve": True})
    assert response.status_code == 200
    return response.json()["resetLink"].split("#", 1)[1]


def _complete_elsewhere(test_db, row):
    """What a concurrent /complete with the same token commits."""
    test_db.refresh(row)
    row.status, row.reset_token_consumed_at = "COMPLETED", utcnow()
    row.reset_token_hash = row.reset_token_expires_at = None
    test_db.commit()


def test_a_one_use_link_cannot_be_spent_twice(api_client, anonymous_client, accounts, test_db, monkeypatch):
    import backend.api.routes_auth as routes_auth
    from backend.auth.password_reset import LINK_EXPIRED

    bde, notice, row = _bde_with_request(anonymous_client, api_client, test_db, accounts, "twice@acme.test")
    token = _approve(api_client, notice)
    hash_before = bde.password_hash
    real = routes_auth.expire_due_for_user

    def first_completion_wins(db, user, now=None):     # runs after /complete read the row, before it locks it
        _complete_elsewhere(test_db, row)
        return real(db, user, now)

    monkeypatch.setattr(routes_auth, "expire_due_for_user", first_completion_wins)
    second = anonymous_client.post("/api/auth/password-reset/complete", json={"token": token, "password": "a-second-password"})

    assert (second.status_code, second.json()["detail"]) == (400, LINK_EXPIRED)
    test_db.refresh(bde)
    assert bde.password_hash == hash_before      # the second call changed nothing


def test_concurrent_decisions_see_each_other(api_client, anonymous_client, accounts, test_db, monkeypatch):
    import backend.api.routes_notifications as routes_notifications

    _, notice, row = _bde_with_request(anonymous_client, api_client, test_db, accounts, "double-click@acme.test")
    real = routes_notifications.decide_request

    def denied_first(db, loaded_row, **kwargs):          # the route loaded the row; another decision lands now
        test_db.refresh(row)
        row.status, row.decided_at, row.decided_by_user_id = "DENIED", utcnow(), accounts.user_id
        test_db.commit()
        return real(db, loaded_row, **kwargs)

    monkeypatch.setattr(routes_notifications, "decide_request", denied_first)
    approve = api_client.post(f"/api/notifications/{notice['id']}/password-reset-decision", json={"approve": True})

    assert approve.status_code == 409
    test_db.refresh(row)
    assert (row.status, row.reset_token_hash) == ("DENIED", None)   # no live link on a denied request


def test_no_fresh_link_for_a_request_completed_meanwhile(api_client, anonymous_client, accounts, test_db, monkeypatch):
    import backend.api.routes_notifications as routes_notifications

    _, notice, row = _bde_with_request(anonymous_client, api_client, test_db, accounts, "reissue-race@acme.test")
    _approve(api_client, notice)
    real = routes_notifications.expire_due_for_user

    def completed_meanwhile(db, user, now=None):
        _complete_elsewhere(test_db, row)
        return real(db, user, now)

    monkeypatch.setattr(routes_notifications, "expire_due_for_user", completed_meanwhile)
    reissue = api_client.post(f"/api/notifications/{notice['id']}/password-reset-link")

    assert reissue.status_code == 409
    test_db.refresh(row)
    assert (row.status, row.reset_token_hash) == ("COMPLETED", None)


def test_sign_in_with_a_password_replaced_during_the_check_is_refused(anonymous_client, accounts, test_db, monkeypatch):
    import backend.api.routes_auth as routes_auth
    from backend.auth.passwords import hash_password
    from backend.models.tenancy import Firm

    bde = make_user(test_db, test_db.get(Firm, accounts.firm_id), email="mid-check@acme.test", role="BDE")
    test_db.commit()
    real = routes_auth.verify_password

    def reset_completes_during_the_check(stored_hash, password):
        ok = real(stored_hash, password)
        if ok and password == TEST_PASSWORD:
            test_db.refresh(bde)
            bde.password_hash = hash_password("the-new-password-1")
            test_db.commit()
        return ok

    monkeypatch.setattr(routes_auth, "verify_password", reset_completes_during_the_check)
    response = anonymous_client.post("/api/auth/sign-in", json={"email": bde.email, "password": TEST_PASSWORD})

    assert response.status_code == 401


def test_completing_a_reset_ends_every_session(api_client, anonymous_client, accounts, test_db):
    from backend.auth.sessions import start_session
    from backend.models.tenancy import Session

    bde, notice, _ = _bde_with_request(anonymous_client, api_client, test_db, accounts, "sessions@acme.test")
    token = _approve(api_client, notice)
    start_session(test_db, bde)      # a session made after the request froze the account (e.g. a staff reset path)
    test_db.commit()

    done = anonymous_client.post("/api/auth/password-reset/complete", json={"token": token, "password": "a-brand-new-one"})

    assert done.status_code == 200
    test_db.expire_all()
    assert test_db.query(Session).filter_by(user_id=bde.id).count() == 0


def test_request_decision_reissue_and_completion_are_in_the_firm_ledger(api_client, anonymous_client, accounts, test_db):
    from backend.auth.password_reset import LEDGER_ENTITY
    from backend.models.tenancy import LedgerEntry

    bde, notice, row = _bde_with_request(anonymous_client, api_client, test_db, accounts, "audited@acme.test")
    _approve(api_client, notice)
    assert api_client.post(f"/api/notifications/{notice['id']}/password-reset-link").status_code == 200

    test_db.expire_all()
    entries = (test_db.query(LedgerEntry).filter_by(entity_type=LEDGER_ENTITY, entity_id=str(row.id))
               .order_by(LedgerEntry.created_at, LedgerEntry.id).all())
    assert all(entry.firm_id == accounts.firm_id for entry in entries)
    by_action = {(entry.action, entry.actor_type) for entry in entries}
    assert ("CREATE", "SYSTEM") in by_action                 # the request (from a signed-out page)
    assert ("STATE_CHANGE", "USER") in by_action             # the OWNER's approval, under their name
    assert ("UPDATE", "USER") in by_action                   # the fresh link
    approver_entries = [entry for entry in entries if entry.actor_type == "USER"]
    assert all(entry.actor_user_id == accounts.user_id for entry in approver_entries)


def test_denial_is_in_the_ledger(api_client, anonymous_client, accounts, test_db):
    from backend.auth.password_reset import LEDGER_ENTITY
    from backend.models.tenancy import LedgerEntry

    _, notice, row = _bde_with_request(anonymous_client, api_client, test_db, accounts, "denied@acme.test")
    deny = api_client.post(f"/api/notifications/{notice['id']}/password-reset-decision", json={"approve": False})
    assert deny.status_code == 200

    test_db.expire_all()
    entry = (test_db.query(LedgerEntry)
             .filter_by(entity_type=LEDGER_ENTITY, entity_id=str(row.id), action="STATE_CHANGE").one())
    assert "denied" in entry.summary


def test_production_refuses_to_start_without_an_https_reset_url(monkeypatch):
    import pytest
    import backend.auth.password_reset as password_reset

    monkeypatch.setattr(password_reset, "IS_PRODUCTION", True)
    for bad in ("", "http://app.example.com"):
        monkeypatch.setattr(password_reset, "PASSWORD_RESET_BASE_URL", bad)
        with pytest.raises(RuntimeError):
            password_reset.require_reset_base_url()
    monkeypatch.setattr(password_reset, "PASSWORD_RESET_BASE_URL", "https://app.example.com")
    password_reset.require_reset_base_url()
    monkeypatch.setattr(password_reset, "IS_PRODUCTION", False)
    monkeypatch.setattr(password_reset, "PASSWORD_RESET_BASE_URL", "")
    password_reset.require_reset_base_url()


def test_sign_in_still_works_when_a_concurrent_sign_in_only_rehashed(anonymous_client, accounts, test_db, monkeypatch):
    """The hash changed under the lock, but to the same password (an Argon2 parameter upgrade): not a reset."""
    import backend.api.routes_auth as routes_auth
    from backend.auth.passwords import hash_password
    from backend.models.tenancy import Firm

    bde = make_user(test_db, test_db.get(Firm, accounts.firm_id), email="rehash@acme.test", role="BDE")
    test_db.commit()
    real = routes_auth.verify_password
    calls = {"n": 0}

    def rehashed_meanwhile(stored_hash, password):
        ok = real(stored_hash, password)
        calls["n"] += 1
        if calls["n"] == 1 and ok:
            test_db.refresh(bde)
            bde.password_hash = hash_password(TEST_PASSWORD)     # same password, new salt
            test_db.commit()
        return ok

    monkeypatch.setattr(routes_auth, "verify_password", rehashed_meanwhile)
    response = anonymous_client.post("/api/auth/sign-in", json={"email": bde.email, "password": TEST_PASSWORD})

    assert response.status_code == 200


def test_the_polled_list_locks_only_requesters_with_an_open_request(api_client, anonymous_client, accounts, test_db,
                                                                   monkeypatch):
    import backend.api.routes_notifications as routes_notifications

    _, denied_notice, _ = _bde_with_request(anonymous_client, api_client, test_db, accounts, "resolved@acme.test")
    assert api_client.post(f"/api/notifications/{denied_notice['id']}/password-reset-decision",
                           json={"approve": False}).status_code == 200
    settled = []
    real = routes_notifications.expire_due_for_user
    monkeypatch.setattr(routes_notifications, "expire_due_for_user",
                        lambda db, user, now=None: (settled.append(user.email), real(db, user, now))[1])

    assert api_client.get("/api/notifications").status_code == 200
    assert settled == []                                   # a resolved request is never locked again

    from backend.models.tenancy import Firm
    pending = make_user(test_db, test_db.get(Firm, accounts.firm_id), email="still-open@acme.test", role="BDE")
    test_db.commit()
    assert anonymous_client.post("/api/auth/password-reset/request", json={"email": pending.email}).status_code == 202
    assert api_client.get("/api/notifications").status_code == 200
    assert settled == ["still-open@acme.test"]


def test_an_expired_request_is_in_the_ledger(api_client, anonymous_client, accounts, test_db):
    from datetime import timedelta
    from backend.auth.password_reset import LEDGER_ENTITY
    from backend.models.tenancy import LedgerEntry

    _, _, row = _bde_with_request(anonymous_client, api_client, test_db, accounts, "timed-out@acme.test")
    now = utcnow()
    row.created_at, row.expires_at = now - timedelta(hours=30), now - timedelta(hours=6)
    test_db.commit()

    assert api_client.get("/api/notifications").status_code == 200

    test_db.expire_all()
    entry = (test_db.query(LedgerEntry)
             .filter_by(entity_type=LEDGER_ENTITY, entity_id=str(row.id), action="STATE_CHANGE").one())
    assert (entry.actor_type, entry.firm_id) == ("SYSTEM", accounts.firm_id)
    assert "expired" in entry.summary


def test_a_super_admins_decision_is_in_the_owners_firm_ledger(api_client, anonymous_client, accounts, test_db):
    from backend.auth.password_reset import LEDGER_ENTITY
    from backend.auth.sessions import COOKIE_NAME
    from backend.models.notifications import PasswordResetRequest
    from backend.models.tenancy import LedgerEntry

    assert anonymous_client.post("/api/auth/password-reset/request", json={"email": "owner@acme.test"}).status_code == 202
    anonymous_client.cookies.set(COOKIE_NAME, accounts.admin_token)
    notice = next(item for item in anonymous_client.get("/api/notifications").json()["items"]
                  if item["type"] == "PASSWORD_RESET")
    approve = anonymous_client.post(f"/api/notifications/{notice['id']}/password-reset-decision", json={"approve": True})
    assert approve.status_code == 200

    row = test_db.query(PasswordResetRequest).filter_by(requester_user_id=accounts.user_id).one()
    entry = (test_db.query(LedgerEntry)
             .filter_by(entity_type=LEDGER_ENTITY, entity_id=str(row.id), action="STATE_CHANGE").one())
    assert (entry.actor_type, entry.actor_user_id, entry.firm_id) == ("PLATFORM_ADMIN", accounts.admin_id, accounts.firm_id)
