"""Candidate Gmail API: current authority, retention, concurrency and truthful audit."""
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from backend.models.candidates import CandidateMailbox, CandidateGoogleOAuthAttempt, InboxMessage
from backend.models.db import Application, ApplicationStatusEvent, utcnow
from backend.models.tenancy import Firm, ActivityEntry, User
from backend.tests.test_candidate_application_status import _saved_candidate_application


@pytest.fixture
def mailbox_case(test_db, accounts, jobs_in_default_firm):
    candidate, job, app, _, _, _ = _saved_candidate_application(test_db, accounts, jobs_in_default_firm, 'OWNER')
    mailbox = CandidateMailbox(firm_id=candidate.firm_id, candidate_id=candidate.id,
        address='old-account@example.test', connected_by_user_id=accounts.user_id,
        refresh_token_ciphertext=b'original-test-ciphertext')
    test_db.add(mailbox)
    test_db.commit()
    return candidate, job, app, mailbox


def email(db, mailbox, *, key='synthetic-message', application_id=None):
    row = InboxMessage(firm_id=mailbox.firm_id, candidate_id=mailbox.candidate_id, mailbox_id=mailbox.id,
        application_id=application_id, provider_message_id=key, thread_id='same-thread', from_name='Recruiter',
        from_email='recruiter@example.test', subject='Private synthetic subject', snippet='Offer',
        body='Private synthetic body', received_at=utcnow())
    db.add(row)
    db.commit()
    return row


def oauth(api_client, monkeypatch, candidate, *, address='old-account@example.test'):
    from backend.api import routes_inbox
    from backend.inbox.google_oauth import Authorization
    state = 'synthetic-oauth-' + uuid.uuid4().hex
    monkeypatch.setattr(routes_inbox, 'build_authorization', lambda: Authorization(
        'https://accounts.google.com/o/oauth2/v2/auth?state=' + state, state, 'private-verifier', 'challenge'))
    monkeypatch.setattr(routes_inbox, 'encrypt_secret', lambda value: b'encrypted-test-value')
    monkeypatch.setattr('backend.inbox.google_oauth.decrypt_secret', lambda value: 'private-verifier')
    monkeypatch.setattr(routes_inbox, 'exchange_code', lambda *args: (address, 'private-refresh-token'))
    monkeypatch.setattr(routes_inbox, 'sync_mailbox', lambda *args, **kwargs: 0)
    result = api_client.post(f'/api/firms/{candidate.firm_id}/candidates/{candidate.id}/mailbox/oauth',
        json={'return_to': f'/acme/candidates/{candidate.id}?tab=inbox'})
    assert result.status_code == 200, result.text
    return state


@pytest.fixture(autouse=True)
def offline_mailbox_provider(monkeypatch):
    from backend.api import routes_inbox
    monkeypatch.setattr(routes_inbox, 'revoke_token', lambda *args, **kwargs: True)
    monkeypatch.setattr(routes_inbox, 'run_import', lambda *args, **kwargs: 0)


def callback(client, state):
    from urllib.parse import urlparse, parse_qs
    response = client.get('/api/oauth/google/callback', params={'state': state, 'code': 'synthetic-code'}, follow_redirects=False)
    if response.status_code == 303:
        query = parse_qs(urlparse(response.headers['location']).query)
        if 'mailbox_confirmation' in query:
            from backend.models.db import SessionLocal
            with SessionLocal() as db:
                attempt = db.get(CandidateGoogleOAuthAttempt, uuid.UUID(query['mailbox_confirmation'][0]))
                path = f'/api/firms/{attempt.firm_id}/candidates/{attempt.candidate_id}/mailbox/confirm/{attempt.id}'
            confirmed = client.post(path)
            if confirmed.status_code != 200:
                return confirmed
    return response


def base(candidate):
    return f'/api/firms/{candidate.firm_id}/candidates/{candidate.id}'


