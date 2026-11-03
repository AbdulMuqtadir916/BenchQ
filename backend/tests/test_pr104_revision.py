"""Latest review regressions: immutable results and cross-firm concurrency."""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier, Event
import uuid

import pytest
from sqlalchemy import event

from backend.models.candidates import Candidate, CandidateGoogleOAuthAttempt, CandidateMailbox
from backend.models.db import JobRun, utcnow
from backend.models.tenancy import LedgerEntry, Plan
from backend.tests.test_candidate_mailbox import mailbox_case, offline_mailbox_provider, import_provider, oauth, base


def test_progress_never_writes_or_updates_ledger_until_terminal(test_db, mailbox_case, monkeypatch, import_provider):
    jobs, provider = import_provider
    candidate, _, _, mailbox = mailbox_case
    def no_mutation(*args):
        raise AssertionError('Ledger is append-only')
    event.listen(LedgerEntry, 'before_update', no_mutation)
    event.listen(LedgerEntry, 'before_delete', no_mutation)
    def fetch(http, path, token, params=None):
        if path == 'messages':
            return {'messages': [{'id': str(i)} for i in range(21)]}
        if path in ('messages/10', 'messages/20'):
            test_db.expire_all()
            run = test_db.query(JobRun).filter_by(job_type='candidate_gmail_import').one()
            assert run.meta['imported'] == int(path.split('/')[1])
            assert test_db.query(LedgerEntry).count() == 0
        return provider(http, path, token, params)
    monkeypatch.setattr(jobs.gmail, '_api_get', fetch)
    try:
        assert jobs.run_import(candidate.firm_id, candidate.id, mailbox.connected_at) == 21
        row = test_db.query(LedgerEntry).one()
        snapshot = (row.id, row.created_at, row.summary)
        from backend.inbox.import_progress import recover_imports, finish_import
        recover_imports()
        finish_import(test_db, candidate.firm_id, uuid.UUID(row.entity_id))
        test_db.commit(); test_db.refresh(row)
        assert (row.id, row.created_at, row.summary) == snapshot
        assert test_db.query(LedgerEntry).count() == 1
    finally:
        event.remove(LedgerEntry, 'before_update', no_mutation)
        event.remove(LedgerEntry, 'before_delete', no_mutation)


def test_restart_recovery_finalizes_saved_progress_once(test_db, mailbox_case, monkeypatch, import_provider):
    jobs, provider = import_provider
    candidate, _, _, mailbox = mailbox_case
    class Stopped(BaseException): pass
    def fetch(http, path, token, params=None):
        if path == 'messages': return {'messages':[{'id':str(i)} for i in range(11)]}
        if path == 'messages/10': raise Stopped()
        return provider(http, path, token, params)
    monkeypatch.setattr(jobs.gmail, '_api_get', fetch)
    with pytest.raises(Stopped): jobs.run_import(candidate.firm_id, candidate.id, mailbox.connected_at)
    assert test_db.query(LedgerEntry).count() == 0
    test_db.refresh(mailbox)
    mailbox.sync_lease_until = utcnow() - timedelta(seconds=1)
    test_db.commit()
    from backend.job_monitor import cleanup_stale_runs
    from backend.inbox.import_progress import recover_imports
    cleanup_stale_runs()
    recover_imports(); recover_imports()
    result = test_db.query(LedgerEntry).one()
    assert '10' in result.summary and 'Partial' in result.summary
    assert test_db.query(JobRun).one().meta['finalized'] is True


