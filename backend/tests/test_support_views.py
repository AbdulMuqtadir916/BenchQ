"""The read-only support view on the backend (backend/auth/support.py, backend/api/routes_support.py; 07 §4, Q10,
Q20, Q29). Ported case for case from src/mocks/support.test.ts, then the read / write / other-firm matrix, and the
edges agreed on issue #56: PDF exports refused, the second write check, every session end, races, expiry settled
once and wherever it is noticed.

A view lives on the admin's session. It opens one firm's reads, the whole firm, never its writes; it is one at a
time, lasts 60 minutes, and every start and end is in the firm's own ledger with the admin's name, never their email.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import pytest
from sqlalchemy import text

from backend.models.db import Application, Job, Resume
from backend.models.tenancy import Firm, LedgerEntry, Session, SupportView
from backend.tests.auth_support import TEST_PASSWORD, make_firm, make_plan, make_user
from backend.tests.ledger_support import assert_logged

REASON = "Customer reported a missing application"
READ_ONLY = {"detail": "A support view is read-only."}
NO_VIEW = {"detail": "A platform admin can't act inside a firm."}


def _cookie(token):
    return {"cookie": f"bq_session={token}"}


@pytest.fixture
def world(test_db, accounts):
    """acme (the signed-in OWNER's firm, with an application and a résumé), globex (another ACTIVE firm with its own
    application), a SUSPENDED firm and an ONBOARDING firm with no users. `admin` is the Super Admin's cookie."""
    acme = test_db.get(Firm, accounts.firm_id)
    plan = make_plan(test_db, name="Other plan")
    globex = make_firm(test_db, plan, slug="globex", name="Globex")
    make_user(test_db, globex, email="owner@globex.test", name="Gary Globex")
    suspended = make_firm(test_db, plan, slug="cbw", name="Cobweb", status="SUSPENDED")
    make_user(test_db, suspended, email="owner@cbw.test", name="Cora Cobweb")
    onboarding = make_firm(test_db, plan, slug="gsc", name="Green Shoots", status="ONBOARDING")
    job = Job(external_id="ext-1", title="Engineer", company="Initech", url="https://i.test", source="manual")
    test_db.add(job)
    test_db.flush()
    acme_app = Application(firm_id=acme.id, job_id=job.id, status="applied")
    globex_app = Application(firm_id=globex.id, job_id=job.id, status="applied")
    resume = Resume(firm_id=acme.id, name="Acme base", is_base=True, json_data={"header": {"name": "A"}})
    test_db.add_all([acme_app, globex_app, resume])
    test_db.commit()
    return {"acme": acme.id, "globex": globex.id, "suspended": suspended.id, "onboarding": onboarding.id,
            "acme_app": acme_app.id, "globex_app": globex_app.id, "resume": resume.id,
            "admin": _cookie(accounts.admin_token), "owner": _cookie(accounts.firm_token)}


def _start(client, world, firm_key="acme", reason=REASON):
    return client.post("/api/support-views", json={"firm_id": str(world[firm_key]), "reason": reason},
                       headers=world["admin"])


def _exit(client, world):
    return client.delete("/api/support-views/current", headers=world["admin"])


def _ledger(test_db, **filters):
    test_db.expire_all()
    return test_db.query(LedgerEntry).filter_by(**filters).order_by(LedgerEntry.created_at).all()


def _expire(test_db, minutes=61):
    """Move every open view, and its start entry, back in time: the 60-minute check constraint holds, nobody
    sleeps."""
    shift = {"m": minutes}
    test_db.execute(text("UPDATE ledger_entries SET created_at = created_at - make_interval(mins => :m) "
                         "WHERE action = 'ADMIN_ACCESS' AND entity_id IN "
                         "(SELECT id::text FROM support_views WHERE ended_at IS NULL)"), shift)
    test_db.execute(text("UPDATE support_views SET started_at = started_at - make_interval(mins => :m), "
                         "expires_at = expires_at - make_interval(mins => :m) WHERE ended_at IS NULL"), shift)
    test_db.commit()


# ── Ported from src/mocks/support.test.ts: start ─────────────────────────────

