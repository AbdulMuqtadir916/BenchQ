"""Final independent review regressions at public application/mailbox endpoints."""
import pytest
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from backend.models.db import Application
from backend.models.tenancy import User, LedgerEntry
from backend.tests.test_pr_safety_regressions import case, _oauth


@pytest.mark.parametrize('role,expected_read,expected_write', [('OWNER',200,200),('VIEWER',200,403),('BDE',404,404),('MANAGER',404,404)])
def test_legacy_detail_and_write_use_the_same_scope(api_client, test_db, accounts, case, role, expected_read, expected_write):
    candidate, job, _, _ = case
    legacy=Application(firm_id=candidate.firm_id,job_id=job.id,status='applied')
    test_db.add(legacy)
    test_db.get(User,accounts.user_id).role=role
    test_db.commit()
    path=f'/api/applications/{legacy.id}'
    assert api_client.get(path).status_code==expected_read
    assert api_client.patch(path,json={'status':'offer','notes':'Synthetic notes'}).status_code==expected_write
    response=api_client.post('/api/applications/bulk-update',json={'ids':[str(legacy.id)],'status':'offer'})
    assert response.status_code==expected_write
    test_db.refresh(legacy)
    assert legacy.status==('offer' if expected_write==200 else 'applied')


def test_changed_application_notes_are_audited_once(api_client,test_db,accounts,case):
    candidate,_,app,_=case
    path=f'/api/applications/{app.id}'
    before=test_db.query(LedgerEntry).filter_by(candidate_id=candidate.id).count()
    for _ in range(2):
        assert api_client.patch(path,json={'notes':'Synthetic private note'}).status_code==200
    rows=test_db.query(LedgerEntry).filter_by(candidate_id=candidate.id).all()
    assert len(rows)==before+1
    entry=rows[-1]
    assert entry.actor_user_id==accounts.user_id
    assert entry.entity_id==str(app.id)
    assert 'Synthetic private note' not in entry.summary


def test_oauth_initial_sync_holds_the_account_lock(api_client,test_db,accounts,monkeypatch,case):
    from backend.api import routes_inbox
    candidate,_,_,mailbox=case
    state=_oauth(api_client,test_db,accounts,monkeypatch,candidate,address=mailbox.address)
    blocked=[]
    def sync(db, connection, **kwargs):
        # A second account mutation must wait until the initial import commits.
        with test_db.get_bind().connect() as other:
            try:
                other.execute(text('SELECT id FROM candidate_mailboxes WHERE id=:id FOR UPDATE NOWAIT'),{'id':mailbox.id})
            except OperationalError:
                blocked.append(True)
                other.rollback()
        return 0
    monkeypatch.setattr(routes_inbox,'sync_mailbox',sync)
    response=api_client.get('/api/oauth/google/callback',params={'state':state,'code':'synthetic'},follow_redirects=False)
    assert response.status_code==303
    assert blocked==[True]


def test_failed_initial_sync_cannot_mark_a_new_connection_failed(api_client,test_db,accounts,monkeypatch,case):
    from backend.api import routes_inbox
    from backend.models.candidates import CandidateMailbox
    from backend.models.db import utcnow
    from sqlalchemy.orm import Session
    candidate,_,_,mailbox=case
    state=_oauth(api_client,test_db,accounts,monkeypatch,candidate,address=mailbox.address)
    def sync(db, connection, **kwargs):
        db.rollback()  # The provider request fails; another connection wins before diagnostics are saved.
        with Session(test_db.get_bind()) as other:
            row=other.get(CandidateMailbox,mailbox.id)
            row.address='newer-account@example.test'
            row.connected_at=utcnow()
            row.history_id='new-account-checkpoint'
            row.last_sync_error=None
            other.commit()
        raise RuntimeError('synthetic provider failure')
    monkeypatch.setattr(routes_inbox,'sync_mailbox',sync)
    response=api_client.get('/api/oauth/google/callback',params={'state':state,'code':'synthetic'},follow_redirects=False)
    assert response.status_code==303
    test_db.refresh(mailbox)
    assert mailbox.address=='newer-account@example.test'
    assert mailbox.history_id=='new-account-checkpoint'
    assert mailbox.last_sync_error is None
