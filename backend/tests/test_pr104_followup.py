"""Regression cases for Abdul's c98538d follow-up; synthetic mail/provider only."""
from datetime import timedelta
from urllib.parse import urlsplit, parse_qs
import uuid

import pytest

from backend.models.candidates import CandidateGoogleOAuthAttempt, InboxMessage
from backend.models.tenancy import LedgerEntry, User
from backend.models.db import utcnow
from backend.tests.test_candidate_mailbox import (mailbox_case, offline_mailbox_provider, import_provider,
    email, oauth, base)


def pending(client, monkeypatch, candidate, address='fresh@example.test'):
    state = oauth(client, monkeypatch, candidate, address=address)
    response = client.get('/api/oauth/google/callback', params={'state': state, 'code': 'synthetic'}, follow_redirects=False)
    assert response.status_code == 303
    return parse_qs(urlsplit(response.headers['location']).query)['mailbox_confirmation'][0]


def test_confirmation_can_be_cancelled_and_not_replayed(api_client, test_db, monkeypatch, mailbox_case):
    from backend.api import routes_inbox
    candidate, _, _, _ = mailbox_case
    attempt = pending(api_client, monkeypatch, candidate)
    calls = []
    monkeypatch.setattr(routes_inbox, 'decrypt_secret', lambda value: 'synthetic-refresh')
    monkeypatch.setattr(routes_inbox, 'revoke_token', lambda token: calls.append(token) or True)
    path = base(candidate) + '/mailbox/confirm/' + attempt
    assert api_client.delete(path).status_code == 200
    assert api_client.delete(path).status_code == 200
    assert calls == ['synthetic-refresh']
    assert api_client.post(path).status_code == 409
    test_db.expire_all()
    assert test_db.get(CandidateGoogleOAuthAttempt, uuid.UUID(attempt)).pending_token_ciphertext is None


def test_cancel_same_live_account_does_not_revoke(api_client, test_db, monkeypatch, mailbox_case):
    from backend.api import routes_inbox
    candidate, _, _, mailbox = mailbox_case
    attempt = pending(api_client, monkeypatch, candidate, mailbox.address)
    calls = []
    monkeypatch.setattr(routes_inbox, 'revoke_token', lambda token: calls.append(token) or True)
    assert api_client.delete(base(candidate) + '/mailbox/confirm/' + attempt).status_code == 200
    assert calls == []
    test_db.refresh(mailbox)
    assert mailbox.status == 'CONNECTED'


def test_expired_grant_cleanup_retries_revocation_without_losing_token(api_client, test_db, monkeypatch, mailbox_case):
    from backend.api import routes_inbox
    candidate, _, _, _ = mailbox_case
    attempt_id = pending(api_client, monkeypatch, candidate)
    attempt = test_db.get(CandidateGoogleOAuthAttempt, uuid.UUID(attempt_id))
    attempt.expires_at = utcnow() - timedelta(seconds=1)
    test_db.commit()
    monkeypatch.setattr(routes_inbox, 'decrypt_secret', lambda value: 'synthetic-refresh')
    monkeypatch.setattr(routes_inbox, 'revoke_token', lambda token: False)
    assert routes_inbox.cleanup_expired_grants() == 0
    test_db.refresh(attempt)
    assert attempt.pending_token_ciphertext is not None
    monkeypatch.setattr(routes_inbox, 'revoke_token', lambda token: True)
    assert routes_inbox.cleanup_expired_grants() == 1
    test_db.refresh(attempt)
    assert attempt.pending_token_ciphertext is None


def test_confirmation_attestation_survives_cleanup_and_contains_address(api_client, test_db, monkeypatch, mailbox_case):
    candidate, _, _, mailbox = mailbox_case
    attempt_id = pending(api_client, monkeypatch, candidate, mailbox.address)
    assert api_client.post(base(candidate) + '/mailbox/confirm/' + attempt_id).status_code == 200
    entry = test_db.query(LedgerEntry).filter_by(candidate_id=candidate.id).one()
    assert mailbox.address in entry.summary
    assert 'v1' in entry.summary
    test_db.delete(test_db.get(CandidateGoogleOAuthAttempt, uuid.UUID(attempt_id)))
    test_db.commit()
    assert test_db.get(LedgerEntry, entry.id).candidate_id == candidate.id

    old_address = mailbox.address
    assert api_client.delete(base(candidate) + '/mailbox').status_code == 200
    replacement = pending(api_client, monkeypatch, candidate, 'replacement@example.test')
    assert api_client.post(base(candidate) + '/mailbox/confirm/' + replacement).status_code == 200
    test_db.refresh(entry)
    assert old_address in entry.summary and 'replacement@example.test' not in entry.summary


