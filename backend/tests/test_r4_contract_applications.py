"""R4-T1 · /api/applications contract: bad input, the retired hand log, status order.

The status machine is the interesting part: every application is a candidate's since migration 0025, so a move is the
candidate status command (`backend/applications/tracking.py`), whose transitions drive the Stats funnel + Sankey: an
out-of-order or backwards move writes a real edge into the chart.
"""
import pytest

from backend.tests.firm_support import default_firm_id
from backend.tests.r4_support import (  # noqa: F401
    client, _clear_running_state, _no_outbound, assert_clean, assert_no_leak,
    make_job, big_string, EMOJI, MISSING_UUID,
)

# ── POST /api/applications ───────────────────────────────────────────────────
# Logging a job with no candidate (the old pool's hand log) is retired (the add-job plan, 2026-11-11): its body is still
# read, so an old client gets 410 and the reason, never a 500 and never a row. Adding a job for a candidate is
# test_applications_on_postings.py's.

@pytest.mark.parametrize("body", [
    {}, {"title": "T"}, {"title": "T", "company": "C"},
    {"company": "C", "url": "u"}, {"title": "T", "url": "u"},
    {"title": None, "company": "C", "url": "u"},
    {"title": "", "company": "", "url": ""},
    {"title": EMOJI, "company": "Señor 中文", "url": "https://x.com/jobs/1"},
    {"title": "T", "company": "C", "url": "https://x.com/1?utm_source=li#top", "status": "banana",
     "applied_at": "2026-13-45", "id": MISSING_UUID, "status_transitions": [{"from": "offer", "to": "applied"}]},
])
def test_the_retired_hand_log_is_410_and_writes_nothing(client, test_db, body):
    from backend.models.db import Application, Job
    r = assert_clean(client.post("/api/applications", json=body), 410)
    assert "retired" in r.json()["detail"]
    assert test_db.query(Application).count() == 0
    assert test_db.query(Job).count() == 0


@pytest.mark.parametrize("body", [
    {"title": 5, "company": "C", "url": "u"},
    {"title": ["T"], "company": "C", "url": "u"},
])
def test_create_application_wrong_field_types_are_422(client, body):
    assert_clean(client.post("/api/applications", json=body), 422)


def test_create_application_ten_megabyte_notes(client):
    r = client.post("/api/applications", json={
        "title": "T", "company": "C", "url": "https://x.com/big", "notes": big_string(10),
    })
    assert_clean(r, 200, 400, 413, 422)


@pytest.mark.parametrize("body", [[1, 2], "hi", 5, None])
def test_create_application_non_object_body_is_422(client, body):
    assert_clean(client.post("/api/applications", json=body), 422)


# ── PATCH /api/applications/{id} ─────────────────────────────────────────────

def _app_id(client):
    """A candidate's Applied application on a posting of theirs (what an application is since migration 0025), with
    its first funnel edge."""
    from backend.models.db import Application, SessionLocal, utcnow
    from backend.tests.posting_support import posting_for
    from backend.tests.r4_support import make_resume
    db = SessionLocal()
    try:
        candidate_id = make_resume(db, name="Contract candidate").candidate_id
        firm_id = default_firm_id(db)
        posting = posting_for(db, firm_id, candidate_id, title="Senior PM", company="Acme", url="https://x.com/jobs/1")
        app = Application(firm_id=firm_id, candidate_id=candidate_id, job_id=posting.id, status="applied",
                          status_transitions=[{"from": None, "to": "applied", "at": utcnow().isoformat(),
                                               "source": "ui"}])
        db.add(app)
        db.commit()
        return str(app.id)
    finally:
        db.close()


def _move(client, aid, status, revision):
    """The candidate status command: a move names the revision it was decided on."""
    return client.patch(f"/api/applications/{aid}", json={"status": status, "expected_revision": revision})


def test_patch_application_missing_id_is_404(client):
    assert_clean(client.patch(f"/api/applications/{MISSING_UUID}", json={"notes": "x"}), 404)


