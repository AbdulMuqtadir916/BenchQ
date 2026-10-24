"""F7: firm data never crosses firms, on any route (docs/integration/07-auth-and-tenancy.md F7).

Ports src/mocks/membership.test.ts and write-authorization.test.ts to the backend. The routes come from the app
itself, so a new endpoint is covered by default: a FIRM route needs a case in backend/tests/isolation_cases.py (or
a known gap there), and every other route needs its class's reason. For each FIRM case:

  firm A's OWNER, with B's ids          404, the same status and body as ids that exist nowhere; B unchanged
  firm A's OWNER, a list or aggregate   none of B's canaries or ids; and A's answer is identical before and
                                        after B's rows exist (a count leak shows there)
  a support view of firm A, B's ids     GET: the same 404; any other method: 403 read-only
  a support view of firm B              GET answers (the PDF exports are 403); any other method: 403
  firm B's OWNER, B's ids               gets through: the write really happens (AI and network stubbed)
  signed out                            401

The OWNER is the widest firm role, so a narrower one can't cross where it can't. Role scope inside a firm (a BDE's
own rows) is each module's own test.
"""
import json
import uuid

import pytest

from backend.auth.access import ROUTE_ACCESS, Access
from backend.tests.isolation_cases import (CASES, DEV_ONLY_REASONS, KNOWN_GAPS, PARAM, PUBLIC_REASONS,
                                           SHARED_JOB_GAPS, SIGNED_IN_CASES, SIGNED_IN_REASONS, Case)
from backend.tests.isolation_support import CANARY, add_firm_b, make_world, offline, snapshot_of  # noqa: F401

READ_ONLY = {"detail": "A support view is read-only."}
SUPPORT_REFUSED_GETS = {"GET /api/resumes/{resume_id}/pdf", "GET /api/cover-letters/{cl_id}/pdf"}


def _app_routes() -> set[str]:
    """'METHOD /path' of every route the app serves. The API docs' HEAD twins aren't routes anyone calls."""
    from backend.main import app
    keys = set()
    for route in app.router.routes:
        for method in getattr(route, "methods", None) or ():
            keys.add(f"{method} {route.path}")
    return {key for key in keys if not (key.startswith("HEAD ") and f"GET {key[5:]}" in keys)}


ROUTES = _app_routes()
FIRM = sorted(key for key in ROUTES if ROUTE_ACCESS.get(key) is Access.FIRM)
PLATFORM = sorted(key for key in ROUTES if ROUTE_ACCESS.get(key) is Access.PLATFORM)


@pytest.fixture
def world(test_db, accounts, offline):
    return make_world(test_db, accounts)


def _call(client, key: str, case: Case, ids: dict, headers: dict | None):
    method, template = key.split(" ", 1)
    params = {name: str(ids[case.path.get(name, PARAM.get(name, name))])
              for name in PARAM if "{" + name + "}" in template}
    path = template.format(**params)
    kwargs = {"headers": headers or {}}
    if case.upload:
        kwargs["files"] = {"file": ("resume.pdf", b"%PDF-1.4 isolation", "application/pdf")}
    elif case.body is not None:
        kwargs["json"] = case.body(ids)
    elif method != "GET":
        kwargs["json"] = {}
    return client.request(method, path, **kwargs)


def _has_ids(key: str, case: Case) -> bool:
    return "{" in key.split(" ", 1)[1] or case.body_ids


def _answer(resp, ids: dict) -> tuple:
    """Status and body, with the request's own ids blanked (a bulk route echoes them in `not_found`)."""
    text = resp.text
    for value in ids.values():
        text = text.replace(str(value), "<id>")
    return resp.status_code, text


def _no_canary(world, resp, who: str, sent: dict | None = None):
    """None of firm B's canaries in the answer, except the ids the request itself sent (a bulk route echoes them in
    `not_found`: the caller's own input, not B's data)."""
    echoed = {str(value) for value in (sent or {}).values()}
    leaked = [canary for canary in world.canaries() if canary in resp.text and canary not in echoed]
    assert not leaked, f"{who} saw firm B's {leaked} in {resp.status_code} {resp.text[:300]}"


def _start_view(client, world, firm_id):
    resp = client.post("/api/support-views", json={"firm_id": str(firm_id), "reason": "F7 isolation check"},
                       headers=world.admin)
    assert resp.status_code == 200, resp.text


# ── Every route is accounted for ────────────────────────────────────────────

