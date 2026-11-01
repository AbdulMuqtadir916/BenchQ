"""Protected history refuses deletion before any application or job changes."""
import pytest
from backend.models.db import Application, ApplicationStatusEvent, utcnow
from backend.tests.test_pr_safety_regressions import case


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
