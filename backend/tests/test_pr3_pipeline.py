"""Synthetic PR 3 integration: encrypted content, no status writes, privacy and races."""
from datetime import timedelta
from types import SimpleNamespace
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from backend import config
from backend.inbox import classification_worker as worker
from backend.inbox.decider import Classification, DeciderError, parse_response
from backend.inbox.decider_categories import CATEGORIES, QUESTION_KEY
from backend.models.db import Application, ApplicationReview, ApplicationStatusEvent, EmailClassification, JobRun, utcnow
from backend.models.candidates import Candidate, CandidateMailbox, InboxMessage
from backend.tests.test_pr3_matching import matching_case, mailbox_case, email


def decision(category='assessment', confidence=.9):
    probabilities = {key: (1-confidence)/(len(CATEGORIES)-1) for key in CATEGORIES}
    probabilities[category] = confidence
    return Classification(category, confidence, probabilities, {'cost_quality': 'UNKNOWN'})


@pytest.fixture
def pipeline(test_db, matching_case, monkeypatch):
    _, _, app, mailbox, row = matching_case
    mailbox.status = 'CONNECTED'
    row.classification_state = 'PENDING'
    row.sender_auth_result = 'PASS'
    row.receive_time_verified = True
    row.received_at = utcnow()
    test_db.commit()
    monkeypatch.setattr(config, 'CANDIDATE_EMAIL_CLASSIFICATION_ENABLED', True)
    monkeypatch.setattr(config, 'CANDIDATE_EMAIL_REAL_MAIL_APPROVED', True)
    monkeypatch.setattr(worker, 'ai_config', lambda *a, **kw: SimpleNamespace(
        provider='openrouter', model='synthetic-test-only', api_key='synthetic-not-real',
        prompts={}, preset_id=None, preset_version=None))
    monkeypatch.setattr(worker, 'wake_worker', lambda: None)
    return app.id, mailbox.id, row.id


def test_decrypted_ai_and_matching_preserve_application_and_resume(test_db, pipeline):
    app_id, _, row_id = pipeline
    before = test_db.get(Application, app_id)
    snapshot = (before.status, before.status_revision, before.applied_at, before.resume_id)
    # Since 0017 (07 Q57) the candidate's name and contact details live in the active base's newest résumé version;
    # the masking reads them there through Candidate.full_name / .email / .phone / .linkedin_url.
    from backend.models.candidates import BaseResume, ResumeParse
    from backend.models.db import Resume
    candidate = test_db.get(Candidate, before.candidate_id)
    upload = ResumeParse(firm_id=candidate.firm_id, uploaded_by_user_id=candidate.created_by_user_id,
                         candidate_id=candidate.id, file_name='synthetic.pdf', mime_type='application/pdf', size_bytes=9,
                         content=b'synthetic', parse={'header': {'name': 'Priya Masker Test'}})
    test_db.add(upload)
    test_db.flush()
    base = BaseResume(firm_id=candidate.firm_id, candidate_id=candidate.id, source='UPLOAD', resume_parse_id=upload.id,
                      is_active=True, created_by_user_id=candidate.created_by_user_id)
    test_db.add(base)
    test_db.flush()
    test_db.add(Resume(firm_id=candidate.firm_id, candidate_id=candidate.id, base_resume_id=base.id, category='BASE',
                       version=1, name='Synthetic base', created_by_user_id=candidate.created_by_user_id,
                       full_name='Priya Masker Test', email='priya.masker@example.test', phone='+1 614 555 0123',
                       linkedin='https://www.linkedin.com/in/priya-masker-test'))
    test_db.commit()
    captured = []
    def provider(subject, body, cfg, known=None):
        captured.append((subject, body, known))
        assert 'bqenc1:' not in body
        return decision()
    assert worker.process_one(row_id, provider=provider)
    test_db.expire_all()
    row = test_db.get(InboxMessage, row_id)
    app = test_db.get(Application, app_id)
    assert 'Java Backend Engineer' in captured[0][1]
    # The masking gets the candidate, the connected mailbox and the sender, read with the content it is sent with.
    known = captured[0][2]
    mailbox = test_db.get(CandidateMailbox, row.mailbox_id)
    assert known.candidate_name == 'Priya Masker Test'
    assert set(known.candidate_values) >= {'priya.masker@example.test', '+1 614 555 0123',
                                           'https://www.linkedin.com/in/priya-masker-test', mailbox.address}
    assert (known.sender_name, known.sender_email) == (row.from_name, row.from_email)
    assert row.body.startswith('bqenc1:')
    assert row.application_id == app_id
    assert (app.status, app.status_revision, app.applied_at, app.resume_id) == snapshot
    assert test_db.query(ApplicationStatusEvent).count() == 0
    result = test_db.query(EmailClassification).one()
    assert result.confidence == .9 and result.reason == 'AUTO_STATUS_DISABLED'
    assert test_db.query(ApplicationReview).one().classification_id == result.id
    assert test_db.query(JobRun).filter_by(job_type='candidate_email_classification').one().meta['usage']['cost_quality'] == 'UNKNOWN'