def test_cursor_pagination_stable_with_new_arrivals_and_timestamp_ties(api_client, test_db, mailbox_case):
    candidate, _, _, mailbox = mailbox_case
    timestamp = utcnow()
    for i in range(5):
        row = email(test_db, mailbox, key=str(i))
        row.received_at = timestamp
    test_db.commit()
    first = api_client.get(base(candidate) + '/inbox', params={'limit': 2}).json()
    assert first['next_cursor']
    email(test_db, mailbox, key='new-arrival')
    second = api_client.get(base(candidate) + '/inbox', params={'limit': 2, 'cursor': first['next_cursor']}).json()
    third = api_client.get(base(candidate) + '/inbox', params={'limit': 2, 'cursor': second['next_cursor']}).json()
    ids = [m['id'] for page in (first, second, third) for m in page['messages']]
    assert len(ids) == len(set(ids)) == 5
    assert third['next_cursor'] is None
    assert first['total_count'] == 5
    assert api_client.get(base(candidate) + '/inbox', params={'cursor': 'invalid'}).status_code == 400


def test_deleted_message_detail_cannot_be_returned_from_mark_read(api_client, test_db, mailbox_case):
    candidate, _, _, mailbox = mailbox_case
    row = email(test_db, mailbox)
    row.deleted_at = utcnow()
    test_db.commit()
    assert api_client.patch(base(candidate) + f'/inbox-messages/{row.id}/read').status_code == 404


def test_import_batches_have_one_ledger_result(test_db, monkeypatch, mailbox_case, import_provider):
    jobs, api = import_provider
    candidate, _, _, mailbox = mailbox_case
    def fetch(http, path, token, params=None):
        if path == 'messages': return {'messages': [{'id': str(i)} for i in range(300)]}
        return api(http, path, token, params)
    monkeypatch.setattr(jobs.gmail, '_api_get', fetch)
    assert jobs.run_import(candidate.firm_id, candidate.id, mailbox.connected_at) == 300
    rows = test_db.query(LedgerEntry).filter_by(candidate_id=candidate.id).all()
    assert len(rows) == 1
    assert '300' in rows[0].summary


def test_partial_import_audits_saved_total(test_db, monkeypatch, mailbox_case, import_provider):
    jobs, api = import_provider
    candidate, _, _, mailbox = mailbox_case
    def fetch(http, path, token, params=None):
        if path == 'messages': return {'messages': [{'id': str(i)} for i in range(21)]}
        if path == 'messages/20': raise RuntimeError('private-provider-failure')
        return api(http, path, token, params)
    monkeypatch.setattr(jobs.gmail, '_api_get', fetch)
    assert jobs.run_import(candidate.firm_id, candidate.id, mailbox.connected_at) == -1
    entries = test_db.query(LedgerEntry).filter_by(candidate_id=candidate.id).all()
    assert len(entries) == 1 and '20' in entries[0].summary
    assert 'partial' in entries[0].summary.lower()


def test_disconnect_delete_completes_locally_on_revoke_failure(api_client, test_db, monkeypatch, mailbox_case):
    from backend.api import routes_inbox
    candidate, _, _, mailbox = mailbox_case
    row = email(test_db, mailbox)
    monkeypatch.setattr(routes_inbox, 'decrypt_secret', lambda value: 'synthetic-refresh')
    monkeypatch.setattr(routes_inbox, 'revoke_token', lambda value: False)
    response = api_client.delete(base(candidate) + '/inbox-content', params={'disconnect': 'true'})
    assert response.status_code == 200
    test_db.refresh(mailbox)
    test_db.refresh(row)
    assert mailbox.status == 'DISCONNECTED' and row.deleted_at is not None
    assert 'myaccount.google.com' in response.json()['connection']['last_sync_error']


