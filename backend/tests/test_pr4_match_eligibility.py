"""PR 4 T2.3 (DEBUG D-07): one match-eligibility rule, used by matching, the worker and the review dropdown."""
import pytest

from backend.inbox import classification_worker as worker
from backend.inbox.application_matching import is_match_eligible, matching_application_id, submitted_applications
from backend.models.db import EmailClassification
from backend.tests.test_pr3_matching import matching_case, mailbox_case, email  # noqa: F401 (fixtures)
from backend.tests.test_pr3_pipeline import decision, pipeline  # noqa: F401 (fixture)

STATUSES = ['applied', 'screening_call', 'shortlisted', 'interview_schedule_request', 'interview_scheduled',
            'assessment', 'offer', 'move_on', 'incomplete_application']


@pytest.mark.parametrize('status', STATUSES)
def test_any_status_but_saved_is_eligible_without_submission_facts(test_db, matching_case, status):
    _, _, app, box, row = matching_case
    app.status, app.applied_at, app.submitted_by_user_id = status, None, None  # e.g. Saved → Screening call directly
    test_db.commit()
    assert is_match_eligible(app)
    assert submitted_applications(test_db, app.firm_id, app.candidate_id).filter_by(id=app.id).first() is not None
    assert matching_application_id(test_db, box, row) == app.id


def test_saved_is_eligible_only_with_a_recorded_submitter(test_db, matching_case):
    _, _, app, box, row = matching_case
    app.status, app.applied_at = 'saved', None
    test_db.commit()
    assert is_match_eligible(app)  # moved back to Saved after a real submission: still the same application
    app.submitted_by_user_id = None
    test_db.commit()
    assert not is_match_eligible(app)
    assert matching_application_id(test_db, box, row) is None


def test_worker_links_an_application_that_skipped_applied(test_db, pipeline):
    from backend.models.db import Application
    app_id, _, message_id = pipeline
    app = test_db.get(Application, app_id)
    app.status, app.applied_at, app.submitted_by_user_id = 'screening_call', None, None
    test_db.commit()
    assert worker.process_one(message_id, provider=lambda *a: decision('assessment', .9))
    test_db.expire_all()
    assert test_db.query(EmailClassification).one().application_id == app_id


def test_aliases_are_built_once_per_sweep_with_identical_results(test_db, pipeline, monkeypatch):
    from backend.inbox import application_matching
    from backend.inbox.application_matching import company_aliases
    from backend.models.candidates import CandidateMailbox, InboxMessage
    _, mailbox_id, message_id = pipeline
    box, row = test_db.get(CandidateMailbox, mailbox_id), test_db.get(InboxMessage, message_id)
    assert matching_application_id(test_db, box, row) == matching_application_id(test_db, box, row, aliases=company_aliases(test_db))
    calls = []
    real = worker.company_aliases
    monkeypatch.setattr(worker, 'company_aliases', lambda db: calls.append(1) or real(db))
    monkeypatch.setattr(worker, 'process_one', lambda identity, aliases=None: aliases is not None)
    assert worker.process_pending() == 1 and calls == [1]
    assert application_matching.company_aliases is company_aliases