def test_oauth_state_is_encrypted_bound_and_one_use(api_client, test_db, accounts, monkeypatch, mailbox_case):
    candidate, _, _, mailbox = mailbox_case
    state = oauth(api_client, monkeypatch, candidate)
    attempt = test_db.query(CandidateGoogleOAuthAttempt).one()
    assert attempt.state_hash != state
    assert attempt.code_verifier_ciphertext == b'encrypted-test-value'
    assert attempt.initiated_by_user_id == accounts.user_id
    assert callback(api_client, state).status_code == 303
    assert callback(api_client, state).status_code == 303
    test_db.refresh(attempt)
    assert attempt.consumed_at is not None
    assert attempt.code_verifier_ciphertext == b''
    test_db.refresh(mailbox)
    assert mailbox.refresh_token_ciphertext == b'encrypted-test-value'
    entries = test_db.query(ActivityEntry).filter_by(candidate_id=candidate.id).all()
    assert len(entries) == 1 and entries[0].actor_user_id == accounts.user_id
    result = api_client.get(base(candidate) + '/inbox')
    assert result.status_code == 200
    assert 'ciphertext' not in result.text and 'private-refresh-token' not in result.text


def test_support_view_cannot_read_email_body_or_snippet(anonymous_client, test_db, accounts, mailbox_case):
    candidate, _, _, mailbox = mailbox_case
    email(test_db, mailbox)
    admin = {'cookie': f'bq_session={accounts.admin_token}'}
    owner = {'cookie': f'bq_session={accounts.firm_token}'}
    result = anonymous_client.post('/api/support-views', json={
        'firm_id': str(candidate.firm_id), 'reason': 'Investigate candidate inbox issue'}, headers=admin)
    assert result.status_code == 200, result.text
    response = anonymous_client.get(base(candidate) + '/inbox', headers=admin)
    assert response.status_code == 200, response.text
    assert response.json()['messages'] == []
    assert 'Private synthetic subject' not in response.text
    assert 'recruiter@example.test' not in response.text
    response = anonymous_client.get(base(candidate) + '/inbox', params={'message_id': str(test_db.query(InboxMessage).filter_by(mailbox_id=mailbox.id).one().id)}, headers=owner)
    assert response.status_code == 200, response.text
    assert response.json()['messages'][0]['body'] == 'Private synthetic body'


@pytest.mark.parametrize('stage', ['before', 'after'])
@pytest.mark.parametrize('change', ['demote', 'suspend', 'reassign'])
def test_callback_rechecks_authority_around_provider_exchange(api_client, test_db, accounts, monkeypatch, mailbox_case, stage, change):
    from backend.api import routes_inbox
    candidate, _, _, mailbox = mailbox_case
    user = test_db.get(User, accounts.user_id)
    user.role = 'BDE'
    candidate.bde_id = user.id
    test_db.commit()
    state = oauth(api_client, monkeypatch, candidate)
    def revoke():
        if change == 'demote': user.role = 'VIEWER'
        elif change == 'suspend': test_db.get(Firm, candidate.firm_id).status = 'SUSPENDED'
        else: candidate.bde_id = None
        test_db.commit()
    if stage == 'before': revoke()
    else:
        def exchange(*args):
            revoke()
            return mailbox.address, 'private-refresh'
        monkeypatch.setattr(routes_inbox, 'exchange_code', exchange)
    result = callback(api_client, state)
    assert result.status_code == 303 and result.headers['location'] == '/?mailbox=failed', result.text
    test_db.refresh(mailbox)
    assert mailbox.refresh_token_ciphertext == b'original-test-ciphertext'