@pytest.mark.parametrize("same_address", [False, True])
def test_different_firm_callbacks_and_confirmations_run_concurrently(api_client, test_db, accounts, monkeypatch, mailbox_case, same_address):
    from backend.api import routes_inbox
    from backend.auth.sessions import start_session
    from backend.tests.auth_support import make_firm, make_user
    first, _, _, mailbox = mailbox_case
    mailbox.status = 'DISCONNECTED'
    other_firm = make_firm(test_db, test_db.get(Plan, accounts.plan_id), slug='concurrent-firm')
    other_owner = make_user(test_db, other_firm, email='other-owner@example.test')
    second = Candidate(firm_id=other_firm.id, manager_id=other_owner.id, created_by_user_id=other_owner.id,
        full_name='Synthetic second candidate', work_auth='H1B')
    test_db.add(second); test_db.commit()
    other_token, _ = start_session(test_db, other_owner)
    test_db.commit()
    headers = [{}, {'cookie':f'bq_session={other_token}'}]
    # prepare bound states using each actual user's session
    state1 = oauth(api_client, monkeypatch, first)
    from backend.inbox.google_oauth import Authorization
    state2 = 'synthetic-other-' + uuid.uuid4().hex
    monkeypatch.setattr(routes_inbox, 'build_authorization', lambda: Authorization(
        'https://accounts.google.com/o/oauth2/v2/auth?state='+state2, state2, 'private-verifier', 'challenge'))
    assert api_client.post(base(second)+'/mailbox/oauth', json={'return_to':f'/concurrent-firm/candidates/{second.id}?tab=inbox'}, headers=headers[1]).status_code == 200
    entered = Barrier(2)
    def exchange(code, verifier):
        entered.wait(timeout=3)  # A global exclusive guard makes this fail.
        return ('shared@example.test' if same_address else f'{code}@example.test'), 'synthetic-refresh'
    monkeypatch.setattr(routes_inbox, 'exchange_code', exchange)
    def callback(index):
        return api_client.get('/api/oauth/google/callback', params={
            'state':[state1,state2][index], 'code':['first','second'][index]},
            headers=headers[index], follow_redirects=False)
    with ThreadPoolExecutor(max_workers=2) as workers:
        responses = list(workers.map(callback, range(2)))
    assert all(r.status_code == 303 and 'mailbox_confirmation=' in r.headers['location'] for r in responses)
    test_db.expire_all()
    attempts = [test_db.query(CandidateGoogleOAuthAttempt).filter_by(candidate_id=c.id).one().id for c in (first,second)]
    def confirm(index):
        return api_client.post(base([first,second][index])+'/mailbox/confirm/'+str(attempts[index]), headers=headers[index])
    with ThreadPoolExecutor(max_workers=2) as workers:
        results = list(workers.map(confirm, range(2)))
    assert [r.status_code for r in results] == [200,200]
    assert test_db.query(CandidateMailbox).filter_by(status='CONNECTED').count() == 2
    if same_address:
        from backend.tests.test_candidate_mailbox import email
        boxes = [test_db.query(CandidateMailbox).filter_by(candidate_id=c.id).one() for c in (first,second)]
        rows = [email(test_db, box, key='same-provider-id') for box in boxes]
        for index in range(2):
            response = api_client.get(base([first,second][index])+'/inbox', headers=headers[index])
            assert [m['id'] for m in response.json()['messages']] == [str(rows[index].id)]
            forbidden = api_client.get(base([first,second][index])+'/inbox',
                params={'message_id':str(rows[1-index].id)}, headers=headers[index])
            assert forbidden.status_code == 404
        revocations=[]
        monkeypatch.setattr(routes_inbox,'revoke_token',lambda token:revocations.append(token) or True)
        assert api_client.delete(base(first)+'/mailbox').status_code == 200
        test_db.refresh(boxes[1])
        assert boxes[1].status == 'CONNECTED' and revocations == []


def test_revoke_waits_for_unknown_identity_exchange_then_releases():
    from backend.inbox.grant_locks import exchange_barrier, revoke_barrier
    exchanging, release, revoked = Event(), Event(), Event()
    def exchange():
        with exchange_barrier():
            exchanging.set()
            assert release.wait(3)
    def revoke():
        with revoke_barrier(): revoked.set()
    with ThreadPoolExecutor(max_workers=2) as workers:
        first = workers.submit(exchange)
        assert exchanging.wait(2)
        second = workers.submit(revoke)
        assert not revoked.wait(.15)
        release.set(); first.result(); second.result()
    assert revoked.is_set()


def test_partial_batch_rollback_does_not_inflate_durable_count(test_db, mailbox_case, monkeypatch, import_provider):
    jobs, provider = import_provider
    candidate, _, _, mailbox = mailbox_case
    original = jobs.gmail._store_message
    def store(db, current, unused, key, unused2, **kwargs):
        if key == '15': raise RuntimeError('synthetic storage failure')
        return original(db, current, unused, key, unused2, **kwargs)
    def fetch(http, path, token, params=None):
        if path == 'messages': return {'messages':[{'id':str(i)} for i in range(20)]}
        return provider(http, path, token, params)
    monkeypatch.setattr(jobs.gmail, '_api_get', fetch)
    monkeypatch.setattr(jobs.gmail, '_store_message', store)
    assert jobs.run_import(candidate.firm_id, candidate.id, mailbox.connected_at) == -1
    from backend.models.candidates import InboxMessage
    assert test_db.query(InboxMessage).count() == 10
    assert test_db.query(JobRun).one().meta['imported'] == 10
    assert '10' in test_db.query(LedgerEntry).one().summary


