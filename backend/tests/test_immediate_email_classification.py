"""Imported mail starts classification after commit without waiting for a scheduler tick."""
from datetime import timedelta

import pytest

from backend.inbox import classification_worker as worker
from backend.inbox.decider import Classification, DeciderError
from backend.inbox.decider_categories import CATEGORIES, MODEL_ID
from backend.models.candidates import CandidateMailbox, InboxMessage
from backend.models.db import ApplicationStatusEvent, EmailClassification, SessionLocal, utcnow
from backend.tests.test_candidate_application_status import _saved_candidate_application


def _setup(db, accounts, firm_id):
    candidate, job, app, _, _, _ = _saved_candidate_application(db, accounts, firm_id, 'OWNER')
    job.title, job.company = 'Java Backend Engineer', 'Alderbyte Systems'
    app.status = 'applied'
    app.applied_at = app.status_effective_at = utcnow() - timedelta(days=1)
    mailbox = CandidateMailbox(firm_id=firm_id, candidate_id=candidate.id, address='candidate@example.test',
                               connected_by_user_id=accounts.user_id, status='CONNECTED',
                               refresh_token_ciphertext=b'cipher', history_id='checkpoint')
    db.add(mailbox)
    db.commit()
    return candidate, app, mailbox


def _message(db, mailbox, provider_id='instant-message'):
    message = InboxMessage(firm_id=mailbox.firm_id, candidate_id=mailbox.candidate_id, mailbox_id=mailbox.id,
                           provider_message_id=provider_id, from_name='Recruiter', from_email='recruiter@example.test',
                           subject='Java Backend Engineer at Alderbyte Systems', snippet='Complete the assessment.',
                           body='Complete the assessment.', received_at=utcnow())
    db.add(message)
    db.flush()
    return message


def _sync(db, mailbox, *, imported_message_ids=None):
    if db.query(InboxMessage.id).filter_by(mailbox_id=mailbox.id, provider_message_id='instant-message').first():
        return 0
    message = _message(db, mailbox)
    if imported_message_ids is not None:
        imported_message_ids.append(message.id)
    mailbox.last_synced_at = utcnow()
    return 1


def _provider(monkeypatch):
    calls = []
    def classify(subject, body):
        # A separate connection must see the committed import and worker lease.
        with SessionLocal() as independent:
            assert independent.query(InboxMessage.id).filter_by(classification_state='PROCESSING').first()
        calls.append(True)
        return Classification('assessment', {k: 0.9 if k == 'assessment' else 0.1 / 9 for k in CATEGORIES},
                              0.9, MODEL_ID, 'mock', 'mock-request')
    monkeypatch.setattr(worker, 'classify', classify)
    monkeypatch.setattr(worker, 'OPENROUTER_API_KEY', 'test-key')
    monkeypatch.setattr(worker, 'CANDIDATE_EMAIL_CLASSIFICATION_ENABLED', True)
    monkeypatch.setattr(worker, 'CANDIDATE_EMAIL_AUTO_STATUS_ENABLED', True)
    return calls


def test_manual_sync_classifies_committed_import_without_scheduler_and_deduplicates(
        api_client, test_db, accounts, jobs_in_default_firm, monkeypatch):
    from backend.api import routes_inbox
    candidate, app, mailbox = _setup(test_db, accounts, jobs_in_default_firm)
    calls = _provider(monkeypatch)
    monkeypatch.setattr(routes_inbox, 'sync_mailbox', _sync)
    path = f'/api/firms/{candidate.firm_id}/candidates/{candidate.id}/mailbox/sync'
    response = api_client.post(path)
    assert response.status_code == 200, response.text
    test_db.expire_all()
    message = test_db.query(InboxMessage).filter_by(mailbox_id=mailbox.id).one()
    assert message.classification_state == 'DONE'
    assert message.application_id == app.id and app.status == 'assessment'
    assert len(calls) == 1
    assert test_db.query(EmailClassification).filter_by(inbox_message_id=message.id).count() == 1
    assert test_db.query(ApplicationStatusEvent).filter_by(application_id=app.id).count() == 1
    assert api_client.post(path).status_code == 200
    assert len(calls) == 1
    assert test_db.query(EmailClassification).count() == 1


