"""Account replacement, retained identity and business audit behavior."""
import pytest
from backend.models.candidates import InboxMessage
from backend.models.tenancy import LedgerEntry
from backend.tests.test_pr_safety_regressions import case, _oauth
from backend.tests.test_email_application_matching import _email


def entries(db, candidate):
    return db.query(LedgerEntry).filter_by(firm_id=candidate.firm_id, candidate_id=candidate.id).all()


def test_reconnect_and_replay_keep_credentials_and_audit_once(api_client, test_db, accounts, monkeypatch, case):
    candidate, _, _, mailbox = case
    state = _oauth(api_client, test_db, accounts, monkeypatch, candidate, address=mailbox.address)
    path = '/api/oauth/google/callback'
    params = {'state': state, 'code': 'synthetic'}
    assert api_client.get(path, params=params, follow_redirects=False).status_code == 303
    test_db.refresh(mailbox)
    assert mailbox.refresh_token_ciphertext == b'synthetic-encrypted-value'
    assert len(entries(test_db, candidate)) == 1
    assert api_client.get(path, params=params, follow_redirects=False).status_code == 400
    assert len(entries(test_db, candidate)) == 1


def test_failed_reconnect_retains_existing_credential(api_client, test_db, accounts, monkeypatch, case):
    from backend.api import routes_inbox
    candidate, _, _, mailbox = case
    mailbox.refresh_token_ciphertext = b'original-synthetic-credential'
    test_db.commit()
    state = _oauth(api_client, test_db, accounts, monkeypatch, candidate, address=mailbox.address)
    def failed(*args):
        raise RuntimeError('synthetic provider failure')
    monkeypatch.setattr(routes_inbox, 'exchange_code', failed)
    response = api_client.get('/api/oauth/google/callback', params={'state': state, 'code': 'synthetic'}, follow_redirects=False)
    assert response.status_code == 303 and 'mailbox=failed' in response.headers['location']
    test_db.refresh(mailbox)
    assert mailbox.refresh_token_ciphertext == b'original-synthetic-credential'
    assert entries(test_db, candidate) == []


def test_read_and_disconnect_are_audited_only_when_changed(api_client, test_db, accounts, case):
    candidate, _, _, mailbox = case
    message = _email(test_db, mailbox)
    base = f'/api/firms/{candidate.firm_id}/candidates/{candidate.id}'
    for _ in range(2):
        assert api_client.patch(base + f'/inbox-messages/{message.id}/read').status_code == 200
        assert api_client.delete(base + '/mailbox').status_code == 200
    rows = entries(test_db, candidate)
    assert len(rows) == 2
    assert all(row.actor_user_id == accounts.user_id for row in rows)
    assert all(message.subject not in row.summary and message.body not in row.summary for row in rows)
    test_db.refresh(message)
    assert message.source_address == mailbox.address.lower()
    assert test_db.get(InboxMessage, message.id) is not None


def test_different_accounts_can_import_identical_provider_ids_without_reusing_threads(api_client, test_db, accounts, monkeypatch, case):
    from backend.inbox import gmail_sync
    from backend.inbox.application_matching import matching_application_id
    candidate, _, app, mailbox = case
    old = _email(test_db, mailbox, key='shared-provider-id', thread_id='shared-thread', application_id=app.id)
    original_address = mailbox.address
    base = f'/api/firms/{candidate.firm_id}/candidates/{candidate.id}'
    assert api_client.delete(base + '/mailbox').status_code == 200
    state = _oauth(api_client, test_db, accounts, monkeypatch, candidate, address='new-account@example.test')
    assert api_client.get('/api/oauth/google/callback', params={'state': state, 'code': 'synthetic'}, follow_redirects=False).status_code == 303
    test_db.refresh(mailbox)
    monkeypatch.setattr(gmail_sync, '_api_get', lambda *args: {'threadId': 'shared-thread', 'snippet': 'Unrelated news', 'payload': {}})
    assert gmail_sync._store_message(test_db, mailbox, 'synthetic-token', 'shared-provider-id', object())
    test_db.commit()
    rows = test_db.query(InboxMessage).filter_by(mailbox_id=mailbox.id, provider_message_id='shared-provider-id').all()
    assert len(rows) == 2
    new = next(row for row in rows if row.id != old.id)
    assert old.source_address == original_address
    assert new.source_address == 'new-account@example.test'
    assert new.application_id is None
    assert matching_application_id(test_db, mailbox, new) is None
    assert not gmail_sync._store_message(test_db, mailbox, 'synthetic-token', 'shared-provider-id', object())


def test_manual_sync_and_explicit_retry_record_success(api_client, test_db, accounts, monkeypatch, case):
    from backend.api import routes_inbox
    candidate, _, _, mailbox = case
    message = _email(test_db, mailbox)
    message.classification_state = 'ERROR'
    test_db.commit()
    monkeypatch.setattr(routes_inbox, 'sync_mailbox', lambda *args, **kwargs: 0)
    monkeypatch.setattr(routes_inbox, 'classify_imported_messages', lambda **kwargs: 0)
    base = f'/api/firms/{candidate.firm_id}/candidates/{candidate.id}'
    assert api_client.post(base + '/mailbox/sync').status_code == 200
    retry = base + f'/inbox-messages/{message.id}/classification/retry'
    assert api_client.post(retry).status_code == 200
    assert api_client.post(retry).status_code == 409
    assert len(entries(test_db, candidate)) == 2
    assert {row.actor_type for row in entries(test_db, candidate)} == {'USER'}