@pytest.mark.parametrize(('category','confidence','auth','expected'), [
    ('offer', .99, 'PASS', 'OUTCOME_REQUIRES_REVIEW'),
    ('move_on', .99, 'PASS', 'OUTCOME_REQUIRES_REVIEW'),
    ('assessment', .799, 'PASS', 'LOW_CONFIDENCE'),
    ('other', .799, 'PASS', 'LOW_CONFIDENCE'),
    ('assessment', .8, 'PASS', 'AUTO_STATUS_DISABLED'),
    ('assessment', .9, 'UNKNOWN', 'SENDER_UNVERIFIED'),
    ('assessment', .9, 'FAIL', 'SENDER_UNVERIFIED'),
])
def test_threshold_and_outcome_policy_is_review_only(test_db, pipeline, category, confidence, auth, expected):
    app_id, _, message_id = pipeline
    test_db.get(InboxMessage, message_id).sender_auth_result = auth
    test_db.commit()
    assert worker.process_one(message_id, provider=lambda *a: decision(category, confidence))
    test_db.expire_all()
    assert test_db.query(EmailClassification).one().reason == expected
    assert test_db.get(Application, app_id).status == 'applied'
    if category == 'other':
        assert test_db.get(InboxMessage, message_id).hidden_at is None


def test_other_is_shown_as_irrelevant_with_a_purge_date_and_never_changes_status(test_db, pipeline, api_client):
    # Decided 2026-11-07: Other mail is shown in the Inbox (as Irrelevant), no longer hidden and encrypted; the 30-day
    # purge date is still set (erased only once the purge switches are on).
    app_id, _, message_id = pipeline
    row = test_db.get(InboxMessage, message_id)
    original_subject = row.subject
    before = utcnow()
    assert worker.process_one(message_id, provider=lambda *a: decision('other'))
    test_db.expire_all()
    row = test_db.get(InboxMessage, message_id)
    assert row.hidden_at is None and row.subject == original_subject
    assert timedelta(days=30) <= row.other_purge_after - before < timedelta(days=30, minutes=1)
    assert test_db.get(Application, app_id).status == 'applied'
    path = f'/api/firms/{row.firm_id}/candidates/{row.candidate_id}/inbox'
    result = api_client.get(path)
    assert result.status_code == 200, result.text
    [listed] = result.json()['messages']
    assert listed['id'] == str(row.id) and listed['classification_category'] == 'other'
    assert listed['subject'] == original_subject
    assert api_client.get(path, params={'message_id': str(row.id)}).status_code == 200
    assert not test_db.query(ApplicationReview).first()


def test_failure_remains_readable_and_has_safe_error(test_db, pipeline, api_client):
    _, _, message_id = pipeline
    def fail(*args): raise RuntimeError('private secret subject and body')
    assert not worker.process_one(message_id, provider=fail)
    test_db.expire_all()
    row = test_db.get(InboxMessage, message_id)
    assert row.classification_state == 'ERROR' and row.hidden_at is None
    assert row.classification_error == 'PROCESSING_FAILED'
    result = api_client.get(f'/api/firms/{row.firm_id}/candidates/{row.candidate_id}/inbox', params={'message_id': str(row.id)})
    assert result.status_code == 200
    assert result.json()['messages'][0]['body']
    assert result.json()['messages'][0]['classification_label'] == 'Not classified'
    assert 'private secret' not in str(test_db.query(JobRun).filter_by(job_type='candidate_email_classification').one().meta)