def test_stored_only_delete_invalidates_running_import(api_client, test_db, mailbox_case):
    candidate, _, _, mailbox = mailbox_case
    email(test_db, mailbox)
    mailbox.sync_job_id = uuid.uuid4()
    old_job = mailbox.sync_job_id
    mailbox.sync_lease_until = utcnow() + timedelta(minutes=2)
    test_db.commit()
    assert api_client.delete(base(candidate) + '/inbox-content').status_code == 200
    test_db.refresh(mailbox)
    assert mailbox.status == 'CONNECTED' and mailbox.sync_job_id != old_job


def test_confirm_after_reassignment_denied_without_changing_mailbox(api_client, test_db, accounts, monkeypatch, mailbox_case):
    candidate, _, _, mailbox = mailbox_case
    user = test_db.get(User, accounts.user_id)
    user.role = 'BDE'
    candidate.bde_id = user.id
    test_db.commit()
    attempt_id = pending(api_client, monkeypatch, candidate, mailbox.address)
    candidate.bde_id = None
    test_db.commit()
    assert api_client.post(base(candidate) + '/mailbox/confirm/' + attempt_id).status_code in (403, 404)
    assert api_client.get(base(candidate) + '/inbox').status_code == 404
    test_db.refresh(mailbox)
    assert mailbox.status == 'CONNECTED'


def test_reassignment_transfers_candidate_ledger_access_including_old_bde_actions(api_client, anonymous_client, test_db, accounts, mailbox_case):
    from backend.tests.auth_support import make_user
    from backend.auth.sessions import start_session
    from backend.models.tenancy import Firm
    candidate, _, app, mailbox = mailbox_case
    row = email(test_db, mailbox, application_id=app.id)
    old_bde = test_db.get(User, accounts.user_id)
    old_bde.role = 'BDE'; candidate.bde_id = old_bde.id
    test_db.commit()
    assert api_client.patch(base(candidate) + f'/inbox-messages/{row.id}/read').status_code == 200
    new_bde = make_user(test_db, test_db.get(Firm, candidate.firm_id), role='BDE', email='new-bde@example.test')
    token, _ = start_session(test_db, new_bde)
    candidate.bde_id = new_bde.id
    test_db.commit()
    path = f'/api/firms/{candidate.firm_id}/ledger?candidate_id={candidate.id}'
    assert api_client.get(path).json() == []
    response = anonymous_client.get(path, headers={'cookie':f'bq_session={token}'})
    assert response.status_code == 200 and len(response.json()) == 1
    assert response.json()[0]['actor_user_id'] == str(old_bde.id)

    old_response = api_client.get(f'/api/applications/{app.id}')
    assert old_response.status_code == 404
    new_headers = {'cookie':f'bq_session={token}'}
    new_response = anonymous_client.get(f'/api/applications/{app.id}', headers=new_headers)
    assert new_response.status_code == 200 and new_response.json()['status'] == 'saved'
    inbox = anonymous_client.get(base(candidate) + '/inbox', params={'message_id':str(row.id)}, headers=new_headers)
    assert inbox.status_code == 200
    assert inbox.json()['messages'][0]['application_id'] == str(app.id)
    assert inbox.json()['messages'][0]['body'] == 'Private synthetic body'


def test_identity_failure_grant_is_retained_then_cleaned(api_client, test_db, monkeypatch, mailbox_case):
    from backend.api import routes_inbox
    from backend.inbox.google_oauth import OAuthGrantError
    candidate, _, _, _ = mailbox_case
    state = oauth(api_client, monkeypatch, candidate)
    def exchange(*args): raise OAuthGrantError('issued-synthetic-refresh')
    def offline(*args): raise RuntimeError('provider unavailable')
    monkeypatch.setattr(routes_inbox, 'exchange_code', exchange)
    monkeypatch.setattr(routes_inbox, 'identify_refresh_token', offline)
    result = api_client.get('/api/oauth/google/callback', params={'state':state, 'code':'synthetic'}, follow_redirects=False)
    assert result.status_code == 303 and 'mailbox=failed' in result.headers['location']
    attempt = test_db.query(CandidateGoogleOAuthAttempt).one()
    assert attempt.pending_token_ciphertext is not None
    monkeypatch.setattr(routes_inbox, 'identify_refresh_token', lambda *args:'unused@example.test')
    monkeypatch.setattr(routes_inbox, 'decrypt_secret', lambda *args:'issued-synthetic-refresh')
    assert routes_inbox.cleanup_expired_grants() == 1
    test_db.refresh(attempt)
    assert attempt.pending_token_ciphertext is None


