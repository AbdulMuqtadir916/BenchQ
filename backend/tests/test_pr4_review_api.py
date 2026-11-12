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


def test_link_only_links_the_email_and_resolves_its_review(test_db, pipeline, api_client):
    """CodeRabbit #127: Link only is a decision: the email is linked, the status stays, the review leaves the queue."""
    app_id, _, _ = pipeline
    row, review = _unmatched_review(test_db, pipeline)
    revision = test_db.get(Application, app_id).status_revision
    result = api_client.patch(_base(row) + f'/inbox-messages/{row.id}/review', json=_command(
        test_db, row, review, action='LINK_ONLY', application_id=str(app_id), expected_application_revision=revision))
    assert result.status_code == 200, result.text
    test_db.expire_all()
    review = test_db.get(ApplicationReview, review.id)
    assert (review.state, review.resolved_status) == ('RESOLVED', None) and review.resolved_by_user_id is not None
    assert test_db.get(InboxMessage, row.id).application_id == app_id
    assert test_db.get(Application, app_id).status == 'applied'
    assert api_client.get(_base(row) + '/email-reviews').json()['total_count'] == 0


def test_a_review_sets_incomplete_only_for_an_incomplete_email_or_application(test_db, pipeline, api_client):
    """DEBUG D-10 (CodeRabbit #127): Incomplete needs an email classified Incomplete or an application already Incomplete."""
    app_id, _, _ = pipeline
    row, review = _unmatched_review(test_db, pipeline)  # classified Assessment
    revision = test_db.get(Application, app_id).status_revision

    def set_incomplete():
        return api_client.patch(_base(row) + f'/inbox-messages/{row.id}/review', json=_command(
            test_db, row, review, action='SET_STATUS', status='incomplete_application', application_id=str(app_id),
            expected_application_revision=revision))

    refused = set_incomplete()
    assert refused.status_code == 400, refused.text
    test_db.expire_all()
    assert test_db.get(ApplicationReview, review.id).state == 'PENDING'
    test_db.get(Application, app_id).status = 'incomplete_application'
    test_db.commit()
    allowed = set_incomplete()
    assert allowed.status_code == 200, allowed.text


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


def test_other_is_listed_and_only_earlier_hidden_mail_is_counted_without_its_content(test_db, pipeline, api_client):
    # Since 2026-11-07 Other mail is listed (shown as Irrelevant), not hidden; mail hidden before that stays hidden
    # and is reported as a count only.
    _, _, message_id = pipeline
    row = test_db.get(InboxMessage, message_id)
    subject = row.subject
    assert worker.process_one(message_id, provider=lambda *a: decision('other', .97))
    body = api_client.get(_base(row) + '/inbox').json()
    assert body['hidden_count'] == 0
    assert [(m['id'], m['classification_category']) for m in body['messages']] == [(str(row.id), 'other')]
    test_db.expire_all()
    test_db.get(InboxMessage, message_id).hidden_at = utcnow()
    test_db.commit()
    body = api_client.get(_base(row) + '/inbox').json()
    assert body['hidden_count'] == 1 and body['messages'] == []
    assert subject not in str(body)


def test_bde_opens_a_review_for_an_irrelevant_email_once(test_db, pipeline, api_client):
    """An email marked Irrelevant (Other) has no review until a BDE opens one; then the usual review loop works on it."""
    _, _, message_id = pipeline
    assert worker.process_one(message_id, provider=lambda *a: decision('other', .97))
    row = test_db.get(InboxMessage, message_id)
    assert not test_db.query(ApplicationReview).first()
    path = _base(row) + f'/inbox-messages/{row.id}/review/open'
    first = api_client.post(path)
    assert first.status_code == 200, first.text
    again = api_client.post(path)
    assert again.status_code == 200 and again.json() == first.json()
    test_db.expire_all()
    review = test_db.query(ApplicationReview).one()
    assert str(review.id) == first.json()['review_id']
    assert review.state == 'PENDING' and review.reason == 'MANUAL_REVIEW'
    listed = api_client.get(_base(row) + '/email-reviews').json()
    assert [r['id'] for r in listed['reviews']] == [str(review.id)] and listed['reviews'][0]['reason'] == 'MANUAL_REVIEW'
    dismissed = api_client.patch(_base(row) + f'/inbox-messages/{row.id}/review',
                                 json=_command(test_db, row, review, action='DISMISS_NON_APPLICATION'))
    assert dismissed.status_code == 200, dismissed.text
    reopened = api_client.post(path)
    assert reopened.status_code == 409 and 'already reviewed' in reopened.json()['detail']


def test_only_an_irrelevant_email_can_be_opened_for_review(test_db, pipeline, api_client):
    _, _, message_id = pipeline
    assert worker.process_one(message_id, provider=lambda *a: decision('assessment', .5))  # low confidence: its own review
    row = test_db.get(InboxMessage, message_id)
    existing = test_db.query(ApplicationReview).one()
    result = api_client.post(_base(row) + f'/inbox-messages/{row.id}/review/open')
    assert result.status_code == 200 and result.json()['review_id'] == str(existing.id)  # the pending review, not a new one
    test_db.expire_all()
    assert test_db.query(ApplicationReview).count() == 1


def test_a_job_email_without_a_review_cannot_be_opened_as_irrelevant(test_db, pipeline, api_client):
    app_id, _, message_id = pipeline
    test_db.get(Application, app_id).status = 'assessment'
    test_db.commit()
    assert worker.process_one(message_id, provider=lambda *a: decision('assessment', .95))  # same stage: no review
    row = test_db.get(InboxMessage, message_id)
    assert not test_db.query(ApplicationReview).first()
    result = api_client.post(_base(row) + f'/inbox-messages/{row.id}/review/open')
    assert result.status_code == 409 and 'Irrelevant' in result.json()['detail']
    assert not test_db.query(ApplicationReview).first()
