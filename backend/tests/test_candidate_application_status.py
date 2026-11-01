"""Candidate Saved ↔ Applied moves (the separate candidate-board endpoint)."""
import pytest


def _saved_candidate_application(test_db, accounts, firm_id, actor_role):
    from backend.auth.sessions import start_session
    from backend.models.candidates import Candidate, CandidateJob, FavoriteJob
    from backend.models.db import Application, Job, utcnow
    from backend.models.tenancy import Firm, LedgerEntry, User
    from backend.tests.auth_support import make_user

    firm = test_db.get(Firm, firm_id)
    manager = make_user(
        test_db, firm, email=f"manager-{actor_role.lower()}@example.test", role="MANAGER", name="Test Manager"
    )
    token, _ = start_session(test_db, manager)
    candidate = Candidate(
        firm_id=firm_id,
        manager_id=manager.id,
        created_by_user_id=accounts.user_id,
        full_name="Candidate Status Test",
        work_auth="H1B",
        primary_role="Platform Engineer",
    )
    job = Job(
        external_id=f"candidate-status-{actor_role.lower()}",
        title="Platform Engineer",
        company="Example Corp",
        url="https://jobs.example.test/platform-engineer",
        source="manual",
    )
    test_db.add_all([candidate, job])
    test_db.flush()

    application = Application(
        firm_id=firm_id,
        candidate_id=candidate.id,
        job_id=job.id,
        status="saved",
        applied_at=None,
        submitted_by_user_id=None,
        status_transitions=[{"from": None, "to": "saved", "at": utcnow().isoformat(), "source": "ui"}],
    )
    favorite = FavoriteJob(
        firm_id=firm_id,
        candidate_id=candidate.id,
        job_id=job.id,
        marked_by_user_id=accounts.user_id,
    )
    test_db.add_all([
        CandidateJob(firm_id=firm_id, candidate_id=candidate.id, job_id=job.id, match_score=90),
        application,
        favorite,
    ])
    test_db.flush()
    # The model's Python default fills applied_at even on a newly created Saved fixture.
    application.applied_at = None
    test_db.commit()

    owner_or_manager = (
        {"cookie": f"bq_session={accounts.firm_token}"}
        if actor_role == "OWNER"
        else {"cookie": f"bq_session={token}"}
    )
    return candidate, job, application, manager, owner_or_manager, LedgerEntry


@pytest.mark.parametrize("actor_role", ["OWNER", "MANAGER"])
def test_owner_and_manager_can_move_candidate_application_both_directions(
    api_client, test_db, accounts, jobs_in_default_firm, actor_role
):
    from backend.models.candidates import FavoriteJob
    from backend.models.db import Application

    candidate, job, application, manager, headers, ledger_model = _saved_candidate_application(
        test_db, accounts, jobs_in_default_firm, actor_role
    )
    actor_id = accounts.user_id if actor_role == "OWNER" else manager.id
    path = f"/api/applications/{application.id}/candidate-status"


    applied = api_client.patch(path, json={"status": "applied", "expected_revision": 0}, headers=headers)
    assert applied.status_code == 200, applied.text
    assert applied.json()["status"] == "applied"
    test_db.expire_all()
    saved_app = test_db.get(Application, application.id)
    assert saved_app.status == "applied"
    assert saved_app.applied_at is not None
    assert saved_app.submitted_by_user_id == actor_id
    assert saved_app.status_transitions[-1]["from"] == "saved"
    assert saved_app.status_transitions[-1]["to"] == "applied"
    assert saved_app.status_transitions[-1]["actor_user_id"] == str(actor_id)
    assert saved_app.status_transitions[-1]["at"]
    assert test_db.query(FavoriteJob).filter_by(candidate_id=candidate.id, job_id=job.id).first() is None

    saved = api_client.patch(path, json={"status": "saved", "expected_revision": 1}, headers=headers)
    assert saved.status_code == 200, saved.text
    assert saved.json()["status"] == "saved"
    test_db.expire_all()
    restored_app = test_db.get(Application, application.id)
    assert restored_app.status == "saved"
    assert restored_app.applied_at is None
    assert restored_app.submitted_by_user_id is None
    assert [transition["to"] for transition in restored_app.status_transitions[-2:]] == ["applied", "saved"]
    assert [transition["actor_user_id"] for transition in restored_app.status_transitions[-2:]] == [
        str(actor_id), str(actor_id)
    ]
    restored_favorite = test_db.query(FavoriteJob).filter_by(candidate_id=candidate.id, job_id=job.id).one()
    assert restored_favorite.marked_by_user_id == actor_id

    events = (test_db.query(ledger_model)
              .filter_by(entity_type="application", entity_id=str(application.id), action="UPDATE")
              .order_by(ledger_model.created_at)
              .all())
    assert len(events) == 2
    assert [event.actor_user_id for event in events] == [actor_id, actor_id]
    assert all(event.candidate_id == candidate.id for event in events)