@pytest.mark.parametrize('mode', ['disconnect','delete','off','suspend','claim_stolen'])
def test_inflight_results_are_fenced(test_db, pipeline, mode):
    from backend.models.candidates import CandidateMailbox
    from backend.models.tenancy import Firm
    _, mailbox_id, message_id = pipeline
    def provider(*args):
        test_db.expire_all()
        row = test_db.get(InboxMessage, message_id)
        if mode == 'disconnect': test_db.get(CandidateMailbox, mailbox_id).status = 'DISCONNECTED'
        elif mode == 'delete': row.deleted_at = utcnow(); row.body = None; row.snippet = ''
        elif mode == 'off': config.CANDIDATE_EMAIL_REAL_MAIL_APPROVED = False
        elif mode == 'suspend': test_db.get(Firm, row.firm_id).status = 'SUSPENDED'
        else: row.classification_token = uuid.uuid4()
        test_db.commit()
        return decision()
    assert not worker.process_one(message_id, provider=provider)
    assert not test_db.query(EmailClassification).first()
    assert not test_db.query(ApplicationReview).first()


def test_disabled_mode_never_calls_provider(test_db, pipeline, monkeypatch):
    _, _, message_id = pipeline
    monkeypatch.setattr(config, 'CANDIDATE_EMAIL_REAL_MAIL_APPROVED', False)
    def forbidden(*args): raise AssertionError('must not send')
    assert not worker.process_one(message_id, provider=forbidden)
    test_db.expire_all()
    assert test_db.get(InboxMessage, message_id).classification_state == 'PENDING'


def test_duplicate_delivery_and_versioned_rerun_preserve_review(test_db, pipeline):
    _, _, message_id = pipeline
    assert worker.process_one(message_id, provider=lambda *a: decision())
    assert not worker.process_one(message_id, provider=lambda *a: decision())
    test_db.expire_all()
    previous_review = test_db.query(ApplicationReview).one().id
    row = test_db.get(InboxMessage, message_id)
    row.classification_state = 'PENDING'; row.classification_attempts = 0
    test_db.commit()
    assert worker.process_one(message_id, provider=lambda *a: decision('shortlisted'))
    assert test_db.query(EmailClassification).count() == 2
    assert test_db.query(ApplicationReview).one().id == previous_review


def test_unmatched_job_mail_has_review_without_fake_application(test_db, pipeline):
    _, _, message_id = pipeline
    row = test_db.get(InboxMessage, message_id)
    from backend.inbox.google_oauth import encrypt_content
    row.body = encrypt_content('Please attend an interview for a different role at another company.')
    row.subject = 'Interview invitation'
    test_db.commit()
    assert worker.process_one(message_id, provider=lambda *a: decision('interview_scheduled'))
    review = test_db.query(ApplicationReview).one()
    assert review.application_id is None and review.application_revision is None
    assert test_db.query(Application).count() == 1


def test_purge_requires_both_flags_and_30_days(test_db, pipeline, monkeypatch):
    from backend.inbox.retention import purge_due
    _, _, message_id = pipeline
    assert worker.process_one(message_id, provider=lambda *a: decision('other'))
    assert purge_due() == 0
    monkeypatch.setattr(config, 'CANDIDATE_EMAIL_PURGE_ENABLED', True)
    monkeypatch.setattr(config, 'CANDIDATE_EMAIL_PURGE_EVALUATED', True)
    assert purge_due() == 0
    monkeypatch.setattr(config, 'CANDIDATE_EMAIL_PURGE_EVALUATION_CONFIG_ID', test_db.query(EmailClassification).one().prompt_version)
    test_db.expire_all()
    row = test_db.get(InboxMessage, message_id)
    row.other_purge_after = utcnow() - timedelta(seconds=1)
    test_db.commit()
    # The pipeline's email names its application, so the matcher linked it: linked mail is never erased.
    assert row.application_id is not None and purge_due() == 0
    row.application_id = None
    test_db.commit()
    approved_id = config.CANDIDATE_EMAIL_PURGE_EVALUATION_CONFIG_ID
    monkeypatch.setattr(config, 'CANDIDATE_EMAIL_PURGE_EVALUATION_CONFIG_ID', 'different-model-policy')
    assert purge_due() == 0
    monkeypatch.setattr(config, 'CANDIDATE_EMAIL_PURGE_EVALUATION_CONFIG_ID', approved_id)
    assert purge_due() == 1
    test_db.expire_all()
    row = test_db.get(InboxMessage, message_id)
    assert row.deleted_at and row.classification_state == 'EXCLUDED'


