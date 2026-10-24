"""The database rules of the auth and tenancy tables (migration 0003; docs/02 §3.1, 07 Q37, Q38).

Every rule here is enforced by Postgres itself, so each test makes the bad write and expects the database to
refuse it, next to a good write that proves the refusal isn't vacuous.
"""
import hashlib
import os
import secrets
import subprocess
import sys
import uuid

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.pool import NullPool

import backend.models.db as db_mod
from backend.tests.scratch_db import _admin_engine, _url_for


def _run(sql: str, **params):
    with db_mod.engine.begin() as conn:
        return conn.execute(text(sql), params)


def _refused(sql: str, error=IntegrityError, **params) -> None:
    with pytest.raises(error):
        _run(sql, **params)


def _hash() -> str:
    return hashlib.sha256(secrets.token_bytes(32)).hexdigest()


def _plan() -> uuid.UUID:
    pid = uuid.uuid4()
    _run("INSERT INTO plans (id, name, seat_limit, candidate_limit) VALUES (:id, :n, 4, 25)", id=pid, n=f"p-{pid}")
    return pid


def _firm(slug: str | None = None, plan_id=None) -> uuid.UUID:
    fid = uuid.uuid4()
    _run("""INSERT INTO firms (id, name, slug, plan_id, seat_limit, candidate_limit)
            VALUES (:id, 'Acme', :slug, :plan, 4, 25)""",
         id=fid, slug=slug or f"f{fid.hex[:12]}", plan=plan_id or _plan())
    return fid


def _user(firm_id, role="BDE", email=None, active=True) -> uuid.UUID:
    uid = uuid.uuid4()
    _run("""INSERT INTO users (id, firm_id, role, name, email, password_hash, is_active)
            VALUES (:id, :firm, :role, 'U', :email, 'x', :active)""",
         id=uid, firm=firm_id, role=role, email=email or f"u{uid.hex[:12]}@acme.test", active=active)
    return uid


def _admin(email=None) -> uuid.UUID:
    aid = uuid.uuid4()
    _run("INSERT INTO platform_users (id, name, email, password_hash) VALUES (:id, 'A', :email, 'x')",
         id=aid, email=email or f"a{aid.hex[:12]}@admin.test")
    return aid


_INVITE = """INSERT INTO invites (firm_id, email, role, invited_by_user_id, invited_by_platform_user_id,
                                  token_hash, expires_at, status, accepted_at)
             VALUES (:firm, :email, :role, :by_user, :by_admin, :token, now() + interval '7 days',
                     :status, :accepted_at)"""


def _invite(firm_id, role="BDE", email=None, by_user=None, by_admin=None, token=None, status="PENDING",
            accepted_at=None):
    if by_user is None and by_admin is None:
        by_admin = _admin()
    return dict(firm=firm_id, email=email or f"i{uuid.uuid4().hex[:12]}@acme.test", role=role, by_user=by_user,
                by_admin=by_admin, token=token or _hash(), status=status, accepted_at=accepted_at)


# ── Firms and plans ───────────────────────────────────────────────────────────

@pytest.mark.parametrize("slug", ["abc", "hyderabad-tech-staffing", "a1-b2", "a" * 32])
def test_good_slugs_are_accepted(slug):
    _firm(slug)


@pytest.mark.parametrize("slug", ["ab", "a" * 33, "Acme", "1acme", "-acme", "acme-", "ac--me", "ac_me", "ac me"])
def test_bad_slugs_are_refused(slug):
    with pytest.raises(IntegrityError, match="ck_firms_slug_format"):
        _firm(slug)


def test_slugs_are_unique():
    _firm("acme")
    _refused("""INSERT INTO firms (name, slug, plan_id, seat_limit, candidate_limit)
                VALUES ('Other', 'acme', :plan, 1, 1)""", plan=_plan())


