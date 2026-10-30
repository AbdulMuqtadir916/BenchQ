"""Sign-in, sign-out, /me and first-run (07-auth F3), ported from the frontend mock's behaviour
(src/mocks/auth.ts, src/mocks/session.ts), plus the session lifetime rules (07 Q37)."""
from datetime import timedelta
import re

import pytest

from backend.tests.auth_support import TEST_PASSWORD, make_admin, make_firm, make_plan, make_user

INVALID = {"detail": "Email or password is incorrect."}


def _sign_in(client, email, password=TEST_PASSWORD, **kw):
    return client.post("/api/auth/sign-in", json={"email": email, "password": password}, **kw)


def _camel(key):
    head, *rest = key.split("_")
    return head + "".join(part.title() for part in rest)


# ── Sign-in ──────────────────────────────────────────────────────────────────

def test_a_firm_user_signs_in(anonymous_client, accounts):
    r = _sign_in(anonymous_client, "owner@acme.test")
    assert r.status_code == 200
    body = r.json()
    assert body["principal"] == {"kind": "firm", "user_id": str(accounts.user_id),
                                 "firm_id": str(accounts.firm_id), "role": "OWNER"}
    assert body["user"]["email"] == "owner@acme.test"
    assert body["firm"]["slug"] == "acme"
    # The cookie works on the next request.
    assert anonymous_client.get("/api/auth/me").json()["principal"]["user_id"] == str(accounts.user_id)


def test_a_super_admin_signs_in(anonymous_client, accounts):
    body = _sign_in(anonymous_client, "admin@benchq.test").json()
    assert body["principal"] == {"kind": "platform", "user_id": str(accounts.admin_id), "role": "PLATFORM_ADMIN",
                                 "support": None}
    assert body["platform_user"]["role"] == "PLATFORM_ADMIN"
    assert body["firm"] is None


def test_the_session_matches_the_frontend_contract(anonymous_client, accounts):
    """The keys, camelCased, are exactly src/lib/schemas/session.ts's FirmSessionSchema / PlatformSessionSchema."""
    firm = _sign_in(anonymous_client, "owner@acme.test").json()
    assert set(map(_camel, firm)) == {"principal", "user", "firm"}
    assert set(map(_camel, firm["principal"])) == {"kind", "userId", "firmId", "role"}
    assert set(map(_camel, firm["user"])) == {"id", "firmId", "name", "email", "role", "managerId", "avatarUrl",
                                              "isActive", "lastActiveAt"}
    assert set(map(_camel, firm["firm"])) == {
        "id", "name", "slug", "logoUrl", "primaryTimezone", "clientTimezone", "truthGuardMode",
        "applicationExpiryDays", "status", "planId", "seatLimit", "candidateLimit", "contactPhone", "bdeCapacity",
        "createdAt"}
    platform = _sign_in(anonymous_client, "admin@benchq.test").json()
    assert set(map(_camel, platform)) == {"principal", "platformUser", "firm"}
    assert set(map(_camel, platform["principal"])) == {"kind", "userId", "role", "support"}
    assert set(map(_camel, platform["platform_user"])) == {"id", "name", "email", "role", "isActive", "lastActiveAt"}


def test_the_email_matches_case_insensitively_and_trimmed(anonymous_client, accounts):
    assert _sign_in(anonymous_client, "  Owner@ACME.test ").status_code == 200


@pytest.mark.parametrize("email,password", [
    ("nobody@acme.test", TEST_PASSWORD),     # unknown email
    ("owner@acme.test", "wrong-password"),   # wrong password
    ("owner@acme.test", ""),                 # empty password
    ("admin@benchq.test", "wrong-password"),
])
def test_every_failure_is_the_same_401(anonymous_client, accounts, email, password):
    r = _sign_in(anonymous_client, email, password)
    assert r.status_code == 401
    assert r.json() == INVALID
    assert "set-cookie" not in r.headers


def test_a_deactivated_account_gets_the_same_401(anonymous_client, accounts, test_db):
    from backend.models.tenancy import PlatformUser, User
    test_db.get(User, accounts.user_id).is_active = False
    test_db.get(PlatformUser, accounts.admin_id).is_active = False
    test_db.commit()
    assert _sign_in(anonymous_client, "owner@acme.test").json() == INVALID
    assert _sign_in(anonymous_client, "admin@benchq.test").json() == INVALID