def test_purge_reaches_unlinked_mail_behind_linked_mail(test_db, pipeline, monkeypatch):
    """CodeRabbit #127: linked mail is left out before the batch limit, so it never holds up unlinked mail behind it."""
    from backend.inbox.google_oauth import encrypt_content
    from backend.inbox.retention import purge_due
    from backend.tests.test_candidate_mailbox import email as make_email
    _, mailbox_id, linked_id = pipeline
    assert worker.process_one(linked_id, provider=lambda *a: decision('other'))  # the matcher links it
    test_db.expire_all()
    first = test_db.get(InboxMessage, linked_id)
    other = make_email(test_db, test_db.get(CandidateMailbox, mailbox_id), key='unlinked-synthetic')
    other.source_address, other.subject = first.source_address, 'Newsletter'
    other.body, other.snippet = encrypt_content('A general market newsletter without names.'), ''
    other.classification_state, other.sender_auth_result, other.receive_time_verified = 'PENDING', 'PASS', True
    test_db.commit()
    other_id = other.id
    assert worker.process_one(other_id, provider=lambda *a: decision('other'))
    test_db.expire_all()
    monkeypatch.setattr(config, 'CANDIDATE_EMAIL_PURGE_ENABLED', True)
    monkeypatch.setattr(config, 'CANDIDATE_EMAIL_PURGE_EVALUATED', True)
    monkeypatch.setattr(config, 'CANDIDATE_EMAIL_PURGE_EVALUATION_CONFIG_ID', test_db.query(EmailClassification).first().prompt_version)
    linked, unlinked = test_db.get(InboxMessage, linked_id), test_db.get(InboxMessage, other_id)
    assert linked.application_id is not None
    unlinked.application_id = None
    linked.other_purge_after, unlinked.other_purge_after = utcnow() - timedelta(minutes=2), utcnow() - timedelta(minutes=1)
    test_db.commit()
    assert purge_due(limit=1) == 1  # the older linked email is not the one batch row
    test_db.expire_all()
    assert test_db.get(InboxMessage, other_id).deleted_at is not None
    assert test_db.get(InboxMessage, linked_id).deleted_at is None


def test_purge_waits_for_a_pending_review_but_not_for_a_dismissed_one(test_db, pipeline, monkeypatch):
    """CodeRabbit #127: a review a BDE dismissed no longer keeps unlinked Other mail past its purge date."""
    from backend.inbox.retention import purge_due
    _, _, message_id = pipeline
    assert worker.process_one(message_id, provider=lambda *a: decision('other'))
    test_db.expire_all()
    result = test_db.query(EmailClassification).one()
    monkeypatch.setattr(config, 'CANDIDATE_EMAIL_PURGE_ENABLED', True)
    monkeypatch.setattr(config, 'CANDIDATE_EMAIL_PURGE_EVALUATED', True)
    monkeypatch.setattr(config, 'CANDIDATE_EMAIL_PURGE_EVALUATION_CONFIG_ID', result.prompt_version)
    row = test_db.get(InboxMessage, message_id)
    row.other_purge_after, row.application_id = utcnow() - timedelta(seconds=1), None
    review = ApplicationReview(firm_id=row.firm_id, candidate_id=row.candidate_id, inbox_message_id=row.id,
                               classification_id=result.id, classification_version=result.result_version,
                               reason='MANUAL_REVIEW')
    test_db.add(review)
    test_db.commit()
    assert purge_due() == 0  # a BDE is still deciding
    review.state = 'RESOLVED'  # dismissed: not about an application
    test_db.commit()
    assert purge_due() == 1
    assert row.subject == row.snippet == row.from_email == '' and row.body is None
    assert row.provider_message_id and row.source_address
    assert not test_db.query(EmailClassification).first()


def test_result_update_is_rejected(test_db, pipeline):
    _, _, message_id = pipeline
    assert worker.process_one(message_id, provider=lambda *a: decision())
    result = test_db.query(EmailClassification).one()
    with pytest.raises(DBAPIError):
        test_db.execute(text('UPDATE email_classifications SET confidence=.1 WHERE id=:id'), {'id': result.id})
        test_db.flush()
    test_db.rollback()