def test_cancel_failed_revoke_is_visible_and_retries(api_client, test_db, monkeypatch, mailbox_case):
    from backend.api import routes_inbox
    candidate, _, _, _ = mailbox_case
    attempt = pending(api_client, monkeypatch, candidate)
    monkeypatch.setattr(routes_inbox, 'decrypt_secret', lambda *args:'synthetic')
    monkeypatch.setattr(routes_inbox, 'revoke_token', lambda *args:False)
    response = api_client.delete(base(candidate) + '/mailbox/confirm/' + attempt)
    assert response.status_code == 200 and response.json()['cleanup_pending'] is True
    assert api_client.post(base(candidate) + '/mailbox/confirm/' + attempt).status_code == 409


def test_cleanup_cannot_revoke_newly_live_account(api_client, test_db, monkeypatch, mailbox_case):
    from backend.api import routes_inbox
    candidate, _, _, mailbox = mailbox_case
    attempt_id = pending(api_client, monkeypatch, candidate, mailbox.address)
    attempt = test_db.get(CandidateGoogleOAuthAttempt, uuid.UUID(attempt_id))
    attempt.expires_at = utcnow() - timedelta(seconds=1)
    test_db.commit()
    calls = []
    monkeypatch.setattr(routes_inbox, 'revoke_token', lambda token:calls.append(token) or True)
    assert routes_inbox.cleanup_expired_grants() == 1
    assert calls == []


def test_lifecycle_lock_refuses_concurrent_activation(api_client, test_db, monkeypatch, mailbox_case):
    from backend.api import routes_inbox
    candidate, _, _, _ = mailbox_case
    attempt_id = pending(api_client, monkeypatch, candidate)
    with routes_inbox._grant_guard():
        response = api_client.post(base(candidate) + '/mailbox/confirm/' + attempt_id)
    assert response.status_code == 503
    test_db.refresh(test_db.get(CandidateGoogleOAuthAttempt, uuid.UUID(attempt_id)))


def test_platform_audit_hides_connection_address(anonymous_client, api_client, test_db, accounts, monkeypatch, mailbox_case):
    candidate, _, _, mailbox = mailbox_case
    attempt_id = pending(api_client, monkeypatch, candidate, mailbox.address)
    assert api_client.post(base(candidate) + '/mailbox/confirm/' + attempt_id).status_code == 200
    response = anonymous_client.get('/api/admin/audit', headers={'cookie':f'bq_session={accounts.admin_token}'})
    assert response.status_code == 200
    assert mailbox.address not in response.text


@pytest.mark.parametrize('value', [["2026-11-02T00:00:00Z", 123], {'a':'b'}, None, [], ['no-timezone','not-a-uuid']])
def test_structurally_invalid_cursor_is_a_client_error(api_client, mailbox_case, value):
    import base64
    import json
    candidate, _, _, _ = mailbox_case
    cursor = base64.urlsafe_b64encode(json.dumps(value).encode()).decode()
    assert api_client.get(base(candidate) + '/inbox', params={'cursor':cursor}).status_code == 400


def test_delete_rechecks_owner_permission_after_google_call(api_client, test_db, accounts, monkeypatch, mailbox_case):
    from backend.api import routes_inbox
    candidate, _, _, mailbox = mailbox_case
    row = email(test_db, mailbox)
    def revoke(*args):
        user = test_db.get(User, accounts.user_id)
        user.role = 'BDE'; candidate.bde_id = user.id
        test_db.commit()
        return True
    monkeypatch.setattr(routes_inbox, 'decrypt_secret', lambda *args:'synthetic')
    monkeypatch.setattr(routes_inbox, 'revoke_token', revoke)
    response = api_client.delete(base(candidate) + '/inbox-content', params={'disconnect':'true'})
    assert response.status_code == 403
    test_db.refresh(row)
    assert row.deleted_at is None


