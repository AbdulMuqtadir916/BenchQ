"""Pre-PR regression cases for documented authorization, history and freshness guarantees."""
from datetime import timedelta

import pytest

from backend.models.candidates import CandidateMailbox
from backend.models.db import Application, ApplicationReview, ApplicationStatusEvent, utcnow
from backend.models.tenancy import Firm, LedgerEntry, User
from backend.tests.test_email_application_matching import _case, _email, _run


@pytest.fixture
def case(test_db, accounts, jobs_in_default_firm):
    return _case(test_db, accounts, jobs_in_default_firm)


def _oauth(api_client, test_db, accounts, monkeypatch, candidate, *, address="different@example.test"):
    from backend.api import routes_inbox
    from backend.inbox.google_oauth import Authorization
    state = "synthetic-review-state-1234567890"
    monkeypatch.setattr(routes_inbox, "build_authorization", lambda: Authorization("https://example.test/oauth", state, "verifier", "challenge"))
    monkeypatch.setattr(routes_inbox, "encrypt_secret", lambda value: b"synthetic-encrypted-value")
    monkeypatch.setattr("backend.inbox.google_oauth.decrypt_secret", lambda value: "verifier")
    monkeypatch.setattr(routes_inbox, "exchange_code", lambda code, verifier: (address, "synthetic-refresh"))
    monkeypatch.setattr(routes_inbox, "sync_mailbox", lambda db, mailbox, **kwargs: 0)
    response = api_client.post(f"/api/firms/{candidate.firm_id}/candidates/{candidate.id}/mailbox/oauth",
                              json={"return_to": "/acme/candidates/synthetic?tab=inbox"})
    assert response.status_code == 200
    return state


@pytest.mark.parametrize("change", ["demote_to_viewer", "suspend_firm"])
def test_oauth_callback_rechecks_current_write_authorization(api_client, test_db, accounts, monkeypatch, case, change):
    candidate, _, _, mailbox = case
    state = _oauth(api_client, test_db, accounts, monkeypatch, candidate)
    if change == "demote_to_viewer":
        test_db.get(User, accounts.user_id).role = "VIEWER"
    else:
        test_db.get(Firm, candidate.firm_id).status = "SUSPENDED"
    test_db.commit()
    response = api_client.get("/api/oauth/google/callback", params={"state": state, "code": "synthetic-code"}, follow_redirects=False)
    assert response.status_code == 403, f"callback allowed a now-forbidden write: {response.status_code}"


def test_connected_mailbox_identity_cannot_be_replaced_without_disconnect(api_client, test_db, accounts, monkeypatch, case):
    candidate, _, _, mailbox = case
    original = mailbox.address
    state = _oauth(api_client, test_db, accounts, monkeypatch, candidate)
    api_client.get("/api/oauth/google/callback", params={"state": state, "code": "synthetic-code"}, follow_redirects=False)
    test_db.expire_all()
    assert test_db.get(CandidateMailbox, mailbox.id).address == original


def test_same_status_email_protects_against_older_delayed_classification(test_db, accounts, jobs_in_default_firm, monkeypatch, case):
    _, _, app, mailbox = case
    newer = _email(test_db, mailbox, key="newer-applied", application_id=app.id)
    older = _email(test_db, mailbox, key="older-rejection", application_id=app.id)
    newer.received_at = utcnow() - timedelta(hours=1)
    older.received_at = newer.received_at - timedelta(hours=1)
    test_db.commit()
    assert _run(test_db, monkeypatch, newer, category="applied").outcome == "NO_CHANGE"
    decision = _run(test_db, monkeypatch, older, category="move_on")
    assert app.status == "applied", "older mail overwrote the newer effective state"
    assert decision.outcome == "REVIEW"
    assert test_db.query(ApplicationReview).filter_by(inbox_message_id=older.id, state="PENDING").count() == 1


def test_legacy_deletion_handles_backfilled_status_history(api_client, test_db, accounts, case):
    candidate, job, _, _ = case
    legacy = Application(firm_id=candidate.firm_id, job_id=job.id, status="applied")
    test_db.add(legacy)
    test_db.flush()
    event = ApplicationStatusEvent(firm_id=candidate.firm_id, application_id=legacy.id,
        from_status="applied", to_status="applied", source="legacy", occurred_at=utcnow(), revision=1,
        original_payload={"from": None, "to": "applied", "source": "legacy"})
    test_db.add(event)
    test_db.commit()
    response = api_client.delete(f"/api/applications/{legacy.id}")
    assert response.status_code in {200, 204, 409}, "legacy delete must not fail with an unhandled database error"


def test_viewer_cannot_create_interviews(api_client, test_db, accounts, case):
    _, _, app, _ = case
    test_db.get(User, accounts.user_id).role = "VIEWER"
    test_db.commit()
    response = api_client.post(f"/api/applications/{app.id}/interviews", json={"what": "Synthetic review screen"})
    assert response.status_code == 403, f"viewer interview write returned {response.status_code}"


def test_bde_cannot_read_an_unassigned_candidates_prep(api_client, test_db, accounts, case):
    _, _, app, _ = case
    test_db.get(User, accounts.user_id).role = "BDE"
    test_db.commit()
    response = api_client.get(f"/api/applications/{app.id}/prep")
    assert response.status_code == 404, f"out-of-assignment prep returned {response.status_code}"


def test_disconnect_records_the_actor_in_the_candidate_ledger(api_client, test_db, accounts, case):
    candidate, _, _, mailbox = case
    before = test_db.query(LedgerEntry).filter_by(firm_id=candidate.firm_id, candidate_id=candidate.id).count()
    response = api_client.delete(f"/api/firms/{candidate.firm_id}/candidates/{candidate.id}/mailbox")
    assert response.status_code == 200
    test_db.expire_all()
    assert test_db.query(LedgerEntry).filter_by(firm_id=candidate.firm_id, candidate_id=candidate.id).count() > before