def test_start_opens_the_firms_reads_read_only_and_logs_it_with_the_admins_name(anonymous_client, world, test_db,
                                                                                accounts):
    admin = world["admin"]
    assert anonymous_client.get("/api/applications", headers=admin).json() == NO_VIEW   # no view yet

    resp = _start(anonymous_client, world)
    assert resp.status_code == 200, resp.text
    session = resp.json()
    assert session["principal"]["kind"] == "platform"
    assert session["principal"]["support"]["firm_id"] == str(world["acme"])
    assert session["principal"]["support"]["reason"] == REASON
    assert session["firm"]["id"] == str(world["acme"])

    apps = anonymous_client.get("/api/applications", headers=admin).json()
    assert [a["id"] for a in apps["applications"]] == [str(world["acme_app"])]      # acme's only, never globex's
    write = anonymous_client.patch(f"/api/applications/{world['acme_app']}", json={"status": "interview"},
                                   headers=admin)
    assert (write.status_code, write.json()) == (403, READ_ONLY)
    assert anonymous_client.get(f"/api/firms/{world['globex']}/ledger", headers=admin).status_code == 404

    view_id = session["principal"]["support"]["id"]
    entry = assert_logged(test_db, action="ADMIN_ACCESS", entity_type="support_view", entity_id=view_id,
                          firm_id=world["acme"], actor_user_id=accounts.admin_id)
    assert (entry.actor_type, entry.actor_name, entry.entity_label) == ("PLATFORM_ADMIN", "Sam Admin", "Acme")
    assert entry.summary == f"Support view started: {REASON}"
    owner_view = anonymous_client.get(f"/api/firms/{world['acme']}/ledger", headers=world["owner"]).text
    assert "admin@benchq.test" not in owner_view                                # the firm never sees the email (A12)


def test_start_needs_a_reason_an_existing_firm_and_a_super_admin(anonymous_client, world):
    short = _start(anonymous_client, world, reason="too short")
    assert (short.status_code, short.json()) == (400, {"detail": "Give a reason of at least 10 characters."})
    assert _start(anonymous_client, world, reason="   padded    ").status_code == 400   # trimmed first
    for firm_id in ("firm_nope", "00000000-0000-0000-0000-000000000000"):
        resp = anonymous_client.post("/api/support-views", json={"firm_id": firm_id, "reason": REASON},
                                     headers=world["admin"])
        assert (resp.status_code, resp.json()) == (404, {"detail": "Not found."})
    by_owner = anonymous_client.post("/api/support-views", json={"firm_id": str(world["globex"]), "reason": REASON},
                                     headers=world["owner"])
    assert (by_owner.status_code, by_owner.json()) == (403, {"detail": "Platform admins only."})
    assert anonymous_client.delete("/api/support-views/current", headers=world["owner"]).status_code == 403


def test_signed_out_is_401(anonymous_client, world):
    assert anonymous_client.post("/api/support-views", json={"firm_id": str(world["acme"]),
                                                             "reason": REASON}).status_code == 401
    assert anonymous_client.delete("/api/support-views/current").status_code == 401


def test_a_suspended_firm_and_an_onboarding_firm_with_no_users_can_be_viewed(anonymous_client, world):
    """07 Q29. A suspended firm's own users stay refused; a view of it reads."""
    assert _start(anonymous_client, world, "suspended").json()["principal"]["support"]["firm_id"] == \
        str(world["suspended"])
    assert anonymous_client.get(f"/api/firms/{world['suspended']}/members", headers=world["admin"]).status_code == 200

    assert _start(anonymous_client, world, "onboarding").json()["principal"]["support"]["firm_id"] == \
        str(world["onboarding"])
    assert anonymous_client.get(f"/api/firms/{world['onboarding']}/members", headers=world["admin"]).json() == []
    assert anonymous_client.get("/api/applications", headers=world["admin"]).json()["applications"] == []


# ── Ported: one at a time, exit, expiry, sign-out ───────────────────────────

def test_starting_a_view_of_firm_b_ends_firm_as_first_both_logged_in_their_own_firm(anonymous_client, world,
                                                                                     test_db):
    first = _start(anonymous_client, world).json()["principal"]["support"]["id"]
    second = _start(anonymous_client, world, "globex", "Checking the plan change today").json()
    assert second["principal"]["support"]["firm_id"] == str(world["globex"])

    end = assert_logged(test_db, action="ADMIN_ACCESS_END", entity_type="support_view", entity_id=first,
                        firm_id=world["acme"])
    assert end.summary == "Support view ended: another support view started"
    start = assert_logged(test_db, action="ADMIN_ACCESS", entity_type="support_view",
                          entity_id=second["principal"]["support"]["id"], firm_id=world["globex"])
    assert start.summary == "Support view started: Checking the plan change today"
    assert anonymous_client.get(f"/api/firms/{world['acme']}/ledger", headers=world["admin"]).status_code == 404
    assert test_db.query(SupportView).filter(SupportView.ended_at.is_(None)).count() == 1