@pytest.mark.parametrize('status', ['CONNECTED', 'ERROR'])
def test_global_mailbox_reservation_is_private_and_protects_live_grant(api_client, test_db, accounts, monkeypatch, mailbox_case, status):
    from backend.api import routes_inbox
    from backend.tests.auth_support import make_firm, make_user
    from backend.models.tenancy import Plan
    from backend.models.candidates import Candidate, CandidateMailbox
    candidate, _, _, _ = mailbox_case
    foreign_firm = make_firm(test_db, test_db.get(Plan, accounts.plan_id), slug='private-other-firm')
    owner = make_user(test_db, foreign_firm, email='other-owner@example.test')
    foreign = Candidate(firm_id=foreign_firm.id, manager_id=owner.id, created_by_user_id=owner.id,
        full_name='Never disclose this candidate', work_auth='H1B')
    test_db.add(foreign); test_db.flush()
    test_db.add(CandidateMailbox(firm_id=foreign_firm.id, candidate_id=foreign.id,
        address='reserved@example.test', status=status, connected_by_user_id=owner.id))
    test_db.commit()
    attempt = pending(api_client, monkeypatch, candidate, 'reserved@example.test')
    calls = []
    monkeypatch.setattr(routes_inbox, 'revoke_token', lambda token:calls.append(token) or True)
    response = api_client.post(base(candidate) + '/mailbox/confirm/' + attempt)
    assert response.status_code == 409
    assert response.json()['detail'] == 'This mailbox cannot be connected. Contact your manager.'
    assert str(foreign.id) not in response.text and foreign.full_name not in response.text
    assert calls == []


def test_disconnected_address_can_be_reused_without_moving_retained_data(api_client, test_db, accounts, monkeypatch, mailbox_case):
    from backend.models.candidates import Candidate
    candidate, _, app, mailbox = mailbox_case
    row = email(test_db, mailbox, application_id=app.id)
    assert api_client.delete(base(candidate) + '/mailbox').status_code == 200
    other = Candidate(firm_id=candidate.firm_id, manager_id=candidate.manager_id, created_by_user_id=accounts.user_id,
        full_name='New candidate connection', work_auth='H1B')
    test_db.add(other); test_db.commit()
    attempt = pending(api_client, monkeypatch, other, mailbox.address)
    assert api_client.post(base(other) + '/mailbox/confirm/' + attempt).status_code == 200
    assert api_client.get(base(other) + '/inbox').json()['messages'] == []
    test_db.refresh(row)
    assert row.candidate_id == candidate.id and row.application_id == app.id


def test_stored_delete_during_provider_fetch_blocks_late_save_and_allows_new_mail(api_client, test_db, mailbox_case, monkeypatch, import_provider):
    jobs, api = import_provider
    candidate, _, _, mailbox = mailbox_case
    row = email(test_db, mailbox, key='message-1')
    def fetch(http, path, token, params=None):
        if path == 'messages/message-1':
            response = api_client.delete(base(candidate) + '/inbox-content')
            assert response.status_code == 200
        return api(http, path, token, params)
    monkeypatch.setattr(jobs.gmail, '_api_get', fetch)
    assert jobs.run_import(candidate.firm_id, candidate.id, mailbox.connected_at) == -1
    test_db.expire_all()
    assert row.deleted_at is not None
    assert api_client.get(base(candidate) + '/inbox').json()['messages'] == []
    def new_mail(http, path, token, params=None):
        if path == 'messages': return {'messages':[{'id':'new-after-delete'}]}
        return api(http, path, token, params)
    monkeypatch.setattr(jobs.gmail, '_api_get', new_mail)
    assert jobs.run_import(candidate.firm_id, candidate.id, mailbox.connected_at) == 1
    data = api_client.get(base(candidate) + '/inbox').json()
    assert len(data['messages']) == 1 and data['messages'][0]['id'] != str(row.id)