@pytest.mark.parametrize('operation', ['connect', 'sync', 'disconnect', 'read'])
def test_viewer_cannot_write_mailbox(api_client, test_db, accounts, mailbox_case, operation):
    candidate, _, _, mailbox = mailbox_case
    message = email(test_db, mailbox)
    test_db.get(User, accounts.user_id).role = 'VIEWER'
    test_db.commit()
    if operation == 'connect': result = api_client.post(base(candidate) + '/mailbox/oauth', json={'return_to': '/'})
    elif operation == 'sync': result = api_client.post(base(candidate) + '/mailbox/sync')
    elif operation == 'disconnect': result = api_client.delete(base(candidate) + '/mailbox')
    else: result = api_client.patch(base(candidate) + f'/inbox-messages/{message.id}/read')
    assert result.status_code == 403


@pytest.mark.parametrize('status', ['CONNECTED', 'ERROR'])
def test_active_account_replacement_requires_disconnect(api_client, test_db, monkeypatch, mailbox_case, status):
    candidate, _, _, mailbox = mailbox_case
    mailbox.status = status
    test_db.commit()
    state = oauth(api_client, monkeypatch, candidate, address='other-account@example.test')
    assert callback(api_client, state).status_code == 409
    test_db.refresh(mailbox)
    assert mailbox.address == 'old-account@example.test'


def test_disconnect_retains_old_mail_and_new_account_has_separate_provider_ids(api_client, test_db, monkeypatch, mailbox_case):
    from backend.inbox import gmail_sync
    candidate, _, app, mailbox = mailbox_case
    old = email(test_db, mailbox, key='same-provider-id', application_id=app.id)
    assert api_client.delete(base(candidate) + '/mailbox').status_code == 200
    state = oauth(api_client, monkeypatch, candidate, address='new-account@example.test')
    assert callback(api_client, state).status_code == 303
    test_db.refresh(mailbox)
    monkeypatch.setattr(gmail_sync, '_api_get', lambda *args: {'labelIds': ['INBOX'], 'threadId': 'same-thread', 'snippet': 'Different message', 'payload': {}})
    assert gmail_sync._store_message(test_db, mailbox, 'token', 'same-provider-id', object())
    assert not gmail_sync._store_message(test_db, mailbox, 'token', 'same-provider-id', object())
    test_db.commit()
    rows = test_db.query(InboxMessage).filter_by(mailbox_id=mailbox.id, provider_message_id='same-provider-id').all()
    assert len(rows) == 2
    assert {row.source_address for row in rows} == {'old-account@example.test', 'new-account@example.test'}
    assert next(row for row in rows if row.id != old.id).application_id is None
    assert old.application_id == app.id
    assert api_client.get(base(candidate) + '/inbox').json()['messages']


def test_read_disconnect_idempotency_and_safe_audit(api_client, test_db, accounts, mailbox_case):
    candidate, _, _, mailbox = mailbox_case
    message = email(test_db, mailbox)
    for _ in range(2):
        assert api_client.patch(base(candidate) + f'/inbox-messages/{message.id}/read').status_code == 200
        assert api_client.delete(base(candidate) + '/mailbox').status_code == 200
    test_db.refresh(message)
    test_db.refresh(mailbox)
    assert message.source_address == 'old-account@example.test'
    assert mailbox.refresh_token_ciphertext is None and mailbox.history_id is None
    rows = test_db.query(ActivityEntry).filter_by(candidate_id=candidate.id).all()
    assert len(rows) == 1 and all(row.actor_user_id == accounts.user_id for row in rows)
    assert all(message.subject not in row.summary and message.body not in row.summary for row in rows)
    result = api_client.get(base(candidate) + '/inbox').json()
    assert result['connection']['status'] == 'DISCONNECTED'
    assert result['messages'][0]['body'] == ''
    detail = api_client.get(base(candidate) + '/inbox', params={'message_id': str(message.id)}).json()
    assert detail['messages'][0]['body'] == message.body


