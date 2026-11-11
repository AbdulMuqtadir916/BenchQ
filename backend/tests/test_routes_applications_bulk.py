"""Tests for POST /api/applications/bulk-update and /bulk-delete.

The Applications screen's selection bar moves or deletes a whole batch in one
call. Both endpoints must behave exactly like the single-row paths they stand in
for (the candidate status command, source "ui"; a candidate's application is
never deleted) and must answer 400 — never 500 — for any malformed body.
"""
import uuid

from backend.models.db import Application, Interview
import pytest
from backend.models.tenancy import DEFAULT_FIRM_ID

pytestmark = pytest.mark.usefixtures("jobs_in_default_firm")


def _make_app(test_db, title="Bulk Role", status="applied", company="Bulk Co"):
    """One candidate's application on a posting of theirs (every application is one since migration 0025),
    committed; returns the Application."""
    from backend.tests.posting_support import posting_for
    from backend.tests.resume_support import make_version
    candidate_id = make_version(test_db, DEFAULT_FIRM_ID).candidate_id
    posting = posting_for(test_db, DEFAULT_FIRM_ID, candidate_id, title=title, company=company,
                          url=f"https://example.com/{uuid.uuid4().hex}")
    app = Application(firm_id=DEFAULT_FIRM_ID, candidate_id=candidate_id, job_id=posting.id, status=status,
                      status_transitions=[])
    test_db.add(app)
    test_db.commit()
    return app


def _revisions(*apps):
    """What the selection bar sends with a move: each row's status revision as the screen last read it."""
    return {str(app.id): app.status_revision for app in apps}


# ── bulk-update ──────────────────────────────────────────────────────────────
def test_bulk_update_moves_every_row(api_client, test_db):
    """Happy path: two applied rows → interview scheduled, both counted as updated."""
    a = _make_app(test_db, "Bulk A")
    b = _make_app(test_db, "Bulk B")
    resp = api_client.post("/api/applications/bulk-update",
                           json={"ids": [str(a.id), str(b.id)], "status": "interview_scheduled",
                                 "expected_revisions": _revisions(a, b)})
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"updated": 2, "skipped": 0, "not_found": []}
    test_db.expire_all()
    assert test_db.query(Application).filter(Application.id == a.id).first().status == "interview_scheduled"
    assert test_db.query(Application).filter(Application.id == b.id).first().status == "interview_scheduled"


def test_bulk_update_skips_a_row_already_in_that_status(api_client, test_db):
    """A row already in the target status is skipped, not re-transitioned: it was only caught in the selection."""
    a = _make_app(test_db, "Bulk Applied", status="applied")
    b = _make_app(test_db, "Bulk Interview", status="interview_scheduled")
    before = len(b.status_transitions or [])
    resp = api_client.post("/api/applications/bulk-update",
                           json={"ids": [str(a.id), str(b.id)], "status": "interview_scheduled",
                                 "expected_revisions": _revisions(a, b)})
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"updated": 1, "skipped": 1, "not_found": []}
    test_db.expire_all()
    kept = test_db.query(Application).filter(Application.id == b.id).first()
    assert len(kept.status_transitions or []) == before, "a row already there logged a transition"
    assert kept.status_revision == 0


def test_bulk_update_records_transitions_with_ui_source(api_client, test_db):
    """Every move goes through the candidate status command, like the single-row PATCH."""
    a = _make_app(test_db, "Bulk Transitions", status="applied")
    resp = api_client.post("/api/applications/bulk-update",
                           json={"ids": [str(a.id)], "status": "offer", "expected_revisions": _revisions(a)})
    assert resp.status_code == 200, resp.text
    test_db.expire_all()
    row = test_db.query(Application).filter(Application.id == a.id).first()
    last = (row.status_transitions or [])[-1]
    assert last["from"] == "applied" and last["to"] == "offer"
    assert last["source"] == "ui" and last.get("at")