def test_disconnect_invalidates_pending_confirmation_for_revoked_grant(api_client, test_db, monkeypatch, mailbox_case):
    from backend.tests.test_pr104_followup import pending
    from backend.api import routes_inbox
    candidate, _, _, mailbox = mailbox_case
    mailbox.refresh_token_ciphertext = b'synthetic-token'
    test_db.commit()
    attempt = pending(api_client, monkeypatch, candidate, mailbox.address)
    monkeypatch.setattr(routes_inbox, 'decrypt_secret', lambda *args:'synthetic-refresh')
    assert api_client.delete(base(candidate)+'/mailbox').status_code == 200
    assert api_client.post(base(candidate)+'/mailbox/confirm/'+attempt).status_code == 409


def test_account_lock_is_released_after_exception():
    from backend.inbox.grant_locks import account_lock
    with pytest.raises(RuntimeError):
        with account_lock('released@example.test'):
            raise RuntimeError('synthetic')
    with ThreadPoolExecutor(max_workers=1) as workers:
        def acquire():
            with account_lock('released@example.test'): return True
        assert workers.submit(acquire).result(timeout=2)


def test_unrelated_revocations_can_overlap():
    from backend.inbox.grant_locks import account_lock, revoke_barrier
    entered = Barrier(2)
    def revoke(address):
        with account_lock(address), revoke_barrier():
            entered.wait(timeout=3)
            return True
    with ThreadPoolExecutor(max_workers=2) as workers:
        assert list(workers.map(revoke, ['a@example.test','b@example.test'])) == [True, True]


def test_group_coordination_leaves_no_stale_reentrant_locks():
    from backend.inbox.grant_locks import _held, exchange_barrier, revoke_barrier
    assert not _held.get()
    with exchange_barrier():
        assert _held.get() == frozenset({('exchange',True)})
    assert not _held.get()
    with pytest.raises(RuntimeError):
        with revoke_barrier():
            assert _held.get() == frozenset({('revoke',True)})
            raise RuntimeError('synthetic')
    assert not _held.get()


def test_callback_rechecks_cancellation_after_coordination_wait(api_client, test_db, mailbox_case, monkeypatch):
    from contextlib import contextmanager
    from backend.api import routes_inbox
    candidate, _, _, _ = mailbox_case
    state = oauth(api_client, monkeypatch, candidate)
    attempt = test_db.query(CandidateGoogleOAuthAttempt).one()
    @contextmanager
    def delayed_admission():
        # Represents cancellation/expiry committed while callback was waiting.
        test_db.refresh(attempt)
        attempt.expires_at = utcnow() - timedelta(seconds=1)
        test_db.commit()
        yield
    calls = []
    monkeypatch.setattr(routes_inbox, 'exchange_barrier', delayed_admission)
    monkeypatch.setattr(routes_inbox, 'exchange_code', lambda *args:calls.append(args))
    response = api_client.get('/api/oauth/google/callback', params={'state':state,'code':'synthetic'}, follow_redirects=False)
    assert response.status_code == 303
    assert calls == []


def test_read_and_manual_empty_sync_do_not_write_business_ledger(api_client, test_db, mailbox_case):
    from backend.tests.test_candidate_mailbox import email
    candidate, _, _, mailbox = mailbox_case
    row = email(test_db, mailbox)
    for _ in range(2):
        assert api_client.patch(base(candidate)+f'/inbox-messages/{row.id}/read').status_code == 200
        assert api_client.post(base(candidate)+'/mailbox/sync').status_code == 200
    test_db.refresh(row)
    assert row.is_read is True
    assert test_db.query(LedgerEntry).count() == 0