def test_candidate_application_status_rejects_unsupported_status_without_changes(
    api_client, test_db, accounts, jobs_in_default_firm
):
    from backend.models.candidates import FavoriteJob
    from backend.models.db import Application

    candidate, job, application, _, headers, _ = _saved_candidate_application(
        test_db, accounts, jobs_in_default_firm, "OWNER"
    )
    response = api_client.patch(
        f"/api/applications/{application.id}/candidate-status", json={"status": "interview"}, headers=headers
    )
    assert response.status_code == 400, response.text
    test_db.expire_all()
    unchanged = test_db.get(Application, application.id)
    assert unchanged.status == "saved"
    assert unchanged.applied_at is None
    assert test_db.query(FavoriteJob).filter_by(candidate_id=candidate.id, job_id=job.id).count() == 1


def test_candidate_application_status_refuses_viewer(
    api_client, test_db, accounts, jobs_in_default_firm
):
    from backend.auth.sessions import start_session
    from backend.models.candidates import Candidate, CandidateJob, FavoriteJob
    from backend.models.db import Application, Job
    from backend.models.tenancy import Firm, User
    from backend.tests.auth_support import make_user

    firm_id = jobs_in_default_firm
    firm = test_db.get(Firm, firm_id)
    manager = make_user(test_db, firm, email="manager-viewer-case@example.test", role="MANAGER")
    viewer = make_user(test_db, firm, email="viewer-status@example.test", role="VIEWER")
    viewer_token, _ = start_session(test_db, viewer)
    candidate = Candidate(
        firm_id=firm_id,
        manager_id=manager.id,
        created_by_user_id=accounts.user_id,
        full_name="Viewer Status Test",
        work_auth="H1B",
    )
    job = Job(
        external_id="candidate-status-viewer",
        title="Platform Engineer",
        company="Example Corp",
        url="https://jobs.example.test/viewer-platform-engineer",
        source="manual",
    )
    test_db.add_all([candidate, job])
    test_db.flush()
    application = Application(
        firm_id=firm_id, candidate_id=candidate.id, job_id=job.id, status="saved", applied_at=None,
        submitted_by_user_id=None, status_transitions=[],
    )
    test_db.add_all([
        CandidateJob(firm_id=firm_id, candidate_id=candidate.id, job_id=job.id),
        FavoriteJob(firm_id=firm_id, candidate_id=candidate.id, job_id=job.id, marked_by_user_id=accounts.user_id),
        application,
    ])
    test_db.commit()

    response = api_client.patch(
        f"/api/applications/{application.id}/candidate-status", json={"status": "applied", "expected_revision": 0},
        headers={"cookie": f"bq_session={viewer_token}"},
    )
    assert response.status_code == 403, response.text
    test_db.expire_all()
    assert test_db.get(Application, application.id).status == "saved"

@pytest.mark.parametrize('target', [
    'screening_call', 'interview_schedule_request', 'interview_scheduled',
    'offer', 'shortlisted', 'move_on', 'incomplete_application', 'assessment', 'other',
])
def test_candidate_category_status_preserves_submission_and_records_actor(
    api_client, test_db, accounts, jobs_in_default_firm, target
):
    from backend.models.db import Application
    from backend.models.candidates import FavoriteJob

    candidate, job, application, _, headers, _ = _saved_candidate_application(
        test_db, accounts, jobs_in_default_firm, 'OWNER'
    )
    path = f'/api/applications/{application.id}/candidate-status'
    applied = api_client.patch(path, json={'status': 'applied', 'expected_revision': 0}, headers=headers)
    assert applied.status_code == 200, applied.text
    moved = api_client.patch(path, json={'status': target, 'expected_revision': 1}, headers=headers)
    assert moved.status_code == 200, moved.text
    assert moved.json()['status'] == target
    assert moved.json()['applied_at'] == applied.json()['applied_at']
    assert moved.json()['submitted_by_user_id'] == applied.json()['submitted_by_user_id']
    test_db.expire_all()
    row = test_db.get(Application, application.id)
    assert row.status_transitions[-1]['actor_user_id'] == str(accounts.user_id)
    assert row.status_transitions[-1]['to'] == target
    assert test_db.query(FavoriteJob).filter_by(candidate_id=candidate.id, job_id=job.id).count() == 0
    restored = api_client.patch(path, json={'status': 'saved', 'expected_revision': 2}, headers=headers)
    assert restored.status_code == 200, restored.text
    assert restored.json()['applied_at'] is None
    assert test_db.query(FavoriteJob).filter_by(candidate_id=candidate.id, job_id=job.id).count() == 1
