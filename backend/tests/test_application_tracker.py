"""Tracker commands preserve authoritative status and reject stale or out-of-scope decisions."""
import uuid
import pytest
from backend.tests.test_candidate_application_status import _saved_candidate_application


def setup_application(test_db, accounts, firm_id):
    return _saved_candidate_application(test_db, accounts, firm_id, 'OWNER')


@pytest.mark.parametrize("with_legacy", [False, True])
def test_latest_tailored_resume_stays_with_its_candidate_or_legacy_application(
        api_client, test_db, accounts, jobs_in_default_firm, with_legacy):
    from datetime import timedelta
    from backend.models.candidates import Candidate
    from backend.models.db import Application, Resume, utcnow

    candidate, job, app, _, headers, _ = setup_application(test_db, accounts, jobs_in_default_firm)
    other = Candidate(firm_id=candidate.firm_id, manager_id=candidate.manager_id,
        created_by_user_id=accounts.user_id, full_name="Other Synthetic Candidate", work_auth="H1B")
    test_db.add(other)
    test_db.flush()
    now = utcnow()
    own_newer = Resume(firm_id=candidate.firm_id, candidate_id=candidate.id, job_id=job.id,
        name="Own latest tailored", is_base=False, updated_at=now - timedelta(hours=2))
    legacy_resume = Resume(firm_id=candidate.firm_id, job_id=job.id,
        name="Legacy tailored", is_base=False, updated_at=now - timedelta(hours=1))
    test_db.add_all([
        Resume(firm_id=candidate.firm_id, candidate_id=candidate.id, job_id=job.id,
            name="Own older tailored", is_base=False, updated_at=now - timedelta(hours=3)),
        own_newer, legacy_resume,
        Resume(firm_id=candidate.firm_id, candidate_id=other.id, job_id=job.id,
            name="Other candidate newer tailored", is_base=False, updated_at=now),
    ])
    legacy_app = None
    if with_legacy:
        legacy_app = Application(firm_id=candidate.firm_id, job_id=job.id, status="applied")
        test_db.add(legacy_app)
    test_db.commit()

    result = api_client.get("/api/applications", headers=headers)
    assert result.status_code == 200
    rows = {row["id"]: row for row in result.json()["applications"]}
    assert rows[str(app.id)]["tailored_resume_id"] == str(own_newer.id)
    if legacy_app is not None:
        assert rows[str(legacy_app.id)]["tailored_resume_id"] == str(legacy_resume.id)
    candidate_only = api_client.get("/api/applications", headers=headers,
                                    params={"candidate_id": str(candidate.id), "tracked_only": True})
    assert candidate_only.status_code == 200
    assert [row["tailored_resume_id"] for row in candidate_only.json()["applications"]] == [str(own_newer.id)]


def test_status_revision_idempotency_and_note_are_persisted(api_client, test_db, accounts, jobs_in_default_firm):
    from backend.models.db import ApplicationStatusEvent
    candidate, job, app, _, headers, _ = setup_application(test_db, accounts, jobs_in_default_firm)
    path = f'/api/applications/{app.id}/candidate-status'
    body = dict(status='applied', expected_revision=0, command_id=str(uuid.uuid4()), note='BDE confirmed submission')
    first = api_client.patch(path, json=body, headers=headers)
    assert first.status_code == 200, first.text
    assert first.json()['status_revision'] == 1
    assert first.json()['status_transitions'][-1]['note'] == body['note']
    assert api_client.patch(path, json=body, headers=headers).status_code == 200
    assert test_db.query(ApplicationStatusEvent).filter_by(application_id=app.id).count() == 1
    stale = api_client.patch(path, json={**body, 'status': 'assessment', 'command_id': str(uuid.uuid4())}, headers=headers)
    assert stale.status_code == 409
    reused = api_client.patch(path, json={**body, 'status': 'assessment'}, headers=headers)
    assert reused.status_code == 409
    missing_revision = api_client.patch(path, json={'status': 'other'}, headers=headers)
    assert missing_revision.status_code == 409
    detail = api_client.get(f'/api/applications/{app.id}', headers=headers)
    assert detail.status_code == 200
    assert detail.json()['status'] == 'applied'
    assert detail.json()['status_revision'] == 1
    assert detail.json()['notes'] is None  # A transition note must not replace application notes.


def add_review(test_db, accounts, candidate, app):
    from backend.applications.tracking import request_review
    from backend.models.candidates import CandidateMailbox, InboxMessage
    from backend.models.db import utcnow
    mailbox = CandidateMailbox(firm_id=candidate.firm_id, candidate_id=candidate.id,
                              address='candidate@example.test', connected_by_user_id=accounts.user_id)
    test_db.add(mailbox)
    test_db.flush()
    message = InboxMessage(firm_id=candidate.firm_id, candidate_id=candidate.id, mailbox_id=mailbox.id,
                           application_id=app.id, provider_message_id='review-message', from_name='Recruiter',
                           from_email='recruiter@example.test', subject='Assessment', snippet='Please complete a task',
                           body='Please complete a task', received_at=utcnow())
    test_db.add(message)
    test_db.flush()
    review = request_review(test_db, app, message, reason='LOW_CONFIDENCE')
    assert request_review(test_db, app, message, reason='LOW_CONFIDENCE').id == review.id
    test_db.commit()
    return review