def test_provider_failure_preserves_old_credentials(api_client, test_db, monkeypatch, mailbox_case):
    from backend.api import routes_inbox
    candidate, _, _, mailbox = mailbox_case
    state = oauth(api_client, monkeypatch, candidate)
    def failure(*args): raise RuntimeError('provider-private-response')
    monkeypatch.setattr(routes_inbox, 'exchange_code', failure)
    result = callback(api_client, state)
    assert result.status_code == 303 and 'mailbox=failed' in result.headers['location']
    assert 'provider-private-response' not in result.text
    test_db.refresh(mailbox)
    assert mailbox.refresh_token_ciphertext == b'original-test-ciphertext'


@pytest.fixture
def import_provider(monkeypatch):
    from backend.inbox import sync_jobs
    class HTTP:
        def __enter__(self): return self
        def __exit__(self, *args): pass
    monkeypatch.setattr(sync_jobs.httpx, 'Client', lambda **kwargs: HTTP())
    monkeypatch.setattr(sync_jobs, 'decrypt_secret', lambda value: 'synthetic')
    monkeypatch.setattr(sync_jobs.gmail, '_refresh_access_token', lambda *args: 'access')
    def api(http, path, token, params=None):
        if path == 'profile': return {'historyId': '1'}
        if path == 'messages': return {'messages': [{'id': 'message-1'}]}
        if path == 'history': return {'historyId': '2', 'history': []}
        return {'labelIds': ['INBOX'], 'snippet': 'Private imported body', 'payload': {}}
    monkeypatch.setattr(sync_jobs.gmail, '_api_get', api)
    return sync_jobs, api


def test_import_fetch_does_not_hold_mailbox_lock_and_encrypts_content(test_db, mailbox_case, monkeypatch, import_provider):
    jobs, api = import_provider
    candidate, _, _, mailbox = mailbox_case
    def fetch(*args, **kwargs):
        from backend.models.db import engine
        with engine.begin() as other:
            other.execute(text('SELECT id FROM candidate_mailboxes WHERE id=:id FOR UPDATE NOWAIT'), {'id': mailbox.id})
        return api(*args, **kwargs)
    monkeypatch.setattr(jobs.gmail, '_api_get', fetch)
    assert jobs.run_import(candidate.firm_id, candidate.id, mailbox.connected_at) == 1
    test_db.expire_all()
    row = test_db.query(InboxMessage).one()
    assert row.body.startswith('bqenc1:') and 'Private imported body' not in row.body
    assert mailbox.sync_state == 'IDLE' and mailbox.history_id == '2'
    audit = test_db.query(ActivityEntry).filter_by(candidate_id=candidate.id).one()
    assert audit.actor_type == 'SYSTEM' and audit.actor_user_id is None


def test_disconnect_during_fetch_prevents_late_writes(test_db, mailbox_case, monkeypatch, import_provider):
    jobs, api = import_provider
    candidate, _, _, mailbox = mailbox_case
    def fetch(http, path, token, params=None):
        if path.startswith('messages/'):
            from backend.models.db import SessionLocal
            with SessionLocal() as other:
                row = other.get(CandidateMailbox, mailbox.id)
                row.status = 'DISCONNECTED'
                row.sync_job_id = None
                row.refresh_token_ciphertext = None
                other.commit()
        return api(http, path, token, params)
    monkeypatch.setattr(jobs.gmail, '_api_get', fetch)
    jobs.run_import(candidate.firm_id, candidate.id, mailbox.connected_at)
    test_db.expire_all()
    assert test_db.query(InboxMessage).count() == 0
    assert mailbox.status == 'DISCONNECTED'


def test_revoked_access_stops_scheduler_retries(test_db, mailbox_case, monkeypatch, import_provider):
    jobs, _ = import_provider
    candidate, _, _, mailbox = mailbox_case
    def expired(*args): raise jobs.gmail.ReconnectRequired('synthetic')
    monkeypatch.setattr(jobs.gmail, '_refresh_access_token', expired)
    jobs.run_import(candidate.firm_id, candidate.id, mailbox.connected_at)
    test_db.expire_all()
    assert mailbox.status == 'ERROR' and 'Reconnect' in mailbox.last_sync_error
    from backend import scheduler
    assert scheduler._sync_connected_candidate_mailboxes() == 0