def test_every_route_has_a_class_and_every_firm_route_a_case_or_a_known_gap():
    assert sorted(key for key in ROUTES if key not in ROUTE_ACCESS) == []
    assert sorted(set(FIRM) - set(CASES) - set(KNOWN_GAPS)) == [], "add these to backend/tests/isolation_cases.py"
    assert set(CASES).isdisjoint(KNOWN_GAPS)
    by_class = {access: sorted(k for k in ROUTES if ROUTE_ACCESS.get(k) is access) for access in Access}
    assert by_class[Access.SIGNED_IN] == sorted({*SIGNED_IN_CASES, *SIGNED_IN_REASONS})
    assert by_class[Access.PUBLIC] == sorted(PUBLIC_REASONS)
    assert by_class[Access.DEV_ONLY] == sorted(DEV_ONLY_REASONS)


def test_no_case_reason_or_known_gap_names_a_route_that_is_gone():
    named = {*CASES, *KNOWN_GAPS, *SHARED_JOB_GAPS, *SIGNED_IN_CASES, *SIGNED_IN_REASONS, *PUBLIC_REASONS,
             *DEV_ONLY_REASONS}
    assert sorted(named - ROUTES) == []
    assert set(SHARED_JOB_GAPS) <= set(CASES)
    for gap in [*KNOWN_GAPS.values(), *SHARED_JOB_GAPS.values()]:
        assert gap.reason and gap.removed_by


# ── The matrix, for every FIRM route ────────────────────────────────────────

@pytest.mark.parametrize("key", sorted(CASES))
def test_firm_data_never_crosses_firms(key, anonymous_client, world):
    case, client, method = CASES[key], anonymous_client, key.split(" ", 1)[0]
    has_ids = _has_ids(key, case)

    # A GET answers firm A the same before and after firm B's rows exist: a leak into a count or a chart shows here.
    if method == "GET":
        before = _call(client, key, case, world.a.ids, world.a.cookie)
    b = add_firm_b(world)
    if method == "GET":
        after = _call(client, key, case, world.a.ids, world.a.cookie)
        assert (after.status_code, after.text) == (before.status_code, before.text), \
            "firm A's answer changed when firm B's rows were added"

    missing = world.missing()
    assert _call(client, key, case, b.ids, None).status_code == 401

    # Firm A's OWNER: B's ids are the same as ids that exist nowhere, and nothing of B's changes.
    untouched = snapshot_of(world.db, b.firm_id)
    attack = _call(client, key, case, b.ids, world.a.cookie)
    _no_canary(world, attack, "firm A's OWNER", sent=b.ids if case.bulk else None)
    if has_ids:
        if not case.bulk:
            assert attack.status_code == 404, attack.text
        assert _answer(attack, b.ids) == _answer(_call(client, key, case, missing, world.a.cookie), missing)
    assert snapshot_of(world.db, b.firm_id) == untouched, "firm A's request changed firm B's rows"

    # A support view of firm A: B's ids are as missing there too, and it never writes.
    _start_view(client, world, world.a.firm_id)
    in_a = _call(client, key, case, b.ids, world.admin)
    _no_canary(world, in_a, "a support view of firm A", sent=b.ids if case.bulk else None)
    if method != "GET":
        assert (in_a.status_code, in_a.json()) == (403, READ_ONLY)
    elif key in SUPPORT_REFUSED_GETS:
        assert (in_a.status_code, in_a.json()) == (403, READ_ONLY)
    elif has_ids:
        assert _answer(in_a, b.ids) == _answer(_call(client, key, case, missing, world.admin), missing)

    # A support view of firm B: it reads, and nothing else. (Opening it logs ADMIN_ACCESS in B's ledger: that is the
    # view's own record, so B's rows are taken again once it is open.)
    _start_view(client, world, b.firm_id)
    untouched = snapshot_of(world.db, b.firm_id)
    in_b = _call(client, key, case, b.ids, world.admin)
    if method != "GET" or key in SUPPORT_REFUSED_GETS:
        assert (in_b.status_code, in_b.json()) == (403, READ_ONLY)
    else:
        assert in_b.status_code < 400, in_b.text
    assert snapshot_of(world.db, b.firm_id) == untouched, "a support view changed firm B's rows"

    # Firm B's own OWNER gets through, for real.
    own = _call(client, key, case, b.ids, b.cookie)
    assert own.status_code < 400, own.text
    if case.shows_rows:
        assert CANARY in own.text, "firm B's own answer should list its rows"


