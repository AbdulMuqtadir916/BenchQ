"""PR 4 T3.1–T3.3 (DEBUG D-08, D-09, D-10): review list order and fields, Dismiss, allowed review stages."""
from datetime import timedelta
import uuid

from backend.inbox import classification_worker as worker
from backend.inbox.google_oauth import encrypt_content
from backend.models.candidates import InboxMessage
from backend.models.db import Application, ApplicationReview, utcnow
from backend.tests.test_pr3_matching import matching_case, mailbox_case, email  # noqa: F401 (fixtures)
from backend.tests.test_pr3_pipeline import decision, pipeline  # noqa: F401 (fixture)


def _base(row):
    return f'/api/firms/{row.firm_id}/candidates/{row.candidate_id}'


def _command(test_db, row, review, **body):
    test_db.expire_all()
    review = test_db.get(ApplicationReview, review.id)
    row = test_db.get(InboxMessage, row.id)
    return {'review_id': str(review.id), 'command_id': str(uuid.uuid4()), 'expected_review_revision': review.revision,
            'expected_content_revision': row.content_revision, **body}


def _unmatched_review(test_db, pipeline, subject='Job alert', received=None):
    _, mailbox_id, message_id = pipeline
    row = test_db.get(InboxMessage, message_id)
    row.subject, row.body = subject, encrypt_content('A newsletter about the job market this week, nothing about one application.')
    if received:
        row.received_at = received
    test_db.commit()
    assert worker.process_one(message_id, provider=lambda *a: decision('assessment', .6))
    test_db.expire_all()
    return test_db.get(InboxMessage, message_id), test_db.query(ApplicationReview).filter_by(inbox_message_id=message_id).one()


def test_review_list_is_newest_first_with_subject_and_sender(test_db, pipeline, api_client):
    from backend.models.candidates import CandidateMailbox
    from backend.tests.test_candidate_mailbox import email as make_email
    row, first = _unmatched_review(test_db, pipeline, subject='Older update')
    box = test_db.get(CandidateMailbox, row.mailbox_id)
    second_row = make_email(test_db, box, key='second-synthetic')
    second_row.source_address, second_row.subject = row.source_address, 'Newer update'
    second_row.body, second_row.snippet = encrypt_content('Another general market email without names.'), ''
    second_row.classification_state, second_row.sender_auth_result, second_row.receive_time_verified = 'PENDING', 'PASS', True
    test_db.commit()
    first.created_at = utcnow() - timedelta(hours=1)
    test_db.commit()
    assert worker.process_one(second_row.id, provider=lambda *a: decision('assessment', .6))
    page = api_client.get(_base(row) + '/email-reviews', params={'limit': 1})
    assert page.status_code == 200, page.text
    body = page.json()
    assert body['total_count'] == 2 and body['reviews'][0]['subject'] == 'Newer update'
    assert body['reviews'][0]['from_name'] == 'Recruiter' and body['reviews'][0]['received_at']
    rest = api_client.get(_base(row) + '/email-reviews', params={'limit': 1, 'after': body['next_cursor']}).json()
    assert [r['subject'] for r in rest['reviews']] == ['Older update'] and rest['next_cursor'] is None


def test_dismiss_never_links_and_ignores_application_revision(test_db, pipeline, api_client):
    app_id, _, _ = pipeline
    row, review = _unmatched_review(test_db, pipeline)
    result = api_client.patch(_base(row) + f'/inbox-messages/{row.id}/review', json=_command(
        test_db, row, review, action='DISMISS_NON_APPLICATION', application_id=str(app_id), expected_application_revision=999))
    assert result.status_code == 200, result.text
    test_db.expire_all()
    assert test_db.get(ApplicationReview, review.id).state == 'RESOLVED'
    assert test_db.get(InboxMessage, row.id).application_id is None
    assert test_db.get(Application, app_id).status == 'applied'


def test_review_cannot_set_saved(test_db, pipeline, api_client):
    app_id, _, message_id = pipeline
    assert worker.process_one(message_id, provider=lambda *a: decision('assessment', .9))
    test_db.expire_all()
    row = test_db.get(InboxMessage, message_id)
    review = test_db.query(ApplicationReview).filter_by(inbox_message_id=message_id).one()
    app = test_db.get(Application, app_id)
    command = _command(test_db, row, review, action='SET_STATUS', status='saved', application_id=str(app_id),
                       expected_application_revision=app.status_revision)
    result = api_client.patch(_base(row) + f'/inbox-messages/{row.id}/review', json=command)
    assert result.status_code == 400 and 'except Saved' in result.text
    ok = api_client.patch(_base(row) + f'/inbox-messages/{row.id}/review', json={**command, 'command_id': str(uuid.uuid4()), 'status': 'assessment'})
    assert ok.status_code == 200, ok.text
    test_db.expire_all()
    assert test_db.get(Application, app_id).status == 'assessment'


def test_inbox_reports_how_many_emails_were_hidden_without_their_content(test_db, pipeline, api_client):
    _, _, message_id = pipeline
    row = test_db.get(InboxMessage, message_id)
    subject = row.subject
    assert worker.process_one(message_id, provider=lambda *a: decision('other', .97))
    body = api_client.get(_base(row) + '/inbox').json()
    assert body['hidden_count'] == 1 and body['messages'] == []
    assert subject not in str(body)