@pytest.mark.parametrize("bad", ["banana", "", "APPLIED", "Applied", 5, None])
def test_patch_application_rejects_an_unknown_status(client, bad):
    aid = _app_id(client)
    assert_clean(client.patch(f"/api/applications/{aid}", json={"status": bad}), 400)


@pytest.mark.parametrize("bad", [["applied"], {"to": "applied"}])
def test_patch_application_rejects_an_unhashable_status(client, bad):
    """A list or object status is a 400, not a TypeError (R4-T1-16): the candidate status command checks its type."""
    aid = _app_id(client)
    assert client.patch(f"/api/applications/{aid}", json={"status": bad}).status_code == 400


def test_patch_application_unknown_status_error_says_so(client):
    aid = _app_id(client)
    r = _move(client, aid, "banana", 0)
    assert r.json()["detail"] == "Unsupported candidate application status."


def test_patch_application_forward_transition_records_an_edge(client, test_db):
    from backend.models.db import Application
    aid = _app_id(client)
    assert_clean(_move(client, aid, "interview_scheduled", 0), 200)
    app = test_db.query(Application).filter(Application.id == aid).first()
    test_db.refresh(app)
    assert app.status == "interview_scheduled"
    assert app.status_transitions[-1]["from"] == "applied"
    assert app.status_transitions[-1]["to"] == "interview_scheduled"


def test_patch_application_same_status_twice_records_one_edge(client, test_db):
    from backend.models.db import Application
    aid = _app_id(client)
    _move(client, aid, "interview_scheduled", 0)
    _move(client, aid, "interview_scheduled", 1)
    app = test_db.query(Application).filter(Application.id == aid).first()
    test_db.refresh(app)
    assert len(app.status_transitions) == 2   # seed edge + one move


def test_patch_application_backwards_transition_is_allowed_and_logged(client, test_db):
    """Current contract: the funnel has no ordering guard — offer -> applied is legal."""
    from backend.models.db import Application
    aid = _app_id(client)
    _move(client, aid, "offer", 0)
    assert_clean(_move(client, aid, "applied", 1), 200)
    app = test_db.query(Application).filter(Application.id == aid).first()
    test_db.refresh(app)
    last = app.status_transitions[-1]
    assert {key: last[key] for key in ("from", "to", "source")} == {"from": "offer", "to": "applied", "source": "ui"}
    assert last["at"]


def test_patch_application_out_of_order_skips_a_stage(client, test_db):
    """applied -> offer with no interview: allowed, and one edge, not two."""
    from backend.models.db import Application
    aid = _app_id(client)
    _move(client, aid, "offer", 0)
    app = test_db.query(Application).filter(Application.id == aid).first()
    test_db.refresh(app)
    assert [t["to"] for t in app.status_transitions] == ["applied", "offer"]


@pytest.mark.xfail(strict=True, reason="R4-T1-15")
def test_patch_application_cannot_leave_a_terminal_rejected_state_silently(client):
    """Reviving a closed application should be an explicit reopen, not a plain PATCH.

    Today it just writes a move_on -> interview_scheduled edge into the Sankey.
    """
    aid = _app_id(client)
    _move(client, aid, "move_on", 0)
    r = _move(client, aid, "interview_scheduled", 1)
    assert r.status_code == 409


def test_patch_application_refuses_keys_outside_the_status_command(client, test_db):
    """A candidate's application changes only through its status command or its notes: any other key is a 400, and
    nothing is written."""
    from backend.models.db import Application
    aid = _app_id(client)
    assert_clean(client.patch(f"/api/applications/{aid}",
                             json={"job_id": MISSING_UUID, "id": MISSING_UUID,
                                   "status_transitions": [], "notes": "kept"}), 400)
    app = test_db.query(Application).filter(Application.id == aid).first()
    test_db.refresh(app)
    assert app.notes is None
    assert str(app.id) == aid
    assert app.status_transitions != []


def test_patch_application_empty_body_is_a_noop_200(client):
    aid = _app_id(client)
    assert_clean(client.patch(f"/api/applications/{aid}", json={}), 200)