def test_a_firm_needs_a_plan_and_a_known_status():
    _refused("INSERT INTO firms (name, slug, seat_limit, candidate_limit) VALUES ('X', 'xxx', 1, 1)")
    _refused("""INSERT INTO firms (name, slug, plan_id, seat_limit, candidate_limit, status)
                VALUES ('X', 'xxx', :plan, 1, 1, 'TRIAL')""", plan=_plan())


def test_a_firm_starts_onboarding():
    fid = _firm()
    assert _run("SELECT status FROM firms WHERE id = :id", id=fid).scalar() == "ONBOARDING"


def test_a_plan_in_use_cannot_be_deleted():
    pid = _plan()
    _firm(plan_id=pid)
    _refused("DELETE FROM plans WHERE id = :id", id=pid)


def test_negative_limits_are_refused():
    _refused("INSERT INTO plans (name, seat_limit, candidate_limit) VALUES ('Bad', -1, 10)")


# ── Users and the one-OWNER rule ──────────────────────────────────────────────

def test_a_firm_has_at_most_one_active_owner():
    fid = _firm()
    first = _user(fid, "OWNER")
    with pytest.raises(IntegrityError, match="uq_users_one_active_owner_per_firm"):
        _user(fid, "OWNER")
    _run("UPDATE users SET is_active = false WHERE id = :id", id=first)
    _user(fid, "OWNER")                       # the deactivated owner no longer counts
    _user(_firm(), "OWNER")                   # another firm has its own owner


def test_user_roles_exclude_platform_admin():
    with pytest.raises(IntegrityError, match="ck_users_role"):
        _user(_firm(), "PLATFORM_ADMIN")


def test_emails_are_lowercase_and_unique():
    fid = _firm()
    with pytest.raises(IntegrityError, match="ck_users_email_lowercase"):
        _user(fid, email="Imran@acme.test")
    _user(fid, email="imran@acme.test")
    _refused("""INSERT INTO users (firm_id, role, name, email, password_hash)
                VALUES (:f, 'BDE', 'Dup', 'imran@acme.test', 'x')""", f=_firm())


def test_one_email_is_one_account_across_firm_and_platform_users():
    fid = _firm()
    _user(fid, email="sana@benchq.test")
    with pytest.raises(IntegrityError, match="already belongs to another account"):
        _admin("sana@benchq.test")

    _admin("staff@benchq.test")
    with pytest.raises(IntegrityError, match="already belongs to another account"):
        _user(fid, email="staff@benchq.test")

    other = _user(fid, email="free@acme.test")
    with pytest.raises(IntegrityError, match="already belongs to another account"):
        _run("UPDATE users SET email = 'staff@benchq.test' WHERE id = :id", id=other)


def test_a_firm_with_users_cannot_be_deleted():
    fid = _firm()
    _user(fid)
    _refused("DELETE FROM firms WHERE id = :id", id=fid)


# ── Invites ───────────────────────────────────────────────────────────────────

def test_a_firm_invite_and_a_platform_invite_are_accepted():
    _run(_INVITE, **_invite(_firm()))
    _run(_INVITE, **_invite(None, role="PLATFORM_ADMIN"))


@pytest.mark.parametrize("firm, role", [("firm", "PLATFORM_ADMIN"), (None, "OWNER"), (None, "BDE")])
def test_firm_is_null_exactly_for_platform_invites(firm, role):
    with pytest.raises(IntegrityError, match="ck_invites_platform_iff_no_firm"):
        _run(_INVITE, **_invite(_firm() if firm else None, role=role))


def test_the_raw_token_can_never_be_stored():
    with pytest.raises(IntegrityError, match="ck_invites_token_hash_sha256"):
        _run(_INVITE, **_invite(_firm(), token=secrets.token_urlsafe(32)))


def test_an_invite_has_exactly_one_inviter():
    fid = _firm()
    with pytest.raises(IntegrityError, match="ck_invites_one_inviter"):
        _run(_INVITE, **_invite(fid, by_user=_user(fid, "OWNER"), by_admin=_admin()))
    with pytest.raises(IntegrityError, match="ck_invites_one_inviter"):
        _run(_INVITE, **{**_invite(fid), "by_admin": None})