def test_reading_a_live_page_in_a_support_view_writes_nothing(anonymous_client, world):
    """live-page warms an uncached job's page as a side effect of a read; a support view only reads (07 §4). The
    matrix's jobs are already cached, so this one isn't."""
    from backend.models.db import Job
    b = add_firm_b(world)
    job = world.db.get(Job, b.ids["job"])
    job.cached_page_html = job.cached_page_text = None
    world.db.commit()
    _start_view(anonymous_client, world, b.firm_id)
    untouched = snapshot_of(world.db, b.firm_id)
    assert anonymous_client.get(f"/api/jobs/{job.id}/live-page", headers=world.admin).status_code == 200
    assert snapshot_of(world.db, b.firm_id) == untouched
    # Control: the firm's own member still warms it.
    assert anonymous_client.get(f"/api/jobs/{job.id}/live-page", headers=b.cookie).status_code == 200
    world.db.expire_all()
    assert world.db.get(Job, job.id).cached_page_html


# ── The other classes ───────────────────────────────────────────────────────

@pytest.mark.parametrize("key", PLATFORM)
def test_a_firm_user_never_reaches_a_platform_route(key, anonymous_client, accounts):
    method, template = key.split(" ", 1)
    path = template
    while "{" in path:
        start, end = path.index("{"), path.index("}")
        path = path[:start] + str(uuid.uuid4()) + path[end + 1:]
    kwargs = {"json": {}} if method != "GET" else {}
    as_firm = anonymous_client.request(method, path, headers={"cookie": f"bq_session={accounts.firm_token}"}, **kwargs)
    assert (as_firm.status_code, as_firm.json()) == (403, {"detail": "Platform admins only."})
    assert anonymous_client.request(method, path, **kwargs).status_code == 401


def test_another_firms_slug_is_the_same_404_as_an_unknown_one(anonymous_client, world):
    b = add_firm_b(world)
    case, missing = SIGNED_IN_CASES["GET /api/firms/by-slug/{slug}"], world.missing()
    attack = _call(anonymous_client, "GET /api/firms/by-slug/{slug}", case, b.ids, world.a.cookie)
    assert attack.status_code == 404
    assert _answer(attack, b.ids) == _answer(
        _call(anonymous_client, "GET /api/firms/by-slug/{slug}", case, missing, world.a.cookie), missing)
    assert _call(anonymous_client, "GET /api/firms/by-slug/{slug}", case, b.ids, b.cookie).status_code == 200


def test_global_companies_count_only_the_callers_firm(anonymous_client, world):
    case = SIGNED_IN_CASES["GET /api/companies"]
    before = _call(anonymous_client, "GET /api/companies", case, world.a.ids, world.a.cookie)
    add_firm_b(world)
    after = _call(anonymous_client, "GET /api/companies", case, world.a.ids, world.a.cookie)
    assert (after.status_code, after.text) == (before.status_code, before.text)
    _no_canary(world, after, "firm A's OWNER")


# ── Known gaps: still there, or the entry must go ───────────────────────────

@pytest.mark.parametrize("key", sorted(SHARED_JOB_GAPS))
def test_a_shared_jobs_status_is_still_one_row_for_both_firms(key, anonymous_client, world):
    """07-auth F4's known gap, until the Jobs track's JobMark (Q36). When this fails, the gap is closed: remove the
    entry from SHARED_JOB_GAPS."""
    b = add_firm_b(world)
    shared = str(world.shared_job)
    seen_by_b = lambda: anonymous_client.get(f"/api/jobs/{shared}", headers=b.cookie).json()["status"]  # noqa: E731
    before = seen_by_b()
    body = {"status": "dismissed"}
    if key.startswith("PATCH"):
        resp = anonymous_client.patch(f"/api/jobs/{shared}", json=body, headers=world.a.cookie)
    else:
        resp = anonymous_client.post("/api/jobs/bulk-update", json={"job_ids": [shared], "updates": body},
                                     headers=world.a.cookie)
    assert resp.status_code < 400, resp.text
    assert seen_by_b() != before, f"{key}: firm A's change no longer shows for firm B; remove it from SHARED_JOB_GAPS"


def test_known_gaps_match_07_auth_f4(world):
    """The Persona routes are exactly the Persona and autofill ones; each names its track."""
    assert sorted(KNOWN_GAPS) == sorted(k for k in FIRM if "/persona" in k or "/autofill" in k)
    assert json.dumps([gap.removed_by for gap in KNOWN_GAPS.values()]).count("D1") == len(KNOWN_GAPS)