def test_a_suspended_firm_user_can_sign_in(anonymous_client, accounts, test_db):
    """They see the suspended screen (from /me); firm routes refuse them (test_access.py)."""
    from backend.models.tenancy import Firm
    test_db.get(Firm, accounts.firm_id).status = "SUSPENDED"
    test_db.commit()
    assert _sign_in(anonymous_client, "owner@acme.test").json()["firm"]["status"] == "SUSPENDED"


def test_the_cookie_attributes(anonymous_client, accounts):
    cookie = _sign_in(anonymous_client, "owner@acme.test").headers["set-cookie"]
    assert re.match(r"bq_session=[A-Za-z0-9_-]{43};", cookie)
    assert "HttpOnly" in cookie
    assert "SameSite=lax" in cookie
    assert "Path=/" in cookie
    max_age = int(re.search(r"Max-Age=(\d+)", cookie).group(1))
    assert 7 * 86400 - 5 <= max_age <= 7 * 86400     # 7 days
    assert "Secure" not in cookie                    # development (conftest)


def test_the_cookie_is_secure_in_production(anonymous_client, accounts, monkeypatch):
    import backend.auth.sessions as sessions_mod
    monkeypatch.setattr(sessions_mod, "SESSION_COOKIE_SECURE", True)
    assert "Secure" in _sign_in(anonymous_client, "owner@acme.test").headers["set-cookie"]


def test_only_the_tokens_hash_is_stored(anonymous_client, accounts, test_db):
    from backend.auth.tokens import hash_token
    from backend.models.tenancy import Session
    token = _sign_in(anonymous_client, "owner@acme.test").cookies["bq_session"]
    hashes = [row.token_hash for row in test_db.query(Session).all()]
    assert hash_token(token) in hashes
    assert token not in hashes


def test_sign_in_is_logged_in_the_ledger(anonymous_client, accounts, test_db):
    from backend.models.tenancy import LedgerEntry
    _sign_in(anonymous_client, "owner@acme.test")
    _sign_in(anonymous_client, "admin@benchq.test")
    entries = {e.entity_type: e for e in test_db.query(LedgerEntry).filter(LedgerEntry.action == "LOGIN")}
    assert entries["user"].firm_id == accounts.firm_id
    assert entries["user"].actor_type == "USER"
    assert entries["user"].actor_user_id == accounts.user_id
    assert entries["platform_user"].firm_id is None
    assert entries["platform_user"].actor_type == "PLATFORM_ADMIN"


def test_sign_in_does_not_finish_first_run(anonymous_client, accounts):
    """last_active_at is set by /first-run-done, so a new user still lands on /welcome (docs/07 T7)."""
    assert _sign_in(anonymous_client, "owner@acme.test").json()["user"]["last_active_at"] is None


def test_signing_in_again_replaces_this_browsers_session(anonymous_client, accounts, test_db):
    from backend.models.tenancy import Session
    _sign_in(anonymous_client, "owner@acme.test")
    count = test_db.query(Session).count()
    _sign_in(anonymous_client, "admin@benchq.test")
    assert test_db.query(Session).count() == count
    assert anonymous_client.get("/api/auth/me").json()["principal"]["kind"] == "platform"


def test_an_old_hash_is_upgraded_on_sign_in(anonymous_client, accounts, test_db):
    from argon2 import PasswordHasher
    from backend.models.tenancy import User
    user = test_db.get(User, accounts.user_id)
    weak = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1).hash(TEST_PASSWORD)
    user.password_hash = weak
    test_db.commit()
    assert _sign_in(anonymous_client, "owner@acme.test").status_code == 200
    test_db.refresh(user)
    assert user.password_hash != weak
    assert _sign_in(anonymous_client, "owner@acme.test").status_code == 200


def test_an_oversized_password_is_refused_before_hashing(anonymous_client, accounts):
    assert _sign_in(anonymous_client, "owner@acme.test", "x" * 5000).status_code == 422


# ── Throttle ─────────────────────────────────────────────────────────────────

