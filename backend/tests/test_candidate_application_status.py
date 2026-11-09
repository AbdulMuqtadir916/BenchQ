"""Candidate Saved ↔ Applied moves (the separate candidate-board endpoint)."""
import uuid

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
    assert restored_app.applied_at.isoformat() == applied.json()["applied_at"]
    assert restored_app.submitted_by_user_id == actor_id
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


FORM = {"fields": [
    {"label": "First name", "value": "Asha", "required": True, "source": "autofill"},
    {"label": "Why this role?", "value": "Typed on the form", "required": False, "source": "bde"},
]}


def test_the_form_is_kept_when_applied_and_cleared_when_saved_again(
    api_client, test_db, accounts, jobs_in_default_firm
):
    from backend.models.db import Application

    _, _, application, _, headers, _ = _saved_candidate_application(
        test_db, accounts, jobs_in_default_firm, "OWNER"
    )
    path = f"/api/applications/{application.id}/candidate-status"
    is_null = test_db.query(Application).filter(Application.id == application.id, Application.form_data.is_(None))
    assert is_null.count() == 1

    applied = api_client.patch(
        path, json={"status": "applied", "expected_revision": 0, "form_data": FORM}, headers=headers
    )
    assert applied.status_code == 200, applied.text
    assert "form_data" not in applied.json()
    test_db.expire_all()
    assert test_db.get(Application, application.id).form_data == FORM

    saved = api_client.patch(path, json={"status": "saved", "expected_revision": 1}, headers=headers)
    assert saved.status_code == 200, saved.text
    test_db.expire_all()
    assert is_null.count() == 1  # SQL NULL, not a JSON null


def test_applied_without_a_form_leaves_form_data_null(api_client, test_db, accounts, jobs_in_default_firm):
    from backend.models.db import Application

    _, _, application, _, headers, _ = _saved_candidate_application(
        test_db, accounts, jobs_in_default_firm, "OWNER"
    )
    path = f"/api/applications/{application.id}/candidate-status"
    applied = api_client.patch(path, json={"status": "applied", "expected_revision": 0}, headers=headers)
    assert applied.status_code == 200, applied.text
    test_db.expire_all()
    assert test_db.get(Application, application.id).form_data is None


def test_an_empty_form_still_marks_the_job_applied(api_client, test_db, accounts, jobs_in_default_firm):
    from backend.models.db import Application

    _, _, application, _, headers, _ = _saved_candidate_application(
        test_db, accounts, jobs_in_default_firm, "OWNER"
    )
    path = f"/api/applications/{application.id}/candidate-status"
    applied = api_client.patch(
        path, json={"status": "applied", "expected_revision": 0, "form_data": {"fields": []}}, headers=headers
    )
    assert applied.status_code == 200, applied.text
    test_db.expire_all()
    assert test_db.get(Application, application.id).form_data == {"fields": []}


def _field(**changes):
    return {"label": "City", "value": "Dallas", "required": False, "source": "bde", **changes}


@pytest.mark.parametrize("form_data", [
    "not an object",
    {"fields": "not a list"},
    {"fields": [], "url": "https://jobs.example.test"},
    {"fields": ["not a field"]},
    {"fields": [{"label": "City", "value": "Dallas"}]},
    {"fields": [_field(value=7)]},
    {"fields": [_field(required="yes")]},
    {"fields": [_field(source="someone")]},
    {"fields": [_field(source=["bde"])]},
    {"fields": [_field(label="L" * 501)]},
    {"fields": [_field(value="V" * 4001)]},
    {"fields": [_field(value="a\x00b")]},
    {"fields": [_field() for _ in range(201)]},
])
def test_a_malformed_form_is_refused_without_changes(
    api_client, test_db, accounts, jobs_in_default_firm, form_data
):
    from backend.models.db import Application

    _, _, application, _, headers, _ = _saved_candidate_application(
        test_db, accounts, jobs_in_default_firm, "OWNER"
    )
    response = api_client.patch(
        f"/api/applications/{application.id}/candidate-status",
        json={"status": "applied", "expected_revision": 0, "form_data": form_data}, headers=headers,
    )
    assert response.status_code == 400, response.text
    test_db.expire_all()
    stored = test_db.get(Application, application.id)
    assert (stored.status, stored.status_revision, stored.form_data) == ("saved", 0, None)