def test_bulk_update_rejects_unknown_status(api_client, test_db):
    """An unknown stage is a 400 with the valid set named — never a 500."""
    a = _make_app(test_db, "Bulk Bad Status")
    resp = api_client.post("/api/applications/bulk-update",
                           json={"ids": [str(a.id)], "status": "ghosted"})
    assert resp.status_code == 400, resp.text
    assert "status must be one of" in resp.json().get("detail", "")
    test_db.expire_all()
    assert test_db.query(Application).filter(Application.id == a.id).first().status == "applied"


def test_bulk_update_rejects_missing_or_non_string_status(api_client, test_db):
    """No status, and a status of the wrong shape, are both 400s."""
    a = _make_app(test_db, "Bulk No Status")
    assert api_client.post("/api/applications/bulk-update",
                           json={"ids": [str(a.id)]}).status_code == 400
    assert api_client.post("/api/applications/bulk-update",
                           json={"ids": [str(a.id)], "status": ["interview"]}).status_code == 400


def test_bulk_update_rejects_non_list_ids(api_client, test_db):
    """`ids` of the wrong shape is a 400, not an iteration crash."""
    resp = api_client.post("/api/applications/bulk-update",
                           json={"ids": "not-a-list", "status": "interview"})
    assert resp.status_code == 400, resp.text
    assert "ids must be a list" in resp.json().get("detail", "")


def test_bulk_update_reports_bad_and_missing_ids_without_aborting(api_client, test_db):
    """A malformed id and an unknown one land in not_found; the real row still moves."""
    a = _make_app(test_db, "Bulk Survivor")
    ghost = str(uuid.uuid4())
    resp = api_client.post("/api/applications/bulk-update",
                           json={"ids": ["not-a-uuid", ghost, str(a.id)], "status": "interview_scheduled",
                                 "expected_revisions": _revisions(a)})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["updated"] == 1
    assert set(body["not_found"]) == {"not-a-uuid", ghost}
    test_db.expire_all()
    assert test_db.query(Application).filter(Application.id == a.id).first().status == "interview_scheduled"


def test_bulk_update_empty_ids_is_a_no_op(api_client, test_db):
    """An empty selection answers zeroes rather than touching anything."""
    resp = api_client.post("/api/applications/bulk-update", json={"ids": [], "status": "rejected"})
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"updated": 0, "skipped": 0, "not_found": []}


# ── bulk-delete ──────────────────────────────────────────────────────────────
def test_bulk_delete_refuses_candidate_applications_and_deletes_nothing(api_client, test_db):
    """A candidate's application leaves through Saved (unfavorite) or a status move, never a delete. The batch is
    checked whole before anything goes, so no row and no interview is lost."""
    a = _make_app(test_db, "Bulk Del A")
    b = _make_app(test_db, "Bulk Del B")
    a_id, b_id = a.id, b.id
    test_db.add(Interview(firm_id=DEFAULT_FIRM_ID, application_id=a_id, what="Screen"))
    test_db.commit()

    resp = api_client.post("/api/applications/bulk-delete", json={"ids": [str(a_id), str(b_id)]})
    assert resp.status_code == 409, resp.text
    test_db.expire_all()
    assert test_db.query(Application).filter(Application.id.in_([a_id, b_id])).count() == 2
    assert test_db.query(Interview).filter(Interview.application_id == a_id).count() == 1


def test_bulk_delete_reports_bad_ids(api_client, test_db):
    """Same not_found contract as bulk-update."""
    ghost = str(uuid.uuid4())
    resp = api_client.post("/api/applications/bulk-delete", json={"ids": ["nope", ghost]})
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"deleted": 0, "not_found": ["nope", ghost]}


def test_bulk_delete_rejects_non_list_ids(api_client, test_db):
    """A malformed body is a 400 here too."""
    resp = api_client.post("/api/applications/bulk-delete", json={"ids": {"id": 1}})
    assert resp.status_code == 400, resp.text
