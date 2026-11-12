"""PR 4 Phase 4 (DEBUG D-11, D-12, D-13): automatic status writes, replay rules and Undo. Synthetic only."""
from datetime import timedelta
import uuid

import pytest

from backend import config
from backend.applications.tracking import apply_email_decision, email_command_id
from backend.inbox import classification_worker as worker
from backend.models.candidates import InboxMessage
from backend.models.db import Application, ApplicationReview, ApplicationStatusEvent, EmailClassification, utcnow
from backend.models.tenancy import LedgerEntry
from backend.tests.test_pr3_matching import matching_case, mailbox_case, email  # noqa: F401 (fixtures)
from backend.tests.test_pr3_pipeline import decision, pipeline  # noqa: F401 (fixture)


@pytest.fixture
def automation(monkeypatch):
    monkeypatch.setattr(config, 'CANDIDATE_EMAIL_AUTO_STATUS_ENABLED', True)
    monkeypatch.setattr(config, 'CANDIDATE_EMAIL_AUTOMATION_APPROVED', True)
    monkeypatch.setattr(config, 'CANDIDATE_EMAIL_AUTOMATION_START_AT', (utcnow() - timedelta(hours=1)).isoformat())


def _requeue(test_db, message_id):
    """What an authorized reclassify does: queue the same email again for a new result version."""
    test_db.expire_all()
    row = test_db.get(InboxMessage, message_id)
    row.classification_state, row.classification_attempts = 'PENDING', 0
    test_db.commit()


def _state(test_db, app_id, message_id):
    test_db.expire_all()
    app = test_db.get(Application, app_id)
    events = test_db.query(ApplicationStatusEvent).filter_by(application_id=app_id).order_by(ApplicationStatusEvent.revision).all()
    results = test_db.query(EmailClassification).filter_by(inbox_message_id=message_id).order_by(EmailClassification.result_version).all()
    reviews = test_db.query(ApplicationReview).filter_by(inbox_message_id=message_id).all()
    return app, events, results, reviews


def test_automation_off_keeps_classification_and_review(test_db, pipeline):
    app_id, _, message_id = pipeline
    assert worker.process_one(message_id, provider=lambda *a: decision('screening_call', .95))
    app, events, results, reviews = _state(test_db, app_id, message_id)
    assert app.status == 'applied' and events == []
    assert results[0].outcome == 'REVIEW' and results[0].reason == 'AUTO_STATUS_DISABLED'
    assert [r.reason for r in reviews] == ['AUTO_STATUS_DISABLED']


def test_eligible_email_moves_the_application_with_evidence(test_db, pipeline, automation):
    app_id, _, message_id = pipeline
    assert worker.process_one(message_id, provider=lambda *a: decision('screening_call', .95))
    app, events, results, reviews = _state(test_db, app_id, message_id)
    assert app.status == 'screening_call' and reviews == []
    assert results[0].outcome == 'AUTO_APPLIED'
    event = events[-1]
    assert (event.source, event.actor_user_id, event.from_status, event.to_status) == ('email_classifier', None, 'applied', 'screening_call')
    assert event.original_payload['email_id'] == str(message_id) and event.original_payload['event_id'] == str(event.id)
    assert test_db.query(LedgerEntry).filter_by(actor_name='Email classifier').count() == 1


@pytest.mark.parametrize(('category', 'confidence', 'auth', 'reason'), [
    ('offer', .99, 'PASS', 'OUTCOME_REQUIRES_REVIEW'),
    ('move_on', .99, 'PASS', 'OUTCOME_REQUIRES_REVIEW'),
    ('screening_call', .79, 'PASS', 'LOW_CONFIDENCE'),
    ('screening_call', .95, 'UNKNOWN', 'SENDER_UNVERIFIED'),
])
def test_each_gate_still_goes_to_review(test_db, pipeline, automation, category, confidence, auth, reason):
    app_id, _, message_id = pipeline
    test_db.get(InboxMessage, message_id).sender_auth_result = auth
    test_db.commit()
    assert worker.process_one(message_id, provider=lambda *a: decision(category, confidence))
    app, events, results, reviews = _state(test_db, app_id, message_id)
    assert app.status == 'applied' and events == [] and [r.reason for r in reviews] == [reason]