def test_google_revoke_timeout_is_a_bounded_failure():
    import httpx
    from backend.inbox.google_oauth import revoke_token
    class Provider:
        def post(self, *args, **kwargs): raise httpx.ReadTimeout('synthetic timeout')
    assert revoke_token('synthetic', client=Provider()) is False


def test_interrupted_worker_keeps_one_durable_partial_audit_and_recovers(test_db, mailbox_case, monkeypatch, import_provider):
    jobs, api = import_provider
    candidate, _, _, mailbox = mailbox_case
    class WorkerStopped(BaseException): pass
    def interrupted(http, path, token, params=None):
        if path == 'messages': return {'messages':[{'id':str(i)} for i in range(11)]}
        if path == 'messages/10': raise WorkerStopped()
        return api(http, path, token, params)
    monkeypatch.setattr(jobs.gmail, '_api_get', interrupted)
    with pytest.raises(WorkerStopped): jobs.run_import(candidate.firm_id, candidate.id, mailbox.connected_at)
    test_db.expire_all()
    entries = test_db.query(LedgerEntry).filter_by(candidate_id=candidate.id).all()
    assert len(entries) == 1 and '10' in entries[0].summary and 'partial' in entries[0].summary.lower()
    mailbox.sync_lease_until = utcnow() - timedelta(seconds=1)
    test_db.commit()
    def retry(http, path, token, params=None):
        if path == 'messages': return {'messages':[{'id':str(i)} for i in range(10)]}
        return api(http, path, token, params)
    monkeypatch.setattr(jobs.gmail, '_api_get', retry)
    assert jobs.run_import(candidate.firm_id, candidate.id, mailbox.connected_at) == 0
    test_db.expire_all()
    assert test_db.query(LedgerEntry).filter_by(candidate_id=candidate.id).count() == 1
    assert mailbox.sync_state == 'IDLE'


def test_concurrent_read_marks_record_only_first_transition(api_client, test_db, mailbox_case):
    from concurrent.futures import ThreadPoolExecutor
    candidate, _, _, mailbox = mailbox_case
    row = email(test_db, mailbox)
    path = base(candidate) + f'/inbox-messages/{row.id}/read'
    with ThreadPoolExecutor(max_workers=2) as workers:
        results = list(workers.map(lambda _:api_client.patch(path), range(2)))
    assert [response.status_code for response in results] == [200, 200]
    assert test_db.query(LedgerEntry).filter_by(candidate_id=candidate.id).count() == 1


def test_provider_denial_returns_to_inbox_without_exchanging_grant(api_client, test_db, monkeypatch, mailbox_case):
    from backend.api import routes_inbox
    candidate, _, _, _ = mailbox_case
    state = oauth(api_client, monkeypatch, candidate)
    calls = []
    monkeypatch.setattr(routes_inbox, 'exchange_code', lambda *args:calls.append(args))
    response = api_client.get('/api/oauth/google/callback', params={'state':state,'error':'access_denied'}, follow_redirects=False)
    assert response.status_code == 303 and 'mailbox=cancelled' in response.headers['location']
    assert f'/candidates/{candidate.id}' in response.headers['location'] and calls == []


@pytest.mark.parametrize('failure', ['missing-state','expired-state','ended-session'])
def test_invalid_callback_has_safe_visible_fallback(api_client, test_db, monkeypatch, mailbox_case, failure):
    candidate, _, _, _ = mailbox_case
    state = oauth(api_client, monkeypatch, candidate)
    kwargs = {'params':{'state':state,'code':'synthetic'}, 'follow_redirects':False}
    if failure == 'missing-state': kwargs['params'].pop('state')
    if failure == 'ended-session': kwargs['headers'] = {'cookie':'bq_session=invalid-synthetic-session'}
    if failure == 'expired-state':
        attempt = test_db.query(CandidateGoogleOAuthAttempt).one()
        attempt.expires_at = utcnow() - timedelta(seconds=1)
        test_db.commit()
    response = api_client.get('/api/oauth/google/callback', **kwargs)
    assert response.status_code == 303 and response.headers['location'] == '/?mailbox=failed'