def test_scheduler_skips_suspended_firms(test_db, mailbox_case, monkeypatch, import_provider):
    jobs, _ = import_provider
    candidate, _, _, mailbox = mailbox_case
    test_db.get(Firm, candidate.firm_id).status = 'SUSPENDED'
    test_db.commit()
    from backend import scheduler
    assert scheduler._sync_connected_candidate_mailboxes() == 0
    assert test_db.query(InboxMessage).count() == 0


def test_failed_import_preserves_saved_batches_without_advancing_checkpoint(test_db, mailbox_case, monkeypatch, import_provider):
    jobs, api = import_provider
    candidate, _, _, mailbox = mailbox_case
    def fetch(http, path, token, params=None):
        if path == 'messages': return {'messages': [{'id': str(i)} for i in range(11)]}
        if path == 'messages/10': raise RuntimeError('private-provider-detail')
        return api(http, path, token, params)
    monkeypatch.setattr(jobs.gmail, '_api_get', fetch)
    jobs.run_import(candidate.firm_id, candidate.id, mailbox.connected_at)
    test_db.expire_all()
    assert test_db.query(InboxMessage).count() == 10
    assert mailbox.history_id is None and mailbox.sync_state == 'FAILED'
    assert mailbox.last_sync_error == 'Sync failed. Try again.'


def test_manual_sync_queues_before_background_import(api_client, test_db, monkeypatch, mailbox_case):
    from backend.api import routes_inbox
    candidate, _, app, mailbox = mailbox_case
    calls = []
    monkeypatch.setattr(routes_inbox, 'run_import', lambda *args: calls.append(args))
    result = api_client.post(base(candidate) + '/mailbox/sync')
    assert result.status_code == 200 and result.json()['imported'] == 0
    assert result.json()['inbox']['connection']['sync_state'] == 'QUEUED'
    assert len(calls) == 1
    test_db.refresh(app)
    assert app.status == 'saved'
    assert test_db.query(ApplicationStatusEvent).count() == 0


def test_expired_checkpoint_retries_only_once(test_db, mailbox_case, monkeypatch):
    import httpx
    from backend.inbox import gmail_sync
    _, _, _, mailbox = mailbox_case
    monkeypatch.setattr(gmail_sync, 'decrypt_secret', lambda value: 'synthetic-refresh')
    monkeypatch.setattr(gmail_sync, '_refresh_access_token', lambda *args: 'synthetic-access')
    history_calls = []
    def api(client, path, token, params=None):
        if path == 'profile': return {'historyId':'fresh-checkpoint'}
        if path == 'messages': return {'messages':[]}
        history_calls.append(path)
        request = httpx.Request('GET', 'https://gmail.googleapis.com/test')
        raise httpx.HTTPStatusError('expired', request=request, response=httpx.Response(404, request=request))
    monkeypatch.setattr(gmail_sync, '_api_get', api)
    with pytest.raises(RuntimeError, match='newly-created Gmail history checkpoint'):
        gmail_sync.sync_mailbox(test_db, mailbox, client=object())
    assert history_calls == ['history','history']


def test_delete_content_keeps_history_reference_and_prevents_reimport(api_client, test_db, mailbox_case):
    from backend.models.db import ApplicationReview
    candidate, _, app, mailbox = mailbox_case
    message = email(test_db, mailbox, application_id=app.id)
    review = ApplicationReview(firm_id=candidate.firm_id, candidate_id=candidate.id, application_id=app.id,
        inbox_message_id=message.id, reason='LOW_CONFIDENCE', application_revision=0)
    test_db.add(review)
    test_db.commit()
    result = api_client.delete(base(candidate) + '/inbox-content', params={'message_id': str(message.id)})
    assert result.status_code == 200 and result.json()['messages'] == []
    test_db.refresh(message)
    test_db.refresh(review)
    assert message.body is None and message.snippet == '' and message.deleted_at is not None
    assert review.inbox_message_id == message.id
    assert message.provider_message_id == 'synthetic-message'
    assert test_db.query(ActivityEntry).filter_by(candidate_id=candidate.id).count() == 1