def test_a_form_goes_only_with_a_move_to_applied(api_client, test_db, accounts, jobs_in_default_firm):
    _, _, application, _, headers, _ = _saved_candidate_application(
        test_db, accounts, jobs_in_default_firm, "OWNER"
    )
    response = api_client.patch(
        f"/api/applications/{application.id}/candidate-status",
        json={"status": "screening_call", "expected_revision": 0, "form_data": FORM}, headers=headers,
    )
    assert response.status_code == 400, response.text


def test_the_resume_sent_is_kept_with_the_application(api_client, test_db, accounts, jobs_in_default_firm):
    from backend.models.db import Application
    from backend.tests.resume_support import make_version

    candidate, _, application, _, headers, _ = _saved_candidate_application(
        test_db, accounts, jobs_in_default_firm, "OWNER"
    )
    version = make_version(test_db, jobs_in_default_firm, candidate=candidate)
    test_db.commit()
    response = api_client.patch(
        f"/api/applications/{application.id}/candidate-status",
        json={"status": "applied", "expected_revision": 0, "form_data": FORM, "resume_id": str(version.id)},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    test_db.expire_all()
    assert test_db.get(Application, application.id).resume_id == version.id


@pytest.mark.parametrize("which", ["another candidate's", "deleted", "unknown", "malformed"])
def test_a_resume_that_isnt_this_candidates_is_refused_without_changes(
    api_client, test_db, accounts, jobs_in_default_firm, which
):
    from backend.models.db import Application, utcnow
    from backend.tests.resume_support import make_version

    candidate, _, application, _, headers, _ = _saved_candidate_application(
        test_db, accounts, jobs_in_default_firm, "OWNER"
    )
    if which == "another candidate's":
        resume_id = str(make_version(test_db, jobs_in_default_firm).id)
    elif which == "deleted":
        version = make_version(test_db, jobs_in_default_firm, candidate=candidate)
        version.deleted_at = utcnow()
        resume_id = str(version.id)
    elif which == "unknown":
        resume_id = str(uuid.uuid4())
    else:
        resume_id = "not-an-id"
    test_db.commit()
    response = api_client.patch(
        f"/api/applications/{application.id}/candidate-status",
        json={"status": "applied", "expected_revision": 0, "resume_id": resume_id}, headers=headers,
    )
    assert response.status_code == 400, response.text
    test_db.expire_all()
    stored = test_db.get(Application, application.id)
    assert (stored.status, stored.status_revision, stored.resume_id) == ("saved", 0, None)


def test_a_resume_goes_only_with_a_move_to_applied(api_client, test_db, accounts, jobs_in_default_firm):
    from backend.tests.resume_support import make_version

    candidate, _, application, _, headers, _ = _saved_candidate_application(
        test_db, accounts, jobs_in_default_firm, "OWNER"
    )
    version = make_version(test_db, jobs_in_default_firm, candidate=candidate)
    test_db.commit()
    response = api_client.patch(
        f"/api/applications/{application.id}/candidate-status",
        json={"status": "screening_call", "expected_revision": 0, "resume_id": str(version.id)}, headers=headers,
    )
    assert response.status_code == 400, response.text


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
    'offer', 'shortlisted', 'move_on', 'incomplete_application', 'assessment',
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
    assert restored.json()['applied_at'] == applied.json()['applied_at']
    assert restored.json()['submitted_by_user_id'] == applied.json()['submitted_by_user_id']
    assert test_db.query(FavoriteJob).filter_by(candidate_id=candidate.id, job_id=job.id).count() == 1