def test_owner_delete_hidden_content_and_derived_evidence(test_db, pipeline, api_client):
    _, _, message_id = pipeline
    assert worker.process_one(message_id, provider=lambda *a: decision('other'))
    test_db.expire_all()
    row = test_db.get(InboxMessage, message_id)
    result = api_client.delete(f'/api/firms/{row.firm_id}/candidates/{row.candidate_id}/inbox-content',
                               params={'message_id':str(row.id)})
    assert result.status_code == 200, result.text
    test_db.expire_all()
    assert test_db.get(InboxMessage,message_id).deleted_at
    assert not test_db.query(EmailClassification).first()


def test_retry_budget_is_bounded_and_waiting_is_not_erased(test_db, pipeline):
    _, _, message_id = pipeline
    calls=[]
    def fail(*a):
        calls.append(1)
        raise DeciderError('PROVIDER_UNAVAILABLE',retryable=True)
    for index in range(3):
        assert not worker.process_one(message_id,provider=fail)
        test_db.expire_all()
        row=test_db.get(InboxMessage,message_id)
        assert row.hidden_at is None and row.deleted_at is None
        if index<2:
            assert row.classification_state=='PENDING'
            assert not worker.process_one(message_id,provider=fail)
            row.classification_next_retry_at=utcnow()-timedelta(seconds=1)
            test_db.commit()
    assert len(calls)==3 and row.classification_state=='ERROR'
    assert not worker.process_one(message_id,provider=fail)


def test_review_link_and_confirmation_are_audited_idempotent_human_commands(test_db,pipeline,api_client):
    app_id, _, message_id=pipeline
    from backend.inbox.google_oauth import encrypt_content
    row=test_db.get(InboxMessage,message_id)
    row.body=encrypt_content('Assessment invitation for a different company and role.')
    test_db.commit()
    assert worker.process_one(message_id,provider=lambda *a:decision())
    test_db.expire_all()
    review=test_db.query(ApplicationReview).one()
    row=test_db.get(InboxMessage,message_id)
    path=f'/api/firms/{row.firm_id}/candidates/{row.candidate_id}/inbox-messages/{message_id}/review'
    body={'review_id':str(review.id),'command_id':str(uuid.uuid4()),'expected_review_revision':0,
          'expected_content_revision':0,'application_id':str(app_id),'expected_application_revision':0,
          'action':'SET_STATUS','status':'assessment'}
    result=api_client.patch(path,json=body)
    assert result.status_code==200,result.text
    replay=api_client.patch(path,json=body)
    assert replay.status_code==200,replay.text
    test_db.expire_all()
    assert test_db.get(Application,app_id).status=='assessment'
    assert test_db.query(ApplicationStatusEvent).count()==1
    assert test_db.query(ApplicationStatusEvent).one().actor_user_id is not None
    assert test_db.get(ApplicationReview,review.id).state=='RESOLVED'


@pytest.mark.parametrize(('current','category','text_body','reason'),[
    ('interview_scheduled','screening_call','Please attend a screening.','BACKWARD_STAGE'),
    ('interview_scheduled','interview_scheduled','Second interview round is scheduled.','REPEATED_ROUND'),
    # "next round": a repeat only at the same stage; a first shortlist or a forward move stays eligible.
    ('interview_scheduled','interview_scheduled','Your next round interview is on Tuesday.','REPEATED_ROUND'),
    ('applied','shortlisted','You have been shortlisted for the next round.','AUTO_STATUS_DISABLED'),
    ('shortlisted','interview_scheduled','Your next interview is scheduled for Tuesday.','AUTO_STATUS_DISABLED'),
    ('assessment','assessment','Please complete the assessment.','SAME_STAGE'),
    ('response','assessment','Please complete the assessment.','LEGACY_OR_CLOSED_STATUS'),
])
def test_policy_respects_current_stage_and_rounds(test_db,pipeline,current,category,text_body,reason):
    from backend.inbox.google_oauth import encrypt_content
    app_id,_,message_id=pipeline
    app=test_db.get(Application,app_id); app.status=current
    row=test_db.get(InboxMessage,message_id)
    row.application_id=app_id; row.body=encrypt_content(text_body)
    test_db.commit()
    assert worker.process_one(message_id,provider=lambda *a:decision(category))
    test_db.expire_all()
    assert test_db.query(EmailClassification).one().reason==reason
    assert test_db.get(Application,app_id).status==current
    if reason=='SAME_STAGE': assert not test_db.query(ApplicationReview).first()