def test_five_failures_lock_the_email(anonymous_client, accounts):
    for _ in range(5):
        assert _sign_in(anonymous_client, "owner@acme.test", "wrong-password").status_code == 401
    r = _sign_in(anonymous_client, "owner@acme.test")
    assert r.status_code == 429
    assert int(r.headers["Retry-After"]) >= 1
    # Another account from another address is unaffected.
    assert _sign_in(anonymous_client, "admin@benchq.test", headers={"X-Forwarded-For": "10.0.0.2"}).status_code == 200


def test_the_email_lock_counts_any_spelling_of_the_address(anonymous_client, accounts):
    for i in range(5):
        _sign_in(anonymous_client, "OWNER@acme.test" if i % 2 else "owner@acme.test", "wrong-password",
                 headers={"X-Forwarded-For": f"10.0.1.{i}"})
    assert _sign_in(anonymous_client, "Owner@Acme.test", headers={"X-Forwarded-For": "10.0.1.99"}).status_code == 429


def test_ten_failures_lock_the_ip(anonymous_client, accounts):
    ip = {"X-Forwarded-For": "10.0.0.9"}
    for i in range(10):
        assert _sign_in(anonymous_client, f"nobody{i}@acme.test", "wrong-password", headers=ip).status_code == 401
    assert _sign_in(anonymous_client, "owner@acme.test", headers=ip).status_code == 429
    assert _sign_in(anonymous_client, "owner@acme.test", headers={"X-Forwarded-For": "10.0.0.10"}).status_code == 200


def test_a_forged_forwarded_address_does_not_dodge_the_ip_lock(anonymous_client, accounts):
    # The proxy appends the real address; whatever the client sent sits to its left and changes every time.
    for i in range(10):
        assert _sign_in(anonymous_client, f"nobody{i}@acme.test", "wrong-password",
                        headers={"X-Forwarded-For": f"203.0.113.{i}, 10.0.0.9"}).status_code == 401
    r = _sign_in(anonymous_client, "owner@acme.test", headers={"X-Forwarded-For": "203.0.113.99, 10.0.0.9"})
    assert r.status_code == 429


def test_with_no_trusted_proxy_the_header_is_ignored(anonymous_client, accounts, monkeypatch):
    import backend.auth.throttle as throttle_mod
    monkeypatch.setattr(throttle_mod, "TRUSTED_PROXY_HOPS", 0)
    for i in range(10):
        _sign_in(anonymous_client, f"nobody{i}@acme.test", "wrong-password", headers={"X-Forwarded-For": f"10.0.2.{i}"})
    assert _sign_in(anonymous_client, "owner@acme.test", headers={"X-Forwarded-For": "10.0.2.99"}).status_code == 429


def _ip_of(forwarded_for, peer="10.9.9.9"):
    """client_ip() for a request from `peer` carrying `forwarded_for` (None = no header)."""
    from starlette.requests import Request
    from backend.auth.throttle import client_ip
    headers = [] if forwarded_for is None else [(b"x-forwarded-for", forwarded_for.encode())]
    return client_ip(Request({"type": "http", "headers": headers, "client": (peer, 1234)}))


@pytest.mark.parametrize("hops, forwarded_for, expected", [
    (1, "198.51.100.7", "198.51.100.7"),                         # one load balancer appended the client
    (2, "198.51.100.7, 10.0.0.2", "198.51.100.7"),               # a normal chain: client, proxy
    (1, "6.6.6.6, 198.51.100.7", "198.51.100.7"),                # a forged entry to the left is skipped
    (2, "6.6.6.6, 198.51.100.7, 10.0.0.2", "198.51.100.7"),      # ... behind two proxies too
    (2, "198.51.100.7", "198.51.100.7"),                         # fewer entries than hops: the leftmost there is
    (1, None, "10.9.9.9"),                                       # no header: the connecting address
])
def test_client_ip_reads_the_trusted_hops_from_the_right(monkeypatch, hops, forwarded_for, expected):
    import backend.auth.throttle as throttle_mod
    monkeypatch.setattr(throttle_mod, "TRUSTED_PROXY_HOPS", hops)
    assert _ip_of(forwarded_for) == expected