def test_oauth_import_starts_classification_without_scheduler(
        api_client, test_db, accounts, jobs_in_default_firm, monkeypatch):
    from backend.api import routes_inbox
    from backend.inbox import google_oauth
    from backend.models.candidates import CandidateGoogleOAuthAttempt
    candidate, app, mailbox = _setup(test_db, accounts, jobs_in_default_firm)
    calls = _provider(monkeypatch)
    state = 'one-time-oauth-state-for-test'
    test_db.add(CandidateGoogleOAuthAttempt(
        firm_id=candidate.firm_id, candidate_id=candidate.id, initiated_by_user_id=accounts.user_id,
        state_hash=google_oauth.state_digest(state), code_verifier_ciphertext=b'cipher',
        return_to='/acme/candidates/test?tab=inbox', expires_at=utcnow() + timedelta(minutes=5)))
    test_db.commit()
    monkeypatch.setattr(routes_inbox, 'exchange_code', lambda *args: (mailbox.address, 'mock-refresh'))
    monkeypatch.setattr(routes_inbox, 'encrypt_secret', lambda value: b'cipher')
    monkeypatch.setattr(google_oauth, 'decrypt_secret', lambda value: 'mock-verifier')
    monkeypatch.setattr(routes_inbox, 'sync_mailbox', _sync)
    response = api_client.get(f'/api/oauth/google/callback?state={state}&code=mock-code', follow_redirects=False)
    assert response.status_code == 303
    test_db.expire_all()
    assert test_db.query(InboxMessage).filter_by(mailbox_id=mailbox.id).one().classification_state == 'DONE'
    assert app.status == 'assessment' and len(calls) == 1


def test_failed_sync_does_not_dispatch_uncommitted_messages(
        api_client, test_db, accounts, jobs_in_default_firm, monkeypatch):
    from backend.api import routes_inbox
    candidate, app, mailbox = _setup(test_db, accounts, jobs_in_default_firm)
    calls = _provider(monkeypatch)
    def fail(db, mailbox, **kwargs):
        _sync(db, mailbox, **kwargs)
        raise RuntimeError('Mock sync failure')
    monkeypatch.setattr(routes_inbox, 'sync_mailbox', fail)
    response = api_client.post(f'/api/firms/{candidate.firm_id}/candidates/{candidate.id}/mailbox/sync')
    assert response.status_code == 502
    test_db.expire_all()
    assert test_db.query(InboxMessage).count() == 0 and calls == []
    assert app.status == 'applied'


def test_provider_failure_does_not_undo_import_or_report_gmail_failure(
        api_client, test_db, accounts, jobs_in_default_firm, monkeypatch):
    from backend.api import routes_inbox
    candidate, app, mailbox = _setup(test_db, accounts, jobs_in_default_firm)
    _provider(monkeypatch)
    def reject(*args):
        raise DeciderError('Decider rejected the classification request.')
    monkeypatch.setattr(worker, 'classify', reject)
    monkeypatch.setattr(routes_inbox, 'sync_mailbox', _sync)
    response = api_client.post(f'/api/firms/{candidate.firm_id}/candidates/{candidate.id}/mailbox/sync')
    assert response.status_code == 200
    test_db.expire_all()
    message = test_db.query(InboxMessage).filter_by(mailbox_id=mailbox.id).one()
    assert message.classification_state == 'ERROR' and message.classification_attempts == 1
    assert mailbox.last_sync_error is None and app.status == 'applied'


def test_scheduled_import_also_processes_after_commit_and_sweep_does_not_repeat(
        test_db, accounts, jobs_in_default_firm, monkeypatch):
    from backend import scheduler
    from backend.inbox import gmail_sync
    _, app, mailbox = _setup(test_db, accounts, jobs_in_default_firm)
    calls = _provider(monkeypatch)
    monkeypatch.setattr(gmail_sync, 'sync_mailbox', _sync)
    assert scheduler._sync_connected_candidate_mailboxes() == (1, 1)
    test_db.expire_all()
    assert test_db.query(InboxMessage).filter_by(mailbox_id=mailbox.id).one().classification_state == 'DONE'
    assert app.status == 'assessment'
    assert worker.classify_pending_messages() == 0
    assert scheduler._sync_connected_candidate_mailboxes() == (1, 0)
    assert len(calls) == 1 and test_db.query(EmailClassification).count() == 1


def test_explicit_retry_starts_processing_without_waiting_for_poll(
        api_client, test_db, accounts, jobs_in_default_firm, monkeypatch):
    candidate, app, mailbox = _setup(test_db, accounts, jobs_in_default_firm)
    message = _message(test_db, mailbox)
    message.classification_state = 'ERROR'
    message.classification_attempts = 3
    message.classification_error = 'Decider rejected the classification request.'
    test_db.commit()
    calls = _provider(monkeypatch)
    response = api_client.post(
        f'/api/firms/{candidate.firm_id}/candidates/{candidate.id}/inbox-messages/{message.id}/classification/retry')
    assert response.status_code == 200
    test_db.expire_all()
    assert message.classification_state == 'DONE' and message.classification_attempts == 1
    assert message.classification_error is None and app.status == 'assessment' and len(calls) == 1