def test_one_pending_invite_per_email():
    fid = _firm()
    _run(_INVITE, **_invite(fid, email="kiran@acme.test"))
    with pytest.raises(IntegrityError, match="uq_invites_one_pending_per_email"):
        _run(_INVITE, **_invite(_firm(), email="kiran@acme.test"))
    _run("UPDATE invites SET status = 'REVOKED', revoked_at = now() WHERE email = 'kiran@acme.test'")
    _run(_INVITE, **_invite(fid, email="kiran@acme.test"))   # a revoked invite frees the email


def test_one_pending_owner_invite_per_firm():
    fid = _firm()
    _run(_INVITE, **_invite(fid, role="OWNER"))
    with pytest.raises(IntegrityError, match="uq_invites_one_pending_owner_per_firm"):
        _run(_INVITE, **_invite(fid, role="OWNER"))
    _run(_INVITE, **_invite(fid, role="MANAGER"))


def test_accepted_and_revoked_invites_carry_their_time():
    fid = _firm()
    with pytest.raises(IntegrityError, match="ck_invites_accepted_at"):
        _run(_INVITE, **_invite(fid, status="ACCEPTED"))
    _run(_INVITE, **_invite(fid, status="ACCEPTED", accepted_at="2026-10-21T10:00:00+00:00"))


# ── Support views ─────────────────────────────────────────────────────────────

_VIEW = """INSERT INTO support_views (platform_user_id, firm_id, reason, started_at, expires_at)
           VALUES (:admin, :firm, :reason, now(), now() + :minutes * interval '1 minute')"""


def test_a_support_view_lasts_exactly_sixty_minutes_with_a_real_reason():
    admin, fid = _admin(), _firm()
    with pytest.raises(IntegrityError, match="ck_support_views_reason_length"):
        _run(_VIEW, admin=admin, firm=fid, reason="  help    ", minutes=60)
    with pytest.raises(IntegrityError, match="ck_support_views_sixty_minutes"):
        _run(_VIEW, admin=admin, firm=fid, reason="Checking the import error", minutes=61)
    _run(_VIEW, admin=admin, firm=fid, reason="Checking the import error", minutes=60)


def test_one_open_support_view_per_admin():
    admin = _admin()
    _run(_VIEW, admin=admin, firm=_firm(), reason="Checking the import error", minutes=60)
    with pytest.raises(IntegrityError, match="uq_support_views_one_open_per_admin"):
        _run(_VIEW, admin=admin, firm=_firm(), reason="Checking another firm", minutes=60)
    _run("UPDATE support_views SET ended_at = now() WHERE platform_user_id = :a", a=admin)
    _run(_VIEW, admin=admin, firm=_firm(), reason="Checking another firm", minutes=60)


# ── Sessions ──────────────────────────────────────────────────────────────────

_SESSION = """INSERT INTO sessions (token_hash, user_id, platform_user_id, support_view_id, last_seen_at,
                                    expires_at, absolute_expires_at)
              VALUES (:token, :user, :admin, :view, now(), now() + interval '7 days',
                      now() + :cap_days * interval '1 day')"""


def _session(user=None, admin=None, view=None, token=None, cap_days=30):
    return dict(token=token or _hash(), user=user, admin=admin, view=view, cap_days=cap_days)


def test_a_session_belongs_to_exactly_one_account():
    fid = _firm()
    _run(_SESSION, **_session(user=_user(fid)))
    _run(_SESSION, **_session(admin=_admin()))
    with pytest.raises(IntegrityError, match="ck_sessions_one_account"):
        _run(_SESSION, **_session(user=_user(fid), admin=_admin()))
    with pytest.raises(IntegrityError, match="ck_sessions_one_account"):
        _run(_SESSION, **_session())