def test_starting_the_same_firm_again_ends_and_restarts_it_never_extends(anonymous_client, world, test_db):
    """Q20: to continue, start a new view with a new reason."""
    first = _start(anonymous_client, world).json()["principal"]["support"]
    second = _start(anonymous_client, world, reason="A second look at the same issue").json()["principal"]["support"]
    assert second["id"] != first["id"]
    assert second["reason"] == "A second look at the same issue"
    assert len(_ledger(test_db, action="ADMIN_ACCESS", firm_id=world["acme"])) == 2
    assert len(_ledger(test_db, action="ADMIN_ACCESS_END", firm_id=world["acme"])) == 1


def test_exit_logs_the_end_returns_the_firm_to_go_back_to_and_closes_it(anonymous_client, world, test_db):
    view_id = _start(anonymous_client, world).json()["principal"]["support"]["id"]
    body = _exit(anonymous_client, world).json()
    assert body["firm_id"] == str(world["acme"])
    assert body["session"]["principal"] == {**body["session"]["principal"], "kind": "platform", "support": None}
    assert body["session"]["firm"] is None
    end = assert_logged(test_db, action="ADMIN_ACCESS_END", entity_type="support_view", entity_id=view_id,
                        firm_id=world["acme"])
    assert (end.summary, end.entity_label, end.actor_name) == ("Support view ended", "Acme", "Sam Admin")
    assert anonymous_client.get("/api/applications", headers=world["admin"]).json() == NO_VIEW


def test_exit_with_no_view_open_is_not_an_error(anonymous_client, world, test_db):
    body = _exit(anonymous_client, world).json()
    assert body["firm_id"] is None
    assert body["session"]["principal"]["support"] is None
    assert _ledger(test_db, action="ADMIN_ACCESS_END") == []


def test_sixty_minutes_no_extension_then_closed_and_the_end_logged_at_the_expiry(anonymous_client, world, test_db):
    started = _start(anonymous_client, world).json()["principal"]["support"]
    view = test_db.get(SupportView, started["id"])
    assert view.expires_at - view.started_at == timedelta(minutes=60)

    _expire(test_db)
    assert anonymous_client.get("/api/applications", headers=world["admin"]).json() == NO_VIEW
    me = anonymous_client.get("/api/auth/me", headers=world["admin"]).json()
    assert me["principal"]["support"] is None

    test_db.expire_all()
    view = test_db.get(SupportView, started["id"])
    end = assert_logged(test_db, action="ADMIN_ACCESS_END", entity_type="support_view", entity_id=view.id,
                        firm_id=world["acme"])
    assert end.summary == "Support view ended after 60 minutes"
    assert end.created_at == view.expires_at == view.ended_at


def test_signing_out_ends_the_view_and_it_doesnt_come_back_on_the_next_sign_in(anonymous_client, world, test_db):
    view_id = _start(anonymous_client, world).json()["principal"]["support"]["id"]
    assert anonymous_client.post("/api/auth/sign-out", headers=world["admin"]).status_code == 204
    end = assert_logged(test_db, action="ADMIN_ACCESS_END", entity_type="support_view", entity_id=view_id,
                        firm_id=world["acme"])
    assert (end.summary, end.entity_label) == ("Support view ended: signed out", "Acme")

    resp = anonymous_client.post("/api/auth/sign-in", json={"email": "admin@benchq.test", "password": TEST_PASSWORD})
    assert resp.json()["principal"]["support"] is None


def test_the_view_lasts_across_requests(anonymous_client, world):
    """The mock's "survives a reload": the view is on the session row, so every request rebuilds it."""
    _start(anonymous_client, world)
    for _ in range(2):
        me = anonymous_client.get("/api/auth/me", headers=world["admin"]).json()
        assert me["principal"]["support"]["firm_id"] == str(world["acme"])


# ── Reads in, writes out, other firms 404 ───────────────────────────────────

@pytest.mark.parametrize("path", [
    "/api/firms/{acme}/ledger", "/api/firms/{acme}/members", "/api/firms/{acme}/invites", "/api/applications",
    "/api/resumes", "/api/resumes/{resume}", "/api/jobs", "/api/cover-letters", "/api/stats", "/api/companies",
])
def test_the_viewed_firms_reads_answer(anonymous_client, world, path):
    _start(anonymous_client, world)
    resp = anonymous_client.get(path.format(**world), headers=world["admin"])
    assert resp.status_code == 200, resp.text