def test_reclassification_after_resolved_review_appends_new_review(test_db,pipeline):
    _,_,message_id=pipeline
    assert worker.process_one(message_id,provider=lambda *a:decision())
    test_db.expire_all()
    first=test_db.query(ApplicationReview).one()
    first.state='RESOLVED'
    row=test_db.get(InboxMessage,message_id)
    row.classification_state='PENDING';row.classification_attempts=0
    test_db.commit()
    assert worker.process_one(message_id,provider=lambda *a:decision('shortlisted'))
    test_db.expire_all()
    assert test_db.query(ApplicationReview).count()==2
    assert test_db.query(ApplicationReview).filter_by(state='PENDING').one().classification_version==2
    assert test_db.get(ApplicationReview,first.id).state=='RESOLVED'


def test_import_captures_only_normalized_delivery_result(test_db,mailbox_case):
    from backend.inbox.gmail_sync import _store_message
    _,_,_,box=mailbox_case
    data={'labelIds':['INBOX'],'internalDate':str(int(utcnow().timestamp()*1000)),
          'threadId':'synthetic-delivery-thread','snippet':'Interview invitation',
          'payload':{'mimeType':'text/plain','body':{'data':'SW50ZXJ2aWV3IGludml0YXRpb24='},'headers':[
              {'name':'Received','value':'from sender.test by mx.google.com with ESMTPS'},
              {'name':'Authentication-Results','value':'mx.google.com; dmarc=pass header.from=example.test'},
              {'name':'From','value':'Recruiter <recruiter@example.test>'},
              {'name':'Subject','value':'Interview invitation'}]}}
    assert _store_message(test_db,box,'','delivery-evidence',None,message_data=data)
    test_db.commit()
    row=test_db.query(InboxMessage).filter_by(provider_message_id='delivery-evidence').one()
    assert row.sender_auth_result=='PASS' and row.receive_time_verified
    assert row.body.startswith('bqenc1:')
    assert 'Authentication-Results' not in str(row.__dict__)


def test_explicit_content_erasure_closes_pending_review_without_status_decision(test_db,pipeline,api_client):
    app_id,_,message_id=pipeline
    assert worker.process_one(message_id,provider=lambda *a:decision())
    test_db.expire_all()
    row=test_db.get(InboxMessage,message_id)
    review_id=test_db.query(ApplicationReview).one().id
    result=api_client.delete(f'/api/firms/{row.firm_id}/candidates/{row.candidate_id}/inbox-content',
                             params={'message_id':str(message_id)})
    assert result.status_code==200,result.text
    test_db.expire_all()
    review=test_db.get(ApplicationReview,review_id)
    assert review.state=='RESOLVED' and review.resolved_status is None
    assert 'no status decision' in review.note
    assert test_db.get(Application,app_id).status=='applied'
    assert test_db.query(ApplicationStatusEvent).count()==0
    moved=api_client.patch(f'/api/applications/{app_id}/candidate-status',
        json={'status':'screening_call','expected_revision':0})
    assert moved.status_code==200,moved.text


def test_manual_decision_during_provider_call_wins(test_db,pipeline,api_client):
    app_id,_,message_id=pipeline
    def provider(*args):
        result=api_client.patch(f'/api/applications/{app_id}/candidate-status',
            json={'status':'shortlisted','expected_revision':0})
        assert result.status_code==200,result.text
        return decision()
    assert worker.process_one(message_id,provider=provider)
    test_db.expire_all()
    assert test_db.get(Application,app_id).status=='shortlisted'
    assert test_db.query(ApplicationStatusEvent).count()==1
    assert test_db.query(EmailClassification).one().reason=='STALE_EMAIL'


def test_live_lease_blocks_a_second_provider_dispatch(test_db,pipeline):
    _,_,message_id=pipeline
    def provider(*args):
        def forbidden(*args): raise AssertionError('Second provider call must not occur')
        assert not worker.process_one(message_id,provider=forbidden)
        return decision()
    assert worker.process_one(message_id,provider=provider)
    assert test_db.query(EmailClassification).count()==1
    assert test_db.query(JobRun).filter_by(job_type='candidate_email_classification').count()==1


