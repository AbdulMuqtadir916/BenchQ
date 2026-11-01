"""PR #100: command replay, submission history and consistent document metadata."""
import uuid
from datetime import datetime, timezone

import pytest

from backend.models.candidates import Candidate, FavoriteJob
from backend.models.db import Application, ApplicationStatusEvent, CoverLetter, Resume, utcnow
from backend.models.tenancy import LedgerEntry
from backend.tests.test_application_tracker import add_review
from backend.tests.test_candidate_application_status import _saved_candidate_application


@pytest.fixture
def submission(test_db, accounts, jobs_in_default_firm):
    return _saved_candidate_application(test_db, accounts, jobs_in_default_firm, 'OWNER')


@pytest.mark.parametrize('command', [
    {'status': 'applied', 'expected_revision': 0, 'command_id': str(uuid.uuid4())},
    {'command_id': str(uuid.uuid4())}, {'expected_revision': 0}, {'note': 'Transition note'},
])
def test_notes_cannot_be_combined_with_command_fields(api_client, test_db, submission, command):
    _, _, app, _, headers, _ = submission
    response = api_client.patch(f'/api/applications/{app.id}', headers=headers,
                                json={**command, 'notes': 'Application notes'})
    assert response.status_code == 400, response.text
    test_db.refresh(app)
    assert app.status == 'saved'
    assert app.status_revision == 0
    assert app.notes is None
    assert test_db.query(ApplicationStatusEvent).filter_by(application_id=app.id).count() == 0


@pytest.mark.parametrize('retry_notes', [None, 'Original notes', 'Different notes'])
def test_status_retry_preserves_a_later_notes_edit(api_client, test_db, submission, retry_notes):
    _, _, app, _, headers, _ = submission
    path = f'/api/applications/{app.id}'
    command = {'status': 'applied', 'expected_revision': 0, 'command_id': str(uuid.uuid4())}
    assert api_client.patch(path, headers=headers, json=command).status_code == 200
    assert api_client.patch(path, headers=headers, json={'notes': 'Newer notes'}).status_code == 200
    before = test_db.query(LedgerEntry).filter_by(entity_id=str(app.id)).count()
    retry = dict(command)
    if retry_notes is not None:
        retry['notes'] = retry_notes
    response = api_client.patch(path, headers=headers, json=retry)
    assert response.status_code == (200 if retry_notes is None else 400), response.text
    test_db.refresh(app)
    assert app.notes == 'Newer notes'
    assert app.status_revision == 1
    assert test_db.query(ApplicationStatusEvent).filter_by(application_id=app.id).count() == 1
    assert test_db.query(LedgerEntry).filter_by(entity_id=str(app.id)).count() == before


def test_saved_applied_round_trip_keeps_first_submission_and_actor(api_client, test_db, accounts, submission, monkeypatch):
    from backend.applications import tracking
    from backend.auth.sessions import start_session

    candidate, job, app, manager, owner_headers, _ = submission
    path = f'/api/applications/{app.id}/candidate-status'
    first_time = datetime(2026, 10, 30, 12, tzinfo=timezone.utc)
    monkeypatch.setattr(tracking, 'utcnow', lambda: first_time)
    first = api_client.patch(path, headers=owner_headers, json={'status': 'applied', 'expected_revision': 0})
    assert first.status_code == 200, first.text
    token, _ = start_session(test_db, manager)
    test_db.commit()
    manager_headers = {'cookie': f'bq_session={token}'}
    monkeypatch.setattr(tracking, 'utcnow', lambda: datetime(2026, 11, 1, 12, tzinfo=timezone.utc))
    for revision, status in [(1, 'saved'), (2, 'applied')]:
        moved = api_client.patch(path, headers=manager_headers, json={'status': status, 'expected_revision': revision})
        assert moved.status_code == 200, moved.text
        assert moved.json()['applied_at'] == first.json()['applied_at']
        assert moved.json()['submitted_by_user_id'] == str(accounts.user_id)
    test_db.refresh(app)
    assert app.applied_at == first_time
    assert app.submitted_by_user_id == accounts.user_id
    events = test_db.query(ApplicationStatusEvent).filter_by(application_id=app.id).order_by(ApplicationStatusEvent.revision).all()
    assert [event.actor_user_id for event in events] == [accounts.user_id, manager.id, manager.id]
    assert test_db.query(FavoriteJob).filter_by(candidate_id=candidate.id, job_id=job.id).count() == 0