def test_client_ip_with_no_trusted_proxy_ignores_a_forged_header(monkeypatch):
    import backend.auth.throttle as throttle_mod
    monkeypatch.setattr(throttle_mod, "TRUSTED_PROXY_HOPS", 0)
    assert _ip_of("6.6.6.6") == "10.9.9.9"
    assert _ip_of("6.6.6.6, 198.51.100.7") == "10.9.9.9"


def test_client_ip_rotating_forged_entries_share_one_bucket(monkeypatch):
    import backend.auth.throttle as throttle_mod
    monkeypatch.setattr(throttle_mod, "TRUSTED_PROXY_HOPS", 1)
    assert {_ip_of(f"203.0.113.{i}, 198.51.100.7") for i in range(50)} == {"198.51.100.7"}


def test_a_success_clears_the_count(anonymous_client, accounts):
    for _ in range(4):
        _sign_in(anonymous_client, "owner@acme.test", "wrong-password")
    assert _sign_in(anonymous_client, "owner@acme.test").status_code == 200
    for _ in range(4):
        assert _sign_in(anonymous_client, "owner@acme.test", "wrong-password").status_code == 401


def test_the_lock_expires(anonymous_client, accounts, monkeypatch):
    import backend.auth.throttle as throttle_mod
    for _ in range(5):
        _sign_in(anonymous_client, "owner@acme.test", "wrong-password")
    assert _sign_in(anonymous_client, "owner@acme.test").status_code == 429
    real = throttle_mod.time.monotonic
    monkeypatch.setattr(throttle_mod.time, "monotonic", lambda: real() + throttle_mod.EMAIL_LIMIT[1] + 1)
    assert _sign_in(anonymous_client, "owner@acme.test").status_code == 200


# ── Sign-out ─────────────────────────────────────────────────────────────────

def test_sign_out_ends_the_session(anonymous_client, accounts, test_db):
    from backend.auth.tokens import hash_token
    from backend.models.tenancy import Session
    token = _sign_in(anonymous_client, "owner@acme.test").cookies["bq_session"]
    r = anonymous_client.post("/api/auth/sign-out")
    assert r.status_code == 204
    assert "bq_session=" in r.headers["set-cookie"] and "Max-Age=0" in r.headers["set-cookie"]
    assert test_db.query(Session).filter(Session.token_hash == hash_token(token)).count() == 0
    assert anonymous_client.get("/api/auth/me", headers={"cookie": f"bq_session={token}"}).status_code == 401


def test_sign_out_without_a_session_is_still_204(anonymous_client):
    assert anonymous_client.post("/api/auth/sign-out").status_code == 204
    assert anonymous_client.post("/api/auth/sign-out", headers={"cookie": "bq_session=gone"}).status_code == 204


def test_sign_out_ends_an_open_support_view_and_logs_it(anonymous_client, accounts, test_db):
    from backend.auth.tokens import hash_token
    from backend.models.db import utcnow
    from backend.models.tenancy import LedgerEntry, Session, SupportView
    now = utcnow()
    view = SupportView(platform_user_id=accounts.admin_id, firm_id=accounts.firm_id,
                       reason="Checking a reported export bug", started_at=now,
                       expires_at=now + timedelta(minutes=60))
    test_db.add(view)
    test_db.flush()
    row = test_db.query(Session).filter(Session.token_hash == hash_token(accounts.admin_token)).one()
    row.support_view_id = view.id
    test_db.commit()

    me = anonymous_client.get("/api/auth/me", headers={"cookie": f"bq_session={accounts.admin_token}"}).json()
    assert me["principal"]["support"]["reason"] == "Checking a reported export bug"
    assert me["firm"]["id"] == str(accounts.firm_id)

    assert anonymous_client.post("/api/auth/sign-out",
                                 headers={"cookie": f"bq_session={accounts.admin_token}"}).status_code == 204
    test_db.refresh(view)
    assert view.ended_at is not None
    end = test_db.query(LedgerEntry).filter(LedgerEntry.action == "ADMIN_ACCESS_END").one()
    assert end.firm_id == accounts.firm_id
    assert end.entity_id == str(view.id)


# ── /me and first run ────────────────────────────────────────────────────────

def test_me_signed_out_is_401(anonymous_client):
    assert anonymous_client.get("/api/auth/me").status_code == 401