@pytest.mark.parametrize("method, path", [
    ("PATCH", "/api/applications/{acme_app}"),
    ("DELETE", "/api/applications/{acme_app}"),
    ("POST", "/api/applications"),
    ("POST", "/api/applications/bulk-update"),
    ("PATCH", "/api/resumes/{resume}"),
    ("DELETE", "/api/resumes/{resume}"),
    ("POST", "/api/resumes"),
    ("POST", "/api/jobs/manual"),
    ("POST", "/api/firms/{acme}/invites"),
    ("POST", "/api/auth/first-run-done"),
    ("PATCH", "/api/persona"),
    ("GET", "/api/resumes/{resume}/pdf"),           # acts rather than reads: no exports in a view (07 §4)
    ("GET", "/api/cover-letters/{resume}/pdf"),
])
def test_every_write_and_every_export_is_refused_inside_a_view(anonymous_client, world, method, path):
    _start(anonymous_client, world)
    resp = anonymous_client.request(method, path.format(**world), json={}, headers=world["admin"])
    assert (resp.status_code, resp.json()) == (403, READ_ONLY)


@pytest.mark.parametrize("path", ["/api/firms/{globex}/ledger", "/api/firms/{globex}/members",
                                  "/api/firms/{globex}/invites"])
def test_another_firms_path_is_404_inside_a_view(anonymous_client, world, path):
    _start(anonymous_client, world)
    assert anonymous_client.get(path.format(**world), headers=world["admin"]).status_code == 404


def test_rows_of_another_firm_stay_hidden_inside_a_view(anonymous_client, world):
    _start(anonymous_client, world)
    assert anonymous_client.get(f"/api/applications/{world['globex_app']}/prep",
                                headers=world["admin"]).status_code == 404


def test_the_second_check_refuses_a_write_even_past_the_middleware(world, test_db, accounts):
    """`reader_firm_id` gives a view its firm on GET only, so a write route that takes it refuses on its own."""
    import uuid

    from fastapi import HTTPException
    from starlette.requests import Request

    from backend.auth.scoping import reader_firm_id
    from backend.auth.sessions import Principal

    view = Principal(kind="platform", user_id=accounts.admin_id, session_id=uuid.uuid4(), role="PLATFORM_ADMIN",
                     support_view_id=uuid.uuid4(), support_firm_id=world["acme"])
    request = lambda method: Request({"type": "http", "method": method, "path": "/", "headers": []})
    assert reader_firm_id(request("GET"), view) == world["acme"]
    for method in ("POST", "PATCH", "PUT", "DELETE", "HEAD"):
        with pytest.raises(HTTPException) as refused:
            reader_firm_id(request(method), view)
        assert (refused.value.status_code, refused.value.detail) == (403, READ_ONLY["detail"])


def test_a_firm_user_and_a_super_admin_without_a_view_are_unchanged(anonymous_client, world):
    assert anonymous_client.get("/api/applications", headers=world["owner"]).status_code == 200
    assert anonymous_client.patch(f"/api/applications/{world['acme_app']}", json={"notes": "x"},
                                  headers=world["owner"]).status_code == 200
    assert anonymous_client.get("/api/applications", headers=world["admin"]).json() == NO_VIEW
    assert anonymous_client.get(f"/api/firms/{world['acme']}/members", headers=world["admin"]).json() == NO_VIEW


def test_a_view_belongs_to_the_session_that_started_it(anonymous_client, world, test_db, accounts):
    """The admin's other browser is a plain Super Admin; starting a view there ends this one."""
    from backend.auth.sessions import start_session
    from backend.models.tenancy import PlatformUser
    other_token, _ = start_session(test_db, test_db.get(PlatformUser, accounts.admin_id))
    test_db.commit()
    other = _cookie(other_token)

    first = _start(anonymous_client, world).json()["principal"]["support"]["id"]
    assert anonymous_client.get("/api/auth/me", headers=other).json()["principal"]["support"] is None
    assert anonymous_client.post("/api/support-views", json={"firm_id": str(world["globex"]), "reason": REASON},
                                 headers=other).status_code == 200
    assert anonymous_client.get("/api/auth/me", headers=world["admin"]).json()["principal"]["support"] is None
    test_db.expire_all()
    assert test_db.query(Session).filter(Session.support_view_id == first).count() == 0


# ── Every way a session ends ends its view ──────────────────────────────────