def test_bde_cannot_delete_content(api_client, test_db, accounts, mailbox_case):
    candidate, _, _, mailbox = mailbox_case
    message = email(test_db, mailbox)
    test_db.get(User, accounts.user_id).role = 'BDE'
    candidate.bde_id = accounts.user_id
    test_db.commit()
    assert api_client.delete(base(candidate) + '/inbox-content').status_code == 403
    test_db.refresh(message)
    assert message.deleted_at is None and message.body == 'Private synthetic body'


def test_disconnect_revoke_failure_is_visible_and_local_credentials_still_removed(api_client, test_db, monkeypatch, mailbox_case):
    from backend.api import routes_inbox
    candidate, _, _, mailbox = mailbox_case
    monkeypatch.setattr(routes_inbox, 'decrypt_secret', lambda value: 'synthetic')
    monkeypatch.setattr(routes_inbox, 'revoke_token', lambda value: False)
    result = api_client.delete(base(candidate) + '/mailbox')
    assert result.status_code == 200
    test_db.refresh(mailbox)
    assert mailbox.status == 'DISCONNECTED' and mailbox.refresh_token_ciphertext is None
    assert 'myaccount.google.com' in mailbox.last_sync_error


def test_oauth_requires_explicit_confirmation_before_replacing_credentials(api_client, test_db, monkeypatch, mailbox_case):
    candidate, _, _, mailbox = mailbox_case
    state = oauth(api_client, monkeypatch, candidate)
    old = mailbox.refresh_token_ciphertext
    result = api_client.get('/api/oauth/google/callback', params={'state': state, 'code': 'synthetic'}, follow_redirects=False)
    assert result.status_code == 303 and 'mailbox_confirmation=' in result.headers['location']
    test_db.refresh(mailbox)
    assert mailbox.refresh_token_ciphertext == old
    attempt = test_db.query(CandidateGoogleOAuthAttempt).one()
    assert attempt.pending_address == mailbox.address and attempt.pending_token_ciphertext is not None
    assert attempt.confirmed_at is None
    assert test_db.query(ActivityEntry).filter_by(candidate_id=candidate.id).count() == 0


def test_duplicate_mailbox_confirmation_does_not_reveal_other_candidate(api_client, test_db, accounts, monkeypatch, mailbox_case, jobs_in_default_firm):
    candidate, _, _, mailbox = mailbox_case
    from backend.models.candidates import Candidate
    other = Candidate(firm_id=candidate.firm_id, manager_id=candidate.manager_id, created_by_user_id=accounts.user_id, full_name='Other private candidate', work_auth='H1B', primary_role='Engineer')
    test_db.add(other)
    test_db.flush()
    test_db.add(CandidateMailbox(firm_id=other.firm_id, candidate_id=other.id, address='duplicate@example.test',
        connected_by_user_id=accounts.user_id, status='CONNECTED'))
    test_db.commit()
    state = oauth(api_client, monkeypatch, candidate, address='duplicate@example.test')
    result = callback(api_client, state)
    assert result.status_code == 409
    assert str(other.id) not in result.text
    test_db.refresh(mailbox)
    assert mailbox.address == 'old-account@example.test'


def test_manager_can_delete_candidate_content(api_client, test_db, accounts, mailbox_case):
    candidate, _, _, mailbox = mailbox_case
    row = email(test_db, mailbox)
    test_db.get(User, accounts.user_id).role = 'MANAGER'
    candidate.manager_id = accounts.user_id
    test_db.commit()
    result = api_client.delete(base(candidate) + '/inbox-content', params={'message_id': str(row.id)})
    assert result.status_code == 200
    test_db.refresh(row)
    assert row.deleted_at is not None