def test_session_tokens_are_hashes_and_capped_at_thirty_days():
    with pytest.raises(IntegrityError, match="ck_sessions_token_hash_sha256"):
        _run(_SESSION, **_session(admin=_admin(), token=secrets.token_urlsafe(32)))
    with pytest.raises(IntegrityError, match="ck_sessions_thirty_day_cap"):
        _run(_SESSION, **_session(admin=_admin(), cap_days=31))


def test_only_a_platform_session_carries_a_support_view():
    admin, fid = _admin(), _firm()
    view = _run(_VIEW + " RETURNING id", admin=admin, firm=fid, reason="Checking the import error",
                minutes=60).scalar()
    _run(_SESSION, **_session(admin=admin, view=view))
    with pytest.raises(IntegrityError, match="ck_sessions_support_view_is_platform"):
        _run(_SESSION, **_session(user=_user(fid), view=view))


# ── Ledger ────────────────────────────────────────────────────────────────────

_ENTRY = """INSERT INTO ledger_entries (firm_id, actor_type, actor_name, entity_type, entity_id, entity_label,
                                        action, summary, claim_state)
            VALUES (:firm, 'PLATFORM_ADMIN', 'Sana Mirza', 'firm', 'x', 'Acme', :action, 's', :claim)"""


def test_ledger_actions_come_from_the_contract():
    fid = _firm()
    _run(_ENTRY, firm=fid, action="FIRM_CREATED", claim=None)
    _run(_ENTRY, firm=None, action="LOGIN", claim=None)       # platform-only events have no firm (A13)
    with pytest.raises(IntegrityError, match="ck_ledger_entries_action"):
        _run(_ENTRY, firm=fid, action="FIRM_DELETED", claim=None)
    with pytest.raises(IntegrityError, match="ck_ledger_entries_claim_state"):
        _run(_ENTRY, firm=fid, action="UPDATE", claim="MAYBE")


# ── The migration itself ──────────────────────────────────────────────────────

@pytest.fixture
def scratch_db():
    name = f"jn_0003_{uuid.uuid4().hex[:8]}_test"
    admin = _admin_engine()
    with admin.connect() as conn:
        conn.execute(text(f'CREATE DATABASE "{name}"'))
    engine = create_engine(_url_for(name), poolclass=NullPool)
    try:
        yield name, engine
    finally:
        engine.dispose()
        with admin.connect() as conn:
            conn.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        admin.dispose()


def _alembic(dbname: str, *args: str) -> None:
    env = {**os.environ, "DATABASE_URL": _url_for(dbname)}
    done = subprocess.run([sys.executable, "-m", "alembic", "-c", "backend/alembic.ini", *args],
                          env=env, capture_output=True, text=True)
    assert done.returncode == 0, f"alembic failed:\n{done.stdout}\n{done.stderr}"


def test_the_migration_creates_the_default_plan_and_firm_and_downgrades_cleanly(scratch_db):
    from backend.models.tenancy import DEFAULT_FIRM_ID, DEFAULT_PLAN_ID

    name, engine = scratch_db
    _alembic(name, "upgrade", "0003")
    with engine.connect() as conn:
        firm = conn.execute(text("SELECT id, slug, status, plan_id, seat_limit, candidate_limit FROM firms")).one()
        assert tuple(firm) == (DEFAULT_FIRM_ID, "default", "ACTIVE", DEFAULT_PLAN_ID, 10, 100)
        assert conn.execute(text("SELECT name FROM plans")).scalars().all() == ["Default"]

    _alembic(name, "downgrade", "0002")
    with engine.connect() as conn:
        left = conn.execute(text(
            "SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename IN "
            "('plans','firms','users','platform_users','invites','sessions','support_views','ledger_entries')"
        )).scalar()
        assert left == 0
        assert conn.execute(text(
            "SELECT count(*) FROM pg_proc WHERE proname = 'refuse_email_used_by_other_account'")).scalar() == 0