@pytest.mark.parametrize("body", [[1], "x", 3, None])
def test_patch_application_non_object_body_is_422(client, body):
    aid = _app_id(client)
    assert_clean(client.patch(f"/api/applications/{aid}", json=body), 422)


def test_patch_application_ten_megabyte_notes(client):
    aid = _app_id(client)
    r = client.patch(f"/api/applications/{aid}", json={"notes": big_string(10)})
    assert_clean(r, 200, 400, 413, 422)


# ── DELETE /api/applications/{id} ────────────────────────────────────────────

def test_delete_application_missing_id_is_404(client):
    assert_clean(client.delete(f"/api/applications/{MISSING_UUID}"), 404)


def test_delete_application_is_refused_for_a_candidates_application(client, test_db):
    """A candidate's application leaves through Saved (unfavorite) or a status move, never a delete."""
    from backend.models.db import Application
    aid = _app_id(client)
    assert_clean(client.delete(f"/api/applications/{aid}"), 409)
    assert_clean(client.delete(f"/api/applications/{aid}"), 409)
    assert test_db.query(Application).filter(Application.id == aid).count() == 1


# ── Listing ──────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("qs,expected", [
    ("", 200), ("status=applied", 200), ("status=zzz", 200),
    ("limit=1", 200), ("limit=2000", 200), ("limit=2001", 422),
    ("offset=0", 200), ("offset=-1", 422), ("limit=abc", 422),
])
def test_list_applications_query_contract(client, qs, expected):
    assert_clean(client.get(f"/api/applications?{qs}"), expected)


def test_list_applications_rejects_negative_limit(client):
    assert client.get("/api/applications?limit=-5").status_code == 422


# ── Interviews ───────────────────────────────────────────────────────────────

def test_add_interview_missing_application_is_404(client):
    assert_clean(client.post(f"/api/applications/{MISSING_UUID}/interviews",
                             json={"what": "Screen"}), 404)


def test_add_interview_requires_what(client):
    aid = _app_id(client)
    assert_clean(client.post(f"/api/applications/{aid}/interviews", json={}), 422)


def test_add_interview_then_patch_and_delete(client):
    aid = _app_id(client)
    r = assert_clean(client.post(f"/api/applications/{aid}/interviews",
                                json={"what": "Screen"}), 201)
    iid = r.json()["id"]
    assert_clean(client.patch(f"/api/applications/interviews/{iid}", json={"what": EMOJI}), 200)
    assert_clean(client.delete(f"/api/applications/interviews/{iid}"), 200)
    assert_clean(client.delete(f"/api/applications/interviews/{iid}"), 404)


def test_patch_missing_interview_is_404(client):
    assert_clean(client.patch(f"/api/applications/interviews/{MISSING_UUID}",
                              json={"what": "x"}), 404)


def test_add_interview_bad_when_at_never_500(client):
    aid = _app_id(client)
    r = client.post(f"/api/applications/{aid}/interviews",
                    json={"what": "Screen", "when_at": "not-a-date"})
    assert_clean(r, 201, 400, 422)


# ── Prep bundle + extract ────────────────────────────────────────────────────

def test_prep_bundle_missing_application_is_404(client):
    assert_clean(client.get(f"/api/applications/{MISSING_UUID}/prep"), 404)


@pytest.mark.parametrize("url", ["", "not a url", "ftp://x", "javascript:alert(1)",
                                 "http://127.0.0.1:5432/", "http://169.254.169.254/"])
def test_extract_refuses_or_fails_cleanly_on_hostile_urls(client, url):
    r = client.post("/api/applications/extract", json={"url": url})
    assert_clean(r, 200, 400, 403, 422, 502)


def test_extract_requires_a_url_field(client):
    assert_clean(client.post("/api/applications/extract", json={}), 422)


# ── R4 fix-loop regression (R4-T1-07) ────────────────────────────────────────

@pytest.mark.parametrize("qs", ["limit=-5", "limit=-1"])
def test_list_applications_negative_limit_is_422(client, qs):
    assert_clean(client.get(f"/api/applications?{qs}"), 422)