@pytest.mark.parametrize(('enabled', 'has_key'), [(False, True), (True, False)])
def test_immediate_processing_respects_classification_gates(
        api_client, test_db, accounts, jobs_in_default_firm, monkeypatch, enabled, has_key):
    from backend.api import routes_inbox
    candidate, app, mailbox = _setup(test_db, accounts, jobs_in_default_firm)
    calls = _provider(monkeypatch)
    monkeypatch.setattr(worker, 'CANDIDATE_EMAIL_CLASSIFICATION_ENABLED', enabled)
    monkeypatch.setattr(worker, 'OPENROUTER_API_KEY', 'test-key' if has_key else '')
    monkeypatch.setattr(routes_inbox, 'sync_mailbox', _sync)
    response = api_client.post(f'/api/firms/{candidate.firm_id}/candidates/{candidate.id}/mailbox/sync')
    assert response.status_code == 200
    test_db.expire_all()
    message = test_db.query(InboxMessage).filter_by(mailbox_id=mailbox.id).one()
    assert message.classification_state == 'PENDING' and message.classification_attempts == 0
    assert app.status == 'applied' and calls == []


@pytest.mark.parametrize('wrong_scope', ['firm_id', 'candidate_id', 'mailbox_id'])
def test_immediate_processing_rechecks_scope_before_calling_provider(
        test_db, accounts, jobs_in_default_firm, monkeypatch, wrong_scope):
    import uuid
    candidate, _, mailbox = _setup(test_db, accounts, jobs_in_default_firm)
    message = _message(test_db, mailbox)
    test_db.commit()
    calls = _provider(monkeypatch)
    scope = dict(firm_id=candidate.firm_id, candidate_id=candidate.id, mailbox_id=mailbox.id)
    invalid_scope = {**scope, wrong_scope: uuid.uuid4()}
    assert worker.classify_imported_messages(**invalid_scope, message_ids=[message.id]) == 0
    assert calls == []
    test_db.expire_all()
    assert message.classification_state == 'PENDING'
    assert worker.classify_imported_messages(**scope, message_ids=[message.id, message.id]) == 1
    assert len(calls) == 1


def test_import_batch_larger_than_fifty_is_processed_without_a_poll(
        test_db, accounts, jobs_in_default_firm, monkeypatch):
    candidate, app, mailbox = _setup(test_db, accounts, jobs_in_default_firm)
    messages = [_message(test_db, mailbox, f'large-import-{n}') for n in range(53)]
    test_db.commit()
    calls = _provider(monkeypatch)
    ids = [m.id for m in messages]
    scope = dict(firm_id=candidate.firm_id, candidate_id=candidate.id, mailbox_id=mailbox.id)
    assert worker.classify_imported_messages(**scope, message_ids=ids + ids[:5]) == 53
    assert len(calls) == 53
    assert test_db.query(EmailClassification).count() == 53
    assert test_db.query(InboxMessage).filter_by(classification_state='DONE').count() == 53
    assert worker.classify_imported_messages(**scope, message_ids=ids) == 0
    assert len(calls) == 53


def test_scheduled_recovery_does_not_double_retry_a_new_transient_failure(
        test_db, accounts, jobs_in_default_firm, monkeypatch):
    import asyncio
    from backend import scheduler
    from backend.inbox import gmail_sync
    _, app, mailbox = _setup(test_db, accounts, jobs_in_default_firm)
    _provider(monkeypatch)
    healthy = worker.classify
    attempts = []
    def transient_once(subject, body):
        attempts.append(True)
        if len(attempts) == 1:
            raise DeciderError('Decider is temporarily unavailable after three attempts.', retryable=True)
        return healthy(subject, body)
    monkeypatch.setattr(worker, 'classify', transient_once)
    monkeypatch.setattr(gmail_sync, 'sync_mailbox', _sync)
    asyncio.run(scheduler.run_candidate_inbox_sync())
    test_db.expire_all()
    message = test_db.query(InboxMessage).filter_by(mailbox_id=mailbox.id).one()
    assert message.classification_state == 'PENDING' and message.classification_attempts == 1
    assert len(attempts) == 1 and app.status == 'applied'
    # A later tick's recovery sweep still picks the queued transient failure up.
    asyncio.run(scheduler.run_candidate_inbox_sync())
    test_db.expire_all()
    assert message.classification_state == 'DONE' and message.classification_attempts == 2
    assert len(attempts) == 2 and app.status == 'assessment'
