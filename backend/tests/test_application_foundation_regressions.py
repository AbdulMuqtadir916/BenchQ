"""Public application access, audit and deletion regressions for the foundation."""
import pytest
from backend.models.candidates import Candidate, CandidateMailbox
from backend.models.db import Application, ApplicationStatusEvent, Resume, utcnow
from backend.models.tenancy import User, LedgerEntry
from backend.tests.test_candidate_application_status import _saved_candidate_application

@pytest.fixture
def case(test_db, accounts, jobs_in_default_firm):
    candidate, job, app, _, _, _ = _saved_candidate_application(test_db, accounts, jobs_in_default_firm, 'OWNER')
    app.status = 'applied'
    app.applied_at = utcnow()
    mailbox = CandidateMailbox(firm_id=candidate.firm_id, candidate_id=candidate.id,
        address='candidate@example.test', connected_by_user_id=accounts.user_id)
    test_db.add(mailbox)
    test_db.commit()
    return candidate, job, app, mailbox

@pytest.mark.parametrize('operation', ['create', 'update', 'delete', 'prep'])
@pytest.mark.parametrize('role,assigned,expected', [
    ('OWNER', False, 200), ('VIEWER', False, 403), ('BDE', False, 404),
    ('BDE', True, 200), ('MANAGER', False, 404), ('MANAGER', True, 200),
])
def test_interview_and_prep_candidate_scope(api_client, test_db, accounts, case, role, assigned, expected, operation):
    candidate, _, app, _ = case
    created = api_client.post(f'/api/applications/{app.id}/interviews', json={'what': 'Synthetic screen'})
    assert created.status_code == 201
    user = test_db.get(User, accounts.user_id)
    user.role = role
    if assigned:
        if role == 'BDE':
            candidate.bde_id = user.id
        else:
            candidate.manager_id = user.id
    test_db.commit()
    path = f'/api/applications/{app.id}'
    if operation == 'create':
        response = api_client.post(path + '/interviews', json={'what': 'Second screen'})
    elif operation == 'prep':
        response = api_client.get(path + '/prep')
        if role == 'VIEWER':
            expected = 200
    else:
        path = f"/api/applications/interviews/{created.json()['id']}"
        response = api_client.patch(path, json={'what': 'Updated screen'}) if operation == 'update' else api_client.delete(path)
    assert response.status_code == (201 if expected == 200 and operation == 'create' else expected)


def test_prep_never_uses_another_candidates_resume(api_client, test_db, accounts, case):
    candidate, job, app, _ = case
    other = Candidate(firm_id=candidate.firm_id, manager_id=candidate.manager_id,
        created_by_user_id=accounts.user_id, full_name='Other synthetic', work_auth='H1B')
    test_db.add(other)
    test_db.flush()
    test_db.add(Resume(firm_id=candidate.firm_id, candidate_id=other.id, job_id=job.id,
        name='Other private resume', is_base=False, json_data={'summary': 'PRIVATE OTHER CANDIDATE'}))
    test_db.commit()
    response = api_client.get(f'/api/applications/{app.id}/prep')
    assert response.status_code == 200
    assert 'PRIVATE OTHER CANDIDATE' not in response.json()['text']
    assert 'Other private resume' not in response.json()['text']


@pytest.mark.parametrize('bulk', [False, True])
def test_protected_delete_is_an_atomic_conflict(api_client, test_db, case, bulk):
    candidate, job, _, _ = case
    job.status = 'applied'
    protected = Application(firm_id=candidate.firm_id, job_id=job.id, status='applied')
    unprotected = Application(firm_id=candidate.firm_id, job_id=job.id, status='applied')
    test_db.add_all([protected, unprotected])
    test_db.flush()
    test_db.add(ApplicationStatusEvent(firm_id=candidate.firm_id, application_id=protected.id,
        from_status='applied', to_status='applied', source='legacy', occurred_at=utcnow(), revision=1,
        original_payload={'from': None, 'to': 'applied'}))
    test_db.commit()
    protected_id, unprotected_id = protected.id, unprotected.id
    response = api_client.post('/api/applications/bulk-delete', json={'ids': [str(unprotected_id), str(protected_id)]}) if bulk else api_client.delete(f'/api/applications/{protected_id}')
    assert response.status_code == 409
    test_db.expire_all()
    assert test_db.get(Application, protected_id) is not None
    assert test_db.get(Application, unprotected_id) is not None
    assert job.status == 'applied'
    assert test_db.query(ApplicationStatusEvent).filter_by(application_id=protected_id).count() == 1
    assert api_client.delete(f'/api/applications/{unprotected_id}').status_code == 200

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