def test_mail_received_before_the_start_time_is_never_executed(test_db, pipeline, automation, monkeypatch):
    app_id, _, message_id = pipeline
    monkeypatch.setattr(config, 'CANDIDATE_EMAIL_AUTOMATION_START_AT', (utcnow() + timedelta(hours=1)).isoformat())
    assert worker.process_one(message_id, provider=lambda *a: decision('screening_call', .95))
    app, events, _, reviews = _state(test_db, app_id, message_id)
    assert app.status == 'applied' and events == [] and [r.reason for r in reviews] == ['AUTO_STATUS_DISABLED']


def test_same_decision_is_written_once(test_db, pipeline, automation):
    app_id, _, message_id = pipeline
    assert worker.process_one(message_id, provider=lambda *a: decision('screening_call', .95))
    app, events, results, _ = _state(test_db, app_id, message_id)
    assert apply_email_decision(test_db, app, test_db.get(InboxMessage, message_id), results[0].id, target='screening_call')
    test_db.commit()
    assert test_db.query(ApplicationStatusEvent).filter_by(command_id=email_command_id(app_id, message_id)).count() == 1


def test_reclassification_never_reapplies(test_db, pipeline, automation):
    app_id, _, message_id = pipeline
    assert worker.process_one(message_id, provider=lambda *a: decision('screening_call', .95))
    _requeue(test_db, message_id)
    assert worker.process_one(message_id, provider=lambda *a: decision('screening_call', .95))
    app, events, results, reviews = _state(test_db, app_id, message_id)
    assert len(events) == 1 and results[-1].outcome == 'NO_CHANGE' and reviews == []
    _requeue(test_db, message_id)
    assert worker.process_one(message_id, provider=lambda *a: decision('shortlisted', .95))
    app, events, results, reviews = _state(test_db, app_id, message_id)
    assert len(events) == 1 and app.status == 'screening_call' and [r.reason for r in reviews] == ['EMAIL_ALREADY_APPLIED']


def _undo(api_client, app, event_id, revision, command_id=None):
    return api_client.post(f'/api/applications/{app.id}/status-events/{event_id}/undo',
                           json={'expected_revision': revision, 'command_id': command_id or str(uuid.uuid4())})


def test_undo_restores_the_status_once_and_blocks_reapplying(test_db, pipeline, automation, api_client):
    app_id, _, message_id = pipeline
    assert worker.process_one(message_id, provider=lambda *a: decision('screening_call', .95))
    app, events, _, _ = _state(test_db, app_id, message_id)
    command = str(uuid.uuid4())
    first = _undo(api_client, app, events[-1].id, app.status_revision, command)
    assert first.status_code == 200, first.text
    assert _undo(api_client, app, events[-1].id, app.status_revision, command).status_code == 200  # same command: no-op
    app, events, _, _ = _state(test_db, app_id, message_id)
    assert app.status == 'applied' and [e.source for e in events] == ['email_classifier', 'email_undo']
    assert events[-1].original_payload['undo_event_id'] == str(events[0].id)
    _requeue(test_db, message_id)
    assert worker.process_one(message_id, provider=lambda *a: decision('screening_call', .95))
    app, events, _, reviews = _state(test_db, app_id, message_id)
    assert app.status == 'applied' and len(events) == 2
    assert [r.reason for r in reviews if r.state == 'PENDING'] == ['AUTOMATIC_CHANGE_UNDONE']


def test_undo_back_to_saved_brings_back_the_favorite(test_db, pipeline, automation, api_client):
    """CodeRabbit #127: a submitted application moved back to Saved is still matched; Undo restores its favorite."""
    from backend.models.candidates import Candidate, FavoriteJob
    app_id, _, message_id = pipeline
    app = test_db.get(Application, app_id)
    marker = app.submitted_by_user_id or test_db.get(Candidate, app.candidate_id).created_by_user_id
    app.status, app.submitted_by_user_id = 'saved', marker
    test_db.add(FavoriteJob(firm_id=app.firm_id, candidate_id=app.candidate_id, job_id=app.job_id, marked_by_user_id=marker))
    test_db.commit()
    assert worker.process_one(message_id, provider=lambda *a: decision('screening_call', .95))
    app, events, _, _ = _state(test_db, app_id, message_id)
    favorites = test_db.query(FavoriteJob).filter_by(candidate_id=app.candidate_id, job_id=app.job_id)
    assert (app.status, events[-1].from_status, favorites.count()) == ('screening_call', 'saved', 0)
    assert _undo(api_client, app, events[-1].id, app.status_revision).status_code == 200
    app, _, _, _ = _state(test_db, app_id, message_id)
    assert (app.status, favorites.count()) == ('saved', 1)