def test_first_run_done_marks_the_user_active_once(anonymous_client, accounts, test_db):
    from backend.models.tenancy import User
    cookie = {"cookie": f"bq_session={accounts.firm_token}"}
    body = anonymous_client.post("/api/auth/first-run-done", headers=cookie).json()
    first = body["user"]["last_active_at"]
    assert first is not None
    again = anonymous_client.post("/api/auth/first-run-done", headers=cookie).json()
    assert again["user"]["last_active_at"] == first
    assert test_db.get(User, accounts.user_id).last_active_at is not None


def test_first_run_done_is_firm_only(anonymous_client, accounts):
    r = anonymous_client.post("/api/auth/first-run-done", headers={"cookie": f"bq_session={accounts.admin_token}"})
    assert r.status_code == 403


# ── Session lifetime (backend/auth/sessions.py) ──────────────────────────────

@pytest.fixture
def firm_user(test_db):
    user = make_user(test_db, make_firm(test_db, make_plan(test_db, name="Lifetime"), slug="lifeco"),
                     email="u@lifeco.test")
    test_db.commit()
    return user


def test_a_session_expires_after_seven_idle_days(test_db, firm_user):
    from backend.auth.sessions import resolve, start_session
    from backend.models.db import utcnow
    from backend.models.tenancy import Session
    start = utcnow()
    token, _ = start_session(test_db, firm_user, now=start)
    test_db.commit()
    assert resolve(test_db, token, now=start + timedelta(days=6, hours=23)) is not None
    # That use slid the expiry, so the session lives on…
    assert resolve(test_db, token, now=start + timedelta(days=13)) is not None
    # …until seven idle days pass, then it is gone (and its row deleted).
    assert resolve(test_db, token, now=start + timedelta(days=20, hours=1)) is None
    assert test_db.query(Session).count() == 0


def test_a_session_never_outlives_thirty_days(test_db, firm_user):
    from backend.auth.sessions import resolve, start_session
    from backend.models.db import utcnow
    start = utcnow()
    token, row = start_session(test_db, firm_user, now=start)
    test_db.commit()
    for day in range(1, 30):
        assert resolve(test_db, token, now=start + timedelta(days=day)) is not None, day
    assert row.expires_at <= row.absolute_expires_at
    assert resolve(test_db, token, now=start + timedelta(days=30, minutes=1)) is None


def test_the_expiry_slides_at_most_every_five_minutes(test_db, firm_user):
    from backend.auth.sessions import resolve, start_session
    from backend.models.db import utcnow
    start = utcnow()
    token, _ = start_session(test_db, firm_user, now=start)
    test_db.commit()
    assert resolve(test_db, token, now=start + timedelta(minutes=1)).expires_at is None
    assert resolve(test_db, token, now=start + timedelta(minutes=6)).expires_at is not None


def test_an_expired_support_view_drops_out_of_the_principal(test_db, accounts):
    from backend.auth.sessions import resolve
    from backend.auth.tokens import hash_token
    from backend.models.db import utcnow
    from backend.models.tenancy import Session, SupportView
    started = utcnow() - timedelta(minutes=61)
    view = SupportView(platform_user_id=accounts.admin_id, firm_id=accounts.firm_id,
                       reason="Checking a reported export bug", started_at=started,
                       expires_at=started + timedelta(minutes=60))
    test_db.add(view)
    test_db.flush()
    test_db.query(Session).filter(Session.token_hash == hash_token(accounts.admin_token)).one().support_view_id = view.id
    test_db.commit()
    assert resolve(test_db, accounts.admin_token).principal.support_view_id is None


def test_end_all_sessions_signs_an_account_out_everywhere(test_db, firm_user):
    from backend.auth.sessions import end_all_sessions, resolve, start_session
    tokens = [start_session(test_db, firm_user)[0] for _ in range(3)]
    test_db.commit()
    assert end_all_sessions(test_db, firm_user) == 3
    test_db.commit()
    assert all(resolve(test_db, t) is None for t in tokens)


def test_a_platform_admin_and_a_firm_user_cannot_share_an_email(test_db, accounts):
    """Sign-in looks in both tables; migration 0003's trigger keeps an email to one account."""
    from sqlalchemy.exc import IntegrityError
    with pytest.raises(IntegrityError):
        make_admin(test_db, email="owner@acme.test")