def test_reclaimed_lease_fences_old_provider_completion(test_db,pipeline):
    _,_,message_id=pipeline
    def old_provider(*args):
        test_db.expire_all()
        row=test_db.get(InboxMessage,message_id)
        row.classification_lease_until=utcnow()-timedelta(seconds=1)
        test_db.commit()
        assert worker.process_one(message_id,provider=lambda *a:decision('shortlisted'))
        return decision('assessment')
    assert not worker.process_one(message_id,provider=old_provider)
    test_db.expire_all()
    assert test_db.query(EmailClassification).one().category=='shortlisted'
    assert test_db.query(JobRun).filter_by(job_type='candidate_email_classification').count()==2


def test_unqueued_mail_never_dispatches_after_enable(test_db, pipeline, api_client):
    _, _, message_id = pipeline
    row = test_db.get(InboxMessage, message_id)
    row.classification_state = 'NOT_QUEUED'
    test_db.commit()
    def forbidden(*args): raise AssertionError('Historical mail must not be sent')
    assert not worker.process_one(message_id, provider=forbidden)
    assert worker.process_pending() == 0
    path = f'/api/firms/{row.firm_id}/candidates/{row.candidate_id}/inbox-messages/{row.id}/classification'
    for action in ('retry', 'reclassify'):
        response = api_client.post(path+'/'+action, json={'command_id':str(uuid.uuid4()),
            'expected_content_revision':0, 'expected_result_version':0})
        assert response.status_code == 409


def test_normalized_source_is_swept(test_db, pipeline, monkeypatch):
    from backend.models.candidates import CandidateMailbox
    _, mailbox_id, message_id = pipeline
    row = test_db.get(InboxMessage, message_id)
    box = test_db.get(CandidateMailbox, mailbox_id)
    box.address = '  '+box.address.upper()+'  '
    test_db.commit()
    original = worker.process_one
    monkeypatch.setattr(worker, 'process_one', lambda identity, **_: original(identity, provider=lambda *a:decision()))
    assert worker.process_pending() == 1
    test_db.expire_all()
    assert test_db.get(InboxMessage, message_id).classification_state == 'DONE'


def test_existing_application_link_blocks_other_hiding(test_db, pipeline):
    app_id, _, message_id = pipeline
    row = test_db.get(InboxMessage, message_id)
    row.application_id = app_id
    test_db.commit()
    assert worker.process_one(message_id, provider=lambda *a:decision('other'))
    test_db.expire_all()
    row = test_db.get(InboxMessage, message_id)
    assert row.hidden_at is None and row.other_purge_after is None
    assert row.application_id == app_id


def test_invalidated_dispatch_preserves_retry_budget(test_db, pipeline):
    _, _, message_id = pipeline
    def invalid(*args): raise DeciderError('WORK_INVALIDATED')
    for _ in range(4):
        assert not worker.process_one(message_id, provider=invalid)
        test_db.expire_all()
        row = test_db.get(InboxMessage, message_id)
        assert row.classification_state == 'PENDING'
        assert row.classification_attempts == 0
    assert worker.process_one(message_id, provider=lambda *a:decision())


@pytest.mark.parametrize('enabled', [False, True])
def test_import_only_queues_when_enabled(test_db, pipeline, monkeypatch, enabled):
    from backend.inbox.gmail_sync import _store_message
    from backend.models.candidates import CandidateMailbox
    _, mailbox_id, _ = pipeline
    monkeypatch.setattr(config, 'CANDIDATE_EMAIL_CLASSIFICATION_ENABLED', enabled)
    box = test_db.get(CandidateMailbox, mailbox_id)
    data = {'id':'queue-gate', 'threadId':'queue-gate', 'labelIds':['INBOX'], 'internalDate':'1793786400000',
        'snippet':'Synthetic message', 'payload':{'mimeType':'text/plain', 'body':{'data':'SGVsbG8='},
        'headers':[{'name':'From','value':'sender@example.test'}, {'name':'Subject','value':'Synthetic'}]}}
    assert _store_message(test_db, box, '', 'queue-gate', None, message_data=data)
    test_db.commit()
    row = test_db.query(InboxMessage).filter_by(provider_message_id='queue-gate').one()
    assert row.classification_state == ('PENDING' if enabled else 'NOT_QUEUED')
    if not enabled:
        monkeypatch.setattr(config, 'CANDIDATE_EMAIL_CLASSIFICATION_ENABLED', True)
        assert not worker.process_one(row.id, provider=lambda *a:pytest.fail('Backlog dispatched'))