@pytest.mark.parametrize('own_letter', [False, True])
def test_candidate_responses_share_scoped_resume_and_letter_metadata(api_client, test_db, accounts, submission, own_letter):
    from datetime import timedelta

    candidate, job, app, _, headers, _ = submission
    other = Candidate(firm_id=candidate.firm_id, manager_id=candidate.manager_id,
                      created_by_user_id=accounts.user_id, full_name='Other candidate', work_auth='H1B')
    test_db.add(other)
    test_db.flush()
    own = Resume(firm_id=app.firm_id, candidate_id=candidate.id, job_id=job.id, is_base=False,
                 name='Candidate tailored resume', updated_at=utcnow() - timedelta(hours=1))
    foreign = Resume(firm_id=app.firm_id, candidate_id=other.id, job_id=job.id, is_base=False,
                     name='Other candidate latest resume', updated_at=utcnow())
    test_db.add_all([own, foreign])
    test_db.flush()
    test_db.add_all([
        CoverLetter(firm_id=app.firm_id, job_id=job.id, resume_id=foreign.id, name='Other letter'),
        CoverLetter(firm_id=app.firm_id, job_id=job.id, name='Unattributed legacy letter'),
    ])
    if own_letter:
        test_db.add(CoverLetter(firm_id=app.firm_id, job_id=job.id, resume_id=own.id, name='Candidate letter'))
    test_db.commit()
    expected = {'tailored_resume_id': str(own.id), 'tailored_resume_name': own.name, 'has_cover_letter': own_letter}
    def check(response):
        assert response.status_code == 200, response.text
        assert {key: response.json()[key] for key in expected} == expected
    listed = api_client.get('/api/applications', headers=headers, params={'candidate_id': str(candidate.id)})
    assert listed.status_code == 200, listed.text
    row = next(row for row in listed.json()['applications'] if row['id'] == str(app.id))
    assert {key: row[key] for key in expected} == expected
    path = f'/api/applications/{app.id}'
    check(api_client.get(path, headers=headers))
    check(api_client.patch(path + '/candidate-status', headers=headers, json={'status': 'applied', 'expected_revision': 0}))
    check(api_client.patch(path, headers=headers, json={'notes': 'Notes edited separately'}))
    check(api_client.patch(path, headers=headers, json={'status': 'screening_call', 'expected_revision': 1}))
    review = add_review(test_db, accounts, candidate, app)
    check(api_client.patch(path + '/review', headers=headers, json={
        'review_id': str(review.id), 'status': 'offer', 'expected_revision': 2, 'expected_review_revision': 0,
    }))


@pytest.mark.parametrize('letter_source', ['resume', 'persona'])
def test_legacy_detail_and_update_match_list_document_metadata(api_client, test_db, submission, letter_source):
    _, job, app, _, headers, _ = submission
    legacy = Application(firm_id=app.firm_id, job_id=job.id, status='applied')
    resume = Resume(firm_id=legacy.firm_id, job_id=job.id, name='Legacy tailored', is_base=False)
    test_db.add_all([legacy, resume])
    test_db.flush()
    test_db.add(CoverLetter(firm_id=legacy.firm_id, job_id=job.id,
                           resume_id=resume.id if letter_source == 'resume' else None, name='Legacy letter'))
    test_db.commit()
    expected = {'tailored_resume_id': str(resume.id), 'tailored_resume_name': resume.name, 'has_cover_letter': True}
    listed = api_client.get('/api/applications', headers=headers).json()['applications']
    row = next(row for row in listed if row['id'] == str(legacy.id))
    assert {key: row[key] for key in expected} == expected
    for response in [api_client.get(f'/api/applications/{legacy.id}', headers=headers),
                     api_client.patch(f'/api/applications/{legacy.id}', headers=headers, json={'status': 'offer'})]:
        assert response.status_code == 200, response.text
        assert {key: response.json()[key] for key in expected} == expected