def test_create_saved_draft_is_unsubmitted_idempotent_and_removable(api_client, test_db, accounts, case):
    from backend.models.candidates import CandidateJob, FavoriteJob
    from backend.models.db import Job
    from backend.models.tenancy import link_job_to_firm
    candidate, _, _, _ = case
    job = Job(external_id='foundation-save', title='Saved Engineer', company='Synthetic Corp', source='manual')
    test_db.add(job)
    test_db.flush()
    link_job_to_firm(test_db, candidate.firm_id, job.id, 'CAPTURED', captured_by_user_id=accounts.user_id)
    test_db.add(CandidateJob(firm_id=candidate.firm_id, candidate_id=candidate.id, job_id=job.id))
    test_db.commit()
    body = dict(title=job.title, company=job.company, url='', candidate_id=str(candidate.id), job_id=str(job.id), status='saved')
    first = api_client.post('/api/applications', json=body)
    assert first.status_code == 200, first.text
    again = api_client.post('/api/applications', json=body)
    assert again.json()['id'] == first.json()['id']
    app = test_db.query(Application).filter_by(candidate_id=candidate.id, job_id=job.id).one()
    test_db.refresh(app)
    assert app.applied_at is None
    assert app.submitted_by_user_id is None
    assert test_db.query(FavoriteJob).filter_by(candidate_id=candidate.id, job_id=job.id).count() == 1
    removed = api_client.patch(f'/api/applications/{app.id}', json={'unfavorite': True})
    assert removed.status_code == 200, removed.text
    assert removed.json()['application_preserved'] is False
    assert test_db.query(Application).filter_by(id=app.id).count() == 0


def test_unfavorite_keeps_application_with_status_history(api_client, test_db, accounts, jobs_in_default_firm):
    candidate, job, app, _, headers, _ = _saved_candidate_application(test_db, accounts, jobs_in_default_firm, 'OWNER')
    path = f'/api/applications/{app.id}'
    for revision, status in enumerate(['applied', 'saved']):
        assert api_client.patch(path + '/candidate-status', json={'status': status, 'expected_revision': revision}, headers=headers).status_code == 200
    response = api_client.patch(path, json={'unfavorite': True}, headers=headers)
    assert response.status_code == 200, response.text
    assert response.json()['application_preserved'] is True
    assert test_db.query(ApplicationStatusEvent).filter_by(application_id=app.id).count() == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("runner", ["scheduled", "manual"])
async def test_legacy_auto_reject_cannot_bypass_candidate_status_history(test_db, accounts, case, monkeypatch, runner):
    from datetime import timedelta
    from backend.models.db import Setting
    from backend.scheduler import run_auto_reject
    candidate, job, app, _ = case
    app.applied_at = utcnow() - timedelta(days=90)
    legacy = Application(firm_id=candidate.firm_id, job_id=job.id, status='applied', applied_at=app.applied_at)
    test_db.add_all([legacy, Setting(key='auto_reject_after_days', value='30')])
    test_db.commit()
    if runner == 'scheduled':
        await run_auto_reject()
    else:
        from backend import main
        captured = []
        def launch(kind, worker, **kwargs):
            captured.append(worker)
            return 'synthetic-run'
        monkeypatch.setattr(main, 'launch_background', launch)
        await main.trigger_auto_reject()
        await captured[0]()
    test_db.refresh(app)
    test_db.refresh(legacy)
    assert app.status == 'applied'
    assert app.status_revision == 0
    assert legacy.status == 'rejected'


@pytest.mark.parametrize('revisions', [None, [], 'invalid', 1])
def test_bulk_status_rejects_invalid_revision_map_without_changes(api_client, test_db, accounts, jobs_in_default_firm, revisions):
    _, _, app, _, headers, _ = _saved_candidate_application(test_db, accounts, jobs_in_default_firm, 'OWNER')
    response = api_client.post('/api/applications/bulk-update', headers=headers,
        json={'ids': [str(app.id)], 'status': 'applied', 'expected_revisions': revisions})
    assert response.status_code == 400, response.text
    test_db.refresh(app)
    assert app.status == 'saved'
    assert app.status_revision == 0
    assert test_db.query(ApplicationStatusEvent).filter_by(application_id=app.id).count() == 0
