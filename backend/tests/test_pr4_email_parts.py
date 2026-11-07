"""PR 4 T1.3 (DEBUG D-04): replies and forwards are split separately; uncertainty comes before Other hiding."""
import pytest

from backend.inbox import classification_worker as worker
from backend.inbox.application_matching import ai_input, email_parts, matching_application_id
from backend.inbox.google_oauth import encrypt_content
from backend.models.candidates import InboxMessage
from backend.models.db import ApplicationReview, EmailClassification
from backend.tests.test_pr3_matching import matching_case, mailbox_case, email  # noqa: F401 (fixtures)
from backend.tests.test_pr3_pipeline import decision, pipeline  # noqa: F401 (fixture)

NAMES = 'Java Backend Engineer at Alderbyte Systems'


def _set(test_db, row, body, subject='Application update'):
    row.subject, row.body, row.snippet = subject, encrypt_content(body), ''
    test_db.commit()


def test_mid_body_from_line_is_ordinary_text(test_db, matching_case):
    _, _, app, box, row = matching_case
    _set(test_db, row, f'We reviewed your profile.\nFrom: the hiring team\n{NAMES}: please complete this assessment.')
    parts = email_parts(row)
    assert 'please complete this assessment' in parts.current and not parts.is_forward
    assert matching_application_id(test_db, box, row) == app.id


def test_outlook_quoted_header_ends_the_current_message(test_db, matching_case):
    _, _, _, box, row = matching_case
    _set(test_db, row, f'Sounds good, thank you.\nFrom: Recruiter\nSent: Monday\nTo: Candidate\nSubject: Offer\n{NAMES} offer')
    assert email_parts(row).current == 'Sounds good, thank you.'
    assert matching_application_id(test_db, box, row) is None


def test_old_offer_in_a_quoted_reply_is_never_sent_as_current(test_db, matching_case):
    _, _, _, _, row = matching_case
    _set(test_db, row, f'Thanks for the update, see you then.\nOn Monday recruiter wrote:\n> {NAMES}: you have an offer')
    parts = email_parts(row)
    assert 'offer' not in ai_input(parts) and not parts.is_forward


@pytest.mark.parametrize('body', [
    f'FYI\n---------- Forwarded message ---------\nFrom: Client\n{NAMES}: we would like to schedule an interview.',
    f'<html><body><p>FYI</p><div class="gmail_quote">---------- Forwarded message ---------<br>'
    f'{NAMES}: we would like to schedule an interview.</div></body></html>',
])
def test_forwarded_content_identifies_the_application(test_db, matching_case, body):
    _, _, app, box, row = matching_case
    _set(test_db, row, body, subject='Fwd: interview')
    parts = email_parts(row)
    assert parts.is_forward and 'schedule an interview' in parts.forwarded
    assert '[Forwarded message' in ai_input(parts)
    assert matching_application_id(test_db, box, row) == app.id


def test_long_text_after_a_sign_off_is_kept(test_db, matching_case):
    _, _, _, _, row = matching_case
    tail = '\n'.join(f'Step {n}: complete the assessment section {n}.' for n in range(10))
    _set(test_db, row, f'Thanks,\n{tail}')
    assert 'Step 9' in email_parts(row).current


@pytest.mark.parametrize(('body', 'subject', 'reason'), [
    (f'FYI\n---------- Forwarded message ---------\n{NAMES}: newsletter', 'Fwd: news', 'FORWARDED_EMAIL'),
    ('Thanks!', 'Re: update', 'INSUFFICIENT_CONTENT'),
])
def test_uncertain_mail_goes_to_review_and_is_never_hidden_as_other(test_db, pipeline, body, subject, reason):
    _, _, message_id = pipeline
    _set(test_db, test_db.get(InboxMessage, message_id), body, subject)
    assert worker.process_one(message_id, provider=lambda *a: decision('other', .97))
    test_db.expire_all()
    assert test_db.get(InboxMessage, message_id).hidden_at is None
    assert test_db.query(EmailClassification).one().reason == reason
    assert test_db.query(ApplicationReview).one().reason == reason


def test_forward_with_a_job_category_is_review_not_automatic(test_db, pipeline):
    _, _, message_id = pipeline
    _set(test_db, test_db.get(InboxMessage, message_id),
         f'Please see below.\n---------- Forwarded message ---------\n{NAMES}: please complete this assessment.', 'Fwd: next step')
    sent = []
    assert worker.process_one(message_id, provider=lambda s, b, c: sent.append(b) or decision('assessment', .95))
    test_db.expire_all()
    assert '[Forwarded message' in sent[0]
    record = test_db.query(EmailClassification).one()
    assert record.reason == 'FORWARDED_EMAIL' and record.application_id is not None
