"""Approved Other-category rule: reject new stage writes, retain historical evidence."""
import uuid
import pytest
from backend.models.db import ApplicationStatusEvent, ApplicationReview, utcnow
from backend.tests.test_application_tracker import setup_application, add_review


@pytest.mark.parametrize('endpoint', ['candidate-status', 'legacy-patch', 'bulk', 'review'])
def test_other_cannot_be_new_candidate_status(
        api_client, test_db, accounts, jobs_in_default_firm, endpoint):
    _, _, app, _, headers, _ = setup_application(test_db, accounts, jobs_in_default_firm)
    body = {'status': 'other', 'expected_revision': 0, 'command_id': str(uuid.uuid4())}
    path = f'/api/applications/{app.id}'
    review = None
    if endpoint == 'review':
        candidate = app.candidate_id
        from backend.models.candidates import Candidate
        review = add_review(test_db, accounts, test_db.get(Candidate, candidate), app)
        body.update(review_id=str(review.id), expected_review_revision=0)
    if endpoint == 'bulk':
        response = api_client.post('/api/applications/bulk-update', headers=headers, json={
            'ids': [str(app.id)], 'status': 'other', 'expected_revisions': {str(app.id): 0}})
    else:
        suffix = '' if endpoint == 'legacy-patch' else '/' + endpoint
        response = api_client.patch(path + suffix, headers=headers, json=body)
    assert response.status_code == 400, response.text
    test_db.expire_all()
    assert app.status == 'saved'
    assert app.status_revision == 0
    assert test_db.query(ApplicationStatusEvent).filter_by(application_id=app.id).count() == 0
    if review:
        assert test_db.get(ApplicationReview, review.id).state == 'PENDING'


def test_legacy_other_remains_readable_and_original_command_replayable(
        api_client, test_db, accounts, jobs_in_default_firm):
    _, _, app, _, headers, _ = setup_application(test_db, accounts, jobs_in_default_firm)
    command = uuid.uuid4()
    app.status = 'other'
    app.status_revision = 1
    test_db.add(ApplicationStatusEvent(
        firm_id=app.firm_id, candidate_id=app.candidate_id, application_id=app.id,
        from_status='saved', to_status='other', actor_user_id=accounts.user_id,
        source='ui', occurred_at=utcnow(), revision=1, command_id=command,
        original_payload={'source': 'ui', 'to': 'other'}))
    test_db.commit()
    path = f'/api/applications/{app.id}'
    assert api_client.get(path, headers=headers).json()['status'] == 'other'
    response = api_client.patch(path + '/candidate-status', headers=headers,
                               json={'status': 'other', 'expected_revision': 0,
                                     'command_id': str(command)})
    assert response.status_code == 200, response.text
    assert response.json()['status_revision'] == 1
    assert test_db.query(ApplicationStatusEvent).filter_by(application_id=app.id).count() == 1