def test_signing_in_as_someone_else_in_the_same_browser_ends_the_view(anonymous_client, world, test_db):
    view_id = _start(anonymous_client, world).json()["principal"]["support"]["id"]
    resp = anonymous_client.post("/api/auth/sign-in", json={"email": "owner@acme.test", "password": TEST_PASSWORD},
                                 headers=world["admin"])
    assert resp.status_code == 200
    end = assert_logged(test_db, action="ADMIN_ACCESS_END", entity_type="support_view", entity_id=view_id,
                        firm_id=world["acme"])
    assert end.summary == "Support view ended: signed out"


def test_accepting_an_invite_in_the_same_browser_ends_the_view(anonymous_client, api_client, world, test_db):
    invite = api_client.post("/api/admin/firms", json={
        "name": "Northwind Staffing", "slug": "northwind", "plan_id": str(test_db.get(Firm, world["acme"]).plan_id),
        "owner_name": "Nora", "owner_email": "nora@northwind.test"}).json()
    view_id = _start(anonymous_client, world).json()["principal"]["support"]["id"]
    resp = anonymous_client.post(f"/api/invites/{invite['invite_token']}/accept",
                                 json={"name": "Nora North", "password": "a-strong-pass"}, headers=world["admin"])
    assert resp.status_code == 200, resp.text
    end = assert_logged(test_db, action="ADMIN_ACCESS_END", entity_type="support_view", entity_id=view_id,
                        firm_id=world["acme"])
    assert end.summary == "Support view ended: signed out"


def test_a_password_reset_ends_the_view(anonymous_client, world, test_db):
    from backend.scripts.reset_password import reset_password
    view_id = _start(anonymous_client, world).json()["principal"]["support"]["id"]
    reset_password(test_db, email="admin@benchq.test", password="a-new-password")
    end = assert_logged(test_db, action="ADMIN_ACCESS_END", entity_type="support_view", entity_id=view_id,
                        firm_id=world["acme"])
    assert end.summary == "Support view ended: signed out"
    assert test_db.get(SupportView, view_id).ended_at is not None


# ── Expiry is settled once, wherever it is noticed ──────────────────────────

def test_the_firms_own_ledger_read_settles_an_expired_view(anonymous_client, world, test_db):
    """The admin never comes back; the OWNER reading the ledger still sees the end."""
    view_id = _start(anonymous_client, world).json()["principal"]["support"]["id"]
    _expire(test_db)
    entries = anonymous_client.get(f"/api/firms/{world['acme']}/ledger", headers=world["owner"]).json()
    assert [e["summary"] for e in entries if e["entity_id"] == view_id] == [
        "Support view ended after 60 minutes", f"Support view started: {REASON}"]


def test_the_admin_audit_read_settles_an_expired_view(anonymous_client, api_client, world, test_db):
    view_id = _start(anonymous_client, world).json()["principal"]["support"]["id"]
    _expire(test_db)
    audit = api_client.get("/api/admin/audit").json()
    assert any(e["action"] == "ADMIN_ACCESS_END" and e["entity_id"] == view_id for e in audit)


def test_an_expired_view_is_logged_once_however_often_it_is_noticed(anonymous_client, world, test_db):
    view_id = _start(anonymous_client, world).json()["principal"]["support"]["id"]
    _expire(test_db)
    for _ in range(3):
        anonymous_client.get("/api/auth/me", headers=world["admin"])
        anonymous_client.get(f"/api/firms/{world['acme']}/ledger", headers=world["owner"])
    _exit(anonymous_client, world)
    assert_logged(test_db, action="ADMIN_ACCESS_END", entity_type="support_view", entity_id=view_id,
                  firm_id=world["acme"])


def test_a_view_that_expired_then_signed_out_is_logged_as_expired(anonymous_client, world, test_db):
    view_id = _start(anonymous_client, world).json()["principal"]["support"]["id"]
    _expire(test_db)
    anonymous_client.post("/api/auth/sign-out", headers=world["admin"])
    end = assert_logged(test_db, action="ADMIN_ACCESS_END", entity_type="support_view", entity_id=view_id,
                        firm_id=world["acme"])
    assert end.summary == "Support view ended after 60 minutes"


def test_two_starts_at_once_never_leave_two_views_open(anonymous_client, world, test_db):
    """Start locks the admin's row, so a double click is two starts in a row, both answered, never a 500."""
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda key: _start(anonymous_client, world, key), ["acme", "globex"]))
    assert [r.status_code for r in results] == [200, 200]
    test_db.expire_all()
    assert test_db.query(SupportView).filter(SupportView.ended_at.is_(None)).count() == 1
    assert len(_ledger(test_db, action="ADMIN_ACCESS")) == 2
    assert len(_ledger(test_db, action="ADMIN_ACCESS_END")) == 1
