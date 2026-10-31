"""Candidate scope and current authority at the public application/OAuth seams."""
import pytest
from backend.models.candidates import Candidate
from backend.models.db import Resume
from backend.models.tenancy import User
from backend.tests.test_pr_safety_regressions import case, _oauth


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


@pytest.mark.parametrize('change', ['demote', 'suspend', 'reassign'])
def test_oauth_rechecks_after_provider_exchange(api_client, test_db, accounts, monkeypatch, case, change):
    from backend.api import routes_inbox
    candidate, _, _, mailbox = case
    user = test_db.get(User, accounts.user_id)
    user.role = 'BDE'
    candidate.bde_id = user.id
    test_db.commit()
    original = mailbox.address
    state = _oauth(api_client, test_db, accounts, monkeypatch, candidate, address=original)
    def exchange(code, verifier):
        if change == 'demote':
            user.role = 'VIEWER'
        elif change == 'suspend':
            from backend.models.tenancy import Firm
            test_db.get(Firm, candidate.firm_id).status = 'SUSPENDED'
        else:
            candidate.bde_id = None
        test_db.commit()
        return original, 'synthetic-refresh'
    monkeypatch.setattr(routes_inbox, 'exchange_code', exchange)
    response = api_client.get('/api/oauth/google/callback', params={'state': state, 'code': 'synthetic'}, follow_redirects=False)
    assert response.status_code == (404 if change == 'reassign' else 403)
    test_db.refresh(mailbox)
    assert mailbox.refresh_token_ciphertext is None