@pytest.mark.parametrize('failure', ['provider', 'busy'])
def test_disconnect_retains_encrypted_revocation_for_scheduled_retry(api_client, test_db, monkeypatch, mailbox_case, failure):
    from contextlib import contextmanager
    from fastapi import HTTPException
    from backend.api import routes_inbox
    candidate, _, _, mailbox = mailbox_case
    ciphertext = b'synthetic-encrypted-refresh'
    mailbox.refresh_token_ciphertext = ciphertext
    test_db.commit()
    monkeypatch.setattr(routes_inbox, 'decrypt_secret', lambda value:'synthetic-refresh')
    original_barrier = routes_inbox.revoke_barrier
    @contextmanager
    def busy():
        raise HTTPException(503, 'busy')
        yield
    monkeypatch.setattr(routes_inbox, 'revoke_token', lambda value:False)
    if failure == 'busy': monkeypatch.setattr(routes_inbox, 'revoke_barrier', busy)
    response = api_client.delete(base(candidate)+'/mailbox')
    assert response.status_code == 200
    test_db.refresh(mailbox)
    assert mailbox.status == 'DISCONNECTED' and mailbox.refresh_token_ciphertext is None
    cleanup = test_db.query(CandidateGoogleOAuthAttempt).filter(CandidateGoogleOAuthAttempt.pending_token_ciphertext.isnot(None)).one()
    assert cleanup.pending_token_ciphertext == ciphertext and cleanup.expires_at <= utcnow()
    assert 'retry automatically' in mailbox.last_sync_error
    monkeypatch.setattr(routes_inbox, 'revoke_barrier', original_barrier)
    monkeypatch.setattr(routes_inbox, 'revoke_token', lambda value:True)
    assert routes_inbox.cleanup_expired_grants() == 1
    test_db.refresh(cleanup); test_db.refresh(mailbox)
    assert cleanup.pending_token_ciphertext is None and mailbox.last_sync_error is None


@pytest.mark.parametrize('status', ['CONNECTED', 'ERROR'])
def test_disconnect_does_not_revoke_another_firms_existing_grant(api_client, test_db, accounts, monkeypatch, mailbox_case, status):
    from backend.api import routes_inbox
    from backend.tests.auth_support import make_firm, make_user
    candidate, _, _, mailbox = mailbox_case
    foreign_firm = make_firm(test_db, test_db.get(Plan, accounts.plan_id), slug='shared-existing-firm')
    owner = make_user(test_db, foreign_firm, email='shared-owner@example.test')
    foreign = Candidate(firm_id=foreign_firm.id, manager_id=owner.id, created_by_user_id=owner.id,
        full_name='Legacy shared candidate', work_auth='H1B')
    test_db.add(foreign); test_db.flush()
    other = CandidateMailbox(firm_id=foreign_firm.id, candidate_id=foreign.id, address=mailbox.address,
        status=status, connected_by_user_id=owner.id, refresh_token_ciphertext=b'other-encrypted-token')
    mailbox.refresh_token_ciphertext = b'own-encrypted-token'
    test_db.add(other); test_db.commit()
    calls=[]
    monkeypatch.setattr(routes_inbox, 'revoke_token', lambda value:calls.append(value) or True)
    assert api_client.delete(base(candidate)+'/mailbox').status_code == 200
    test_db.refresh(other)
    assert calls == [] and other.status == status and other.refresh_token_ciphertext == b'other-encrypted-token'
    assert test_db.query(CandidateGoogleOAuthAttempt).filter(CandidateGoogleOAuthAttempt.pending_token_ciphertext.isnot(None)).count() == 0


def test_two_candidates_in_one_firm_cannot_claim_same_gmail_concurrently(api_client, test_db, accounts, monkeypatch, mailbox_case):
    from backend.api import routes_inbox
    from backend.tests.test_pr104_followup import pending
    first, _, _, mailbox = mailbox_case
    mailbox.status = 'DISCONNECTED'
    second = Candidate(firm_id=first.firm_id, manager_id=first.manager_id, created_by_user_id=accounts.user_id,
        full_name='Second candidate same firm', work_auth='H1B')
    test_db.add(second); test_db.commit()
    attempts = [pending(api_client,monkeypatch,c,'shared-in-firm@example.test') for c in (first,second)]
    calls=[]
    monkeypatch.setattr(routes_inbox,'revoke_token',lambda token:calls.append(token) or True)
    def confirm(index):
        return api_client.post(base([first,second][index])+'/mailbox/confirm/'+attempts[index])
    with ThreadPoolExecutor(max_workers=2) as workers:
        responses=list(workers.map(confirm,range(2)))
    assert sorted(r.status_code for r in responses) == [200,409]
    assert next(r for r in responses if r.status_code==409).json()['detail']=='This email is already connected to another candidate.'
    assert test_db.query(CandidateMailbox).filter_by(address='shared-in-firm@example.test',status='CONNECTED').count()==1
    assert calls == []