def test_review_retains_status_and_requires_explicit_human_resolution(api_client, test_db, accounts, jobs_in_default_firm):
    from backend.models.db import Application, ApplicationStatusEvent
    candidate, job, app, _, headers, _ = setup_application(test_db, accounts, jobs_in_default_firm)
    path = f'/api/applications/{app.id}'
    response = api_client.patch(path + '/candidate-status', json={'status': 'interview_scheduled', 'expected_revision': 0}, headers=headers)
    assert response.status_code == 200, response.text
    review = add_review(test_db, accounts, candidate, app)
    detail = api_client.get(path, headers=headers).json()
    assert detail['status'] == 'interview_scheduled'
    assert detail['pending_reviews'][0]['id'] == str(review.id)
    bypass = api_client.patch(path + '/candidate-status', json={'status': 'assessment', 'expected_revision': 1}, headers=headers)
    assert bypass.status_code == 409
    body = dict(review_id=str(review.id), status='assessment', expected_revision=1,
                expected_review_revision=0, command_id=str(uuid.uuid4()), note='Read email and confirmed')
    wrong_review_revision = api_client.patch(path + '/review', json={**body, 'expected_review_revision': 2}, headers=headers)
    assert wrong_review_revision.status_code == 409
    confirmed = api_client.patch(path + '/review', json=body, headers=headers)
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()['status'] == 'assessment'
    assert confirmed.json()['pending_reviews'] == []
    assert confirmed.json()['status_transitions'][-1]['source'] == 'bde_review'
    assert confirmed.json()['status_transitions'][-1]['actor_user_id'] == str(accounts.user_id)
    assert api_client.patch(path + '/review', json=body, headers=headers).status_code == 200
    test_db.expire_all()
    assert test_db.get(Application, app.id).status == 'assessment'
    assert test_db.query(ApplicationStatusEvent).filter_by(application_id=app.id).count() == 2


def test_review_scope_validation_and_event_immutability(api_client, test_db, accounts, jobs_in_default_firm):
    from backend.applications.tracking import request_review
    from backend.models.candidates import InboxMessage
    from backend.models.db import ApplicationStatusEvent
    from sqlalchemy import text
    from sqlalchemy.exc import DBAPIError
    candidate, job, app, _, headers, _ = setup_application(test_db, accounts, jobs_in_default_firm)
    review = add_review(test_db, accounts, candidate, app)
    message = test_db.get(InboxMessage, review.inbox_message_id)
    original = message.application_id
    message.application_id = uuid.uuid4()
    with pytest.raises(ValueError):
        request_review(test_db, app, message, reason='LOW_CONFIDENCE')
    message.application_id = original
    test_db.rollback()
    body = dict(review_id=str(review.id), status='other', expected_revision=0, expected_review_revision=0)
    response = api_client.patch(f'/api/applications/{app.id}/review', json=body, headers=headers)
    assert response.status_code == 200, response.text
    event = test_db.query(ApplicationStatusEvent).filter_by(application_id=app.id).one()
    with pytest.raises(DBAPIError):
        test_db.execute(text('UPDATE application_status_events SET to_status=:status WHERE id=:id'),
                        {'status': 'offer', 'id': event.id})
        test_db.flush()
    test_db.rollback()


def test_bde_sees_assigned_saved_drafts_and_cannot_move_other_candidates(api_client, test_db, accounts, jobs_in_default_firm):
    from backend.auth.sessions import start_session
    from backend.models.tenancy import Firm
    from backend.tests.auth_support import make_user
    candidate, job, app, manager, _, _ = setup_application(test_db, accounts, jobs_in_default_firm)
    bde = make_user(test_db, test_db.get(Firm, jobs_in_default_firm), email='tracker-bde@example.test',
                    role='BDE')
    bde.manager_id = manager.id
    candidate.bde_id = bde.id
    token, _ = start_session(test_db, bde)
    other, _, other_app, _, _, _ = _saved_candidate_application(test_db, accounts, jobs_in_default_firm, 'MANAGER')
    test_db.commit()
    headers = {'cookie': f'bq_session={token}'}
    visible = api_client.get('/api/applications?tracked_only=true', headers=headers)
    assert visible.status_code == 200, visible.text
    assert {item['id'] for item in visible.json()['applications']} == {str(app.id)}
    assert api_client.get(f'/api/applications/{other_app.id}', headers=headers).status_code == 404
    moved = api_client.patch(f'/api/applications/{app.id}/candidate-status',
                             json={'status': 'applied', 'expected_revision': 0}, headers=headers)
    assert moved.status_code == 200, moved.text
    assert moved.json()['submitted_by_user_id'] == str(bde.id)
    denied = api_client.patch(f'/api/applications/{other_app.id}/candidate-status',
                              json={'status': 'applied', 'expected_revision': 0}, headers=headers)
    assert denied.status_code == 404


def test_legacy_monitor_cannot_overwrite_candidate_status(test_db, accounts, jobs_in_default_firm):
    from backend.email_monitor.gmail_client import _apply_email_to_app, _apply_llm_result_to_app
    candidate, job, app, _, _, _ = setup_application(test_db, accounts, jobs_in_default_firm)
    _apply_email_to_app(test_db, app, 'rejection', 'No thanks', 'Application')
    _apply_llm_result_to_app(test_db, app, {'status': 'offer'}, 'Selected', 'Offer')
    assert app.status == 'saved'
    assert app.last_email_received is None