def test_undo_after_a_later_decision_is_refused(test_db, pipeline, automation, api_client):
    app_id, _, message_id = pipeline
    assert worker.process_one(message_id, provider=lambda *a: decision('screening_call', .95))
    app, events, _, _ = _state(test_db, app_id, message_id)
    moved = api_client.patch(f'/api/applications/{app.id}/candidate-status',
                             json={'status': 'shortlisted', 'expected_revision': app.status_revision})
    assert moved.status_code == 200, moved.text
    result = _undo(api_client, app, events[-1].id, app.status_revision + 1)
    assert result.status_code == 409


def test_pending_older_review_does_not_block_a_newer_eligible_email(test_db, pipeline, automation, api_client):
    from backend.models.candidates import CandidateMailbox
    from backend.inbox.google_oauth import encrypt_content
    from backend.tests.test_candidate_mailbox import email as make_email
    app_id, mailbox_id, older_id = pipeline
    test_db.get(InboxMessage, older_id).sender_auth_result = 'UNKNOWN'  # older email: review only
    test_db.commit()
    assert worker.process_one(older_id, provider=lambda *a: decision('screening_call', .95))
    older_review = test_db.query(ApplicationReview).filter_by(inbox_message_id=older_id).one()
    newer = make_email(test_db, test_db.get(CandidateMailbox, mailbox_id), key='newer-synthetic')
    original = test_db.get(InboxMessage, older_id)
    newer.source_address, newer.subject = original.source_address, original.subject
    newer.body, newer.snippet = encrypt_content('Java Backend Engineer at Alderbyte Systems: please complete this assessment.'), ''
    newer.classification_state, newer.sender_auth_result, newer.receive_time_verified = 'PENDING', 'PASS', True
    newer.received_at = utcnow() + timedelta(seconds=1)
    test_db.commit()
    assert worker.process_one(newer.id, provider=lambda *a: decision('assessment', .95))
    test_db.expire_all()
    app = test_db.get(Application, app_id)
    assert app.status == 'assessment'
    # Resolving the older review against its stale application revision is refused, never a silent overwrite.
    row = test_db.get(InboxMessage, older_id)
    stale = api_client.patch(f'/api/firms/{row.firm_id}/candidates/{row.candidate_id}/inbox-messages/{row.id}/review', json={
        'review_id': str(older_review.id), 'command_id': str(uuid.uuid4()), 'expected_review_revision': older_review.revision,
        'expected_content_revision': row.content_revision, 'application_id': str(app_id),
        'expected_application_revision': app.status_revision - 1, 'action': 'SET_STATUS', 'status': 'screening_call'})
    assert stale.status_code == 409
    test_db.expire_all()
    assert test_db.get(Application, app_id).status == 'assessment'


@pytest.mark.parametrize(('category', 'expected_status', 'review'), [
    ('applied', 'applied', None),                                    # completion confirmation: back to Applied
    ('assessment', 'incomplete_application', 'MANUAL_STAGE_REVIEW'),  # anything else: a person decides
])
def test_incomplete_application_returns_to_applied_only(test_db, pipeline, automation, category, expected_status, review):
    app_id, _, message_id = pipeline
    app = test_db.get(Application, app_id)
    app.status, app.status_effective_at = 'incomplete_application', utcnow() - timedelta(days=1)
    test_db.commit()
    assert worker.process_one(message_id, provider=lambda *a: decision(category, .95))
    app, events, _, reviews = _state(test_db, app_id, message_id)
    assert app.status == expected_status
    assert [r.reason for r in reviews] == ([review] if review else [])
