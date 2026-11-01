"""Candidate Gmail API: current authority, retention, concurrency and truthful audit."""
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from backend.models.candidates import CandidateMailbox, CandidateGoogleOAuthAttempt, InboxMessage
from backend.models.db import Application, ApplicationStatusEvent, utcnow
from backend.models.tenancy import Firm, LedgerEntry, User
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


def callback(client, state):
    return client.get('/api/oauth/google/callback', params={'state': state, 'code': 'synthetic-code'}, follow_redirects=False)


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
    assert callback(api_client, state).status_code == 400
    test_db.refresh(attempt)
    assert attempt.consumed_at is not None
    assert attempt.code_verifier_ciphertext == b''
    test_db.refresh(mailbox)
    assert mailbox.refresh_token_ciphertext == b'encrypted-test-value'
    entries = test_db.query(LedgerEntry).filter_by(candidate_id=candidate.id).all()
    assert len(entries) == 1 and entries[0].actor_user_id == accounts.user_id
    result = api_client.get(base(candidate) + '/inbox')
    assert result.status_code == 200
    assert 'ciphertext' not in result.text and 'private-refresh-token' not in result.text


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
    assert result.status_code == (404 if change == 'reassign' else 403), result.text
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
    monkeypatch.setattr(gmail_sync, '_api_get', lambda *args: {'threadId': 'same-thread', 'snippet': 'Different message', 'payload': {}})
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
    rows = test_db.query(LedgerEntry).filter_by(candidate_id=candidate.id).all()
    assert len(rows) == 2 and all(row.actor_user_id == accounts.user_id for row in rows)
    assert all(message.subject not in row.summary and message.body not in row.summary for row in rows)
    result = api_client.get(base(candidate) + '/inbox').json()
    assert result['connection']['status'] == 'DISCONNECTED'
    assert result['messages'][0]['body'] == message.body


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


def test_initial_sync_holds_account_lock(api_client, test_db, monkeypatch, mailbox_case):
    from backend.api import routes_inbox
    candidate, _, _, mailbox = mailbox_case
    state = oauth(api_client, monkeypatch, candidate)
    blocked = []
    def sync(db, connection, **kwargs):
        with test_db.get_bind().connect() as other:
            try: other.execute(text('SELECT id FROM candidate_mailboxes WHERE id=:id FOR UPDATE NOWAIT'), {'id': mailbox.id})
            except OperationalError:
                blocked.append(True)
                other.rollback()
        return 0
    monkeypatch.setattr(routes_inbox, 'sync_mailbox', sync)
    assert callback(api_client, state).status_code == 303
    assert blocked == [True]


def test_failed_sync_cannot_mark_a_new_connection_failed(api_client, test_db, monkeypatch, mailbox_case):
    from backend.api import routes_inbox
    candidate, _, _, mailbox = mailbox_case
    state = oauth(api_client, monkeypatch, candidate)
    def sync(db, connection, **kwargs):
        db.rollback()
        with Session(test_db.get_bind()) as other:
            row = other.get(CandidateMailbox, mailbox.id)
            row.address, row.connected_at = 'newer-account@example.test', utcnow()
            row.last_sync_error = None
            other.commit()
        raise RuntimeError('synthetic failure')
    monkeypatch.setattr(routes_inbox, 'sync_mailbox', sync)
    assert callback(api_client, state).status_code == 303
    test_db.refresh(mailbox)
    assert mailbox.address == 'newer-account@example.test' and mailbox.last_sync_error is None


def test_manual_sync_imports_without_classifying_or_moving_application(api_client, test_db, monkeypatch, mailbox_case):
    from backend.api import routes_inbox
    candidate, _, app, mailbox = mailbox_case
    def sync(db, connection, **kwargs):
        email(db, connection)
        connection.last_synced_at = utcnow()
        return 1
    monkeypatch.setattr(routes_inbox, 'sync_mailbox', sync)
    response = api_client.post(base(candidate) + '/mailbox/sync')
    assert response.status_code == 200, response.text
    assert response.json()['imported'] == 1
    test_db.refresh(app)
    assert app.status == 'saved'
    assert test_db.query(ApplicationStatusEvent).filter_by(application_id=app.id).count() == 0
    assert 'classification' not in response.json()['inbox']['messages'][0]


def test_scheduler_audits_imports_as_system_and_skips_suspended_firms(test_db, accounts, monkeypatch, mailbox_case):
    from backend import scheduler
    from backend.inbox import gmail_sync
    candidate, _, _, mailbox = mailbox_case
    calls = []
    def sync(db, connection):
        calls.append(connection.id)
        return 1
    monkeypatch.setattr(gmail_sync, 'sync_mailbox', sync)
    assert scheduler._sync_connected_candidate_mailboxes() == 1
    row = test_db.query(LedgerEntry).filter_by(candidate_id=candidate.id).one()
    assert row.actor_type == 'SYSTEM' and row.actor_user_id is None
    test_db.get(Firm, candidate.firm_id).status = 'SUSPENDED'
    test_db.commit()
    assert scheduler._sync_connected_candidate_mailboxes() == 0
    assert calls == [mailbox.id]


def test_failed_manual_import_rolls_back_rows_and_checkpoint(api_client, test_db, monkeypatch, mailbox_case):
    from backend.api import routes_inbox
    candidate, _, _, mailbox = mailbox_case
    original_checkpoint = mailbox.history_id
    def sync(db, connection, **kwargs):
        connection.history_id = 'must-roll-back'
        db.add(InboxMessage(firm_id=connection.firm_id, candidate_id=connection.candidate_id,
            mailbox_id=connection.id, provider_message_id='partial-import', from_name='Recruiter',
            from_email='recruiter@example.test', subject='Synthetic partial', snippet='Partial', received_at=utcnow()))
        db.flush()
        raise RuntimeError('private-provider-diagnostics')
    monkeypatch.setattr(routes_inbox, 'sync_mailbox', sync)
    response = api_client.post(base(candidate) + '/mailbox/sync')
    assert response.status_code == 502
    assert 'private-provider-diagnostics' not in response.text
    test_db.refresh(mailbox)
    assert mailbox.history_id == original_checkpoint
    assert mailbox.last_sync_error == 'Gmail sync failed. Retry or reconnect the candidate account.'
    assert test_db.query(InboxMessage).filter_by(provider_message_id='partial-import').count() == 0


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
