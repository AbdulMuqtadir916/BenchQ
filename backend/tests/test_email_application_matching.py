"""Candidate email matching and status policy; provider calls are always mocked."""
from datetime import timedelta

import pytest

from backend.inbox import classification_worker as worker
from backend.inbox.decider import Classification
from backend.inbox.decider_categories import CATEGORIES, MODEL_ID
from backend.models.candidates import Candidate, CandidateMailbox, InboxMessage
from backend.models.db import (Application, ApplicationReview, ApplicationStatusEvent,
                               EmailClassification, Job, utcnow)
from backend.tests.test_candidate_application_status import _saved_candidate_application


def _case(db, accounts, firm_id):
    candidate, job, app, manager, _, _ = _saved_candidate_application(db, accounts, firm_id, "OWNER")
    job.company = "Alderbyte Systems"
    job.title = "[QA-01] Java Backend Engineer (Synthetic)"
    app.status = "applied"
    app.applied_at = utcnow() - timedelta(days=1)
    app.status_effective_at = app.applied_at
    mailbox = CandidateMailbox(firm_id=firm_id, candidate_id=candidate.id, address="candidate@example.test",
                               connected_by_user_id=accounts.user_id, status="CONNECTED")
    db.add(mailbox)
    db.commit()
    return candidate, job, app, mailbox


def _email(db, mailbox, *, subject="Java Backend Engineer at Alderbyte Systems", body="Please complete the assessment.",
           key="match-mail", thread_id="thread-1", application_id=None):
    message = InboxMessage(firm_id=mailbox.firm_id, candidate_id=mailbox.candidate_id, mailbox_id=mailbox.id,
                           application_id=application_id, provider_message_id=key, thread_id=thread_id,
                           from_name="Recruiter", from_email="recruiter@example.test", subject=subject,
                           snippet=body, body=body, received_at=utcnow())
    db.add(message)
    db.commit()
    return message


def _run(db, monkeypatch, message, *, category="assessment", confidence=0.9, auto=True):
    result = Classification(category, {key: confidence if key == category else (1 - confidence) / 9
                                       for key in CATEGORIES}, confidence, MODEL_ID, "mock", "mock-request")
    monkeypatch.setattr(worker, "classify", lambda subject, body: result)
    monkeypatch.setattr(worker, "CANDIDATE_EMAIL_AUTO_STATUS_ENABLED", auto)
    assert worker._classify_one(db, message.id)
    db.expire_all()
    return db.query(EmailClassification).filter_by(inbox_message_id=message.id).one()


@pytest.mark.parametrize(("subject", "body"), [
    ("Java Backend Engineer at Alderbyte Systems", "Please complete the assessment."),
    ("ALDERBYTE SYSTEMS — JAVA BACKEND ENGINEER", "Please complete the assessment."),
    ("Assessment requested", "Company: Alderbyte Systems\nJob title: Java   Backend Engineer"),
    ("Java Backend Engineer", "Your application to Alderbyte Systems requires an assessment."),
    ("[QA-01] Java Backend Engineer (Synthetic) at Alderbyte Systems", "Please complete the assessment."),
])
def test_unique_company_and_complete_title_link_and_apply(
        test_db, accounts, jobs_in_default_firm, monkeypatch, subject, body):
    _, _, app, mailbox = _case(test_db, accounts, jobs_in_default_firm)
    message = _email(test_db, mailbox, subject=subject, body=body)
    classification = _run(test_db, monkeypatch, message)
    assert message.application_id == classification.application_id == app.id
    assert app.status == "assessment"
    assert classification.outcome == "AUTO_APPLIED"
    event = test_db.query(ApplicationStatusEvent).filter_by(application_id=app.id).one()
    assert event.source == "email_classifier"
    assert event.original_payload["email_id"] == str(message.id)
    assert event.original_payload["classification_id"] == str(classification.id)
    assert not worker._classify_one(test_db, message.id)
    assert test_db.query(ApplicationStatusEvent).filter_by(application_id=app.id).count() == 1
    assert test_db.query(EmailClassification).filter_by(inbox_message_id=message.id).count() == 1


@pytest.mark.parametrize(("confidence", "auto", "change", "reason"), [
    (0.5999, True, None, "LOW_CONFIDENCE"),
    (0.6, True, "assessment", None),
    (0.9, False, None, "AUTO_STATUS_DISABLED"),
    (0.9, True, "manual", "STATUS_REVIEW"),
    (0.9, True, "stale", "STATUS_REVIEW"),
])
def test_matching_preserves_classification_and_freshness_gates(
        test_db, accounts, jobs_in_default_firm, monkeypatch, confidence, auto, change, reason):
    _, _, app, mailbox = _case(test_db, accounts, jobs_in_default_firm)
    app.status = "interview_scheduled"  # A submitted application remains matchable after Applied.
    message = _email(test_db, mailbox)
    if change == "manual":
        app.last_manual_change_at = message.received_at + timedelta(seconds=1)
    elif change == "stale":
        app.applied_at = message.received_at + timedelta(seconds=1)
    test_db.commit()
    classification = _run(test_db, monkeypatch, message, confidence=confidence, auto=auto)
    assert message.application_id == app.id
    if reason:
        assert app.status == "interview_scheduled"
        assert classification.outcome == "REVIEW"
        review = test_db.query(ApplicationReview).filter_by(inbox_message_id=message.id).one()
        assert review.reason == reason and review.state == "PENDING"
        assert test_db.query(ApplicationStatusEvent).filter_by(application_id=app.id).count() == 0
    else:
        assert app.status == "assessment" and classification.outcome == "AUTO_APPLIED"


@pytest.mark.parametrize("subject", [
    "Assessment for Java Backend Engineer",  # Missing company.
    "Assessment at Alderbyte Systems",  # Missing title.
    "Backend Engineer at Alderbyte Systems",  # Partial role.
    "Java Backend Engineer at Alderbyte",  # Partial company.
    "Java Backend Engineering at Alderbyte Systems",  # Substring is not a name.
    "Senior Java Backend Engineer at Alderbyte Systems",  # Missing seniority must not match.
    "Java Backend Engineer II at Alderbyte Systems",
    "Java Backend Engineer at Alderbyte Systems International",
    "Offer shortlisted assessment interview",  # Category words supply no identity.
    "Network Engineer at Junipercrest Networks",  # No application exists.
])
def test_unmatched_job_related_email_is_available_for_bde_review_without_status_change(
        test_db, accounts, jobs_in_default_firm, monkeypatch, api_client, subject):
    candidate, _, app, mailbox = _case(test_db, accounts, jobs_in_default_firm)
    message = _email(test_db, mailbox, subject=subject)
    classification = _run(test_db, monkeypatch, message)
    assert message.application_id is None and classification.application_id is None
    assert classification.outcome == "UNMATCHED" and app.status == "applied"
    assert test_db.query(ApplicationStatusEvent).count() == test_db.query(ApplicationReview).count() == 0
    response = api_client.get(f"/api/firms/{candidate.firm_id}/candidates/{candidate.id}/inbox")
    assert response.status_code == 200
    item = next(row for row in response.json()["messages"] if row["id"] == str(message.id))
    assert item["classification"]["category"] == "assessment"
    assert item["classification"]["outcome"] == "UNMATCHED"
    assert item["application_id"] is None  # Existing UI derives its review queue from these fields.


@pytest.mark.parametrize("default_date", [False, True])
def test_saved_without_submission_is_not_an_automatic_match(
        test_db, accounts, jobs_in_default_firm, monkeypatch, default_date):
    _, _, app, mailbox = _case(test_db, accounts, jobs_in_default_firm)
    app.status = "saved"
    app.applied_at = utcnow() if default_date else None
    app.submitted_by_user_id = None
    test_db.commit()
    message = _email(test_db, mailbox)
    classification = _run(test_db, monkeypatch, message)
    assert classification.outcome == "UNMATCHED" and message.application_id is None
    assert app.status == "saved"


def test_two_submitted_postings_with_same_names_are_ambiguous(test_db, accounts, jobs_in_default_firm, monkeypatch):
    candidate, _, app, mailbox = _case(test_db, accounts, jobs_in_default_firm)
    job2 = Job(external_id="duplicate-title-company", company="Alderbyte Systems", title="Java Backend Engineer")
    test_db.add(job2)
    test_db.flush()
    app2 = Application(firm_id=candidate.firm_id, candidate_id=candidate.id, job_id=job2.id,
                       status="applied", applied_at=utcnow() - timedelta(days=1))
    test_db.add(app2)
    test_db.commit()
    message = _email(test_db, mailbox)
    classification = _run(test_db, monkeypatch, message)
    assert classification.outcome == "UNMATCHED" and message.application_id is None
    assert app.status == app2.status == "applied"


def test_other_does_not_create_name_link_or_application_review(test_db, accounts, jobs_in_default_firm, monkeypatch):
    _, _, app, mailbox = _case(test_db, accounts, jobs_in_default_firm)
    message = _email(test_db, mailbox, subject="Weekend newsletter", body="Community news")
    classification = _run(test_db, monkeypatch, message, category="other")
    assert classification.outcome == "UNMATCHED" and message.application_id is None
    assert app.status == "applied" and test_db.query(ApplicationReview).count() == 0


def test_matching_cannot_link_another_candidate_or_firm(test_db, accounts, jobs_in_default_firm, monkeypatch):
    from backend.tests.auth_support import make_firm, make_plan, make_user
    candidate, job, app, mailbox = _case(test_db, accounts, jobs_in_default_firm)
    other = Candidate(firm_id=candidate.firm_id, manager_id=candidate.manager_id,
                      created_by_user_id=accounts.user_id, full_name="Other Candidate", work_auth="H1B")
    firm2 = make_firm(test_db, make_plan(test_db, "Other plan"), slug="other")
    owner2 = make_user(test_db, firm2, email="owner@other.test")
    manager2 = make_user(test_db, firm2, email="manager@other.test", role="MANAGER")
    foreign = Candidate(firm_id=firm2.id, manager_id=manager2.id, created_by_user_id=owner2.id,
                        full_name="Foreign Candidate", work_auth="H1B")
    test_db.add_all([other, foreign])
    test_db.flush()
    other_app = Application(firm_id=candidate.firm_id, candidate_id=other.id, job_id=job.id, status="applied")
    foreign_app = Application(firm_id=firm2.id, candidate_id=foreign.id, job_id=job.id, status="applied")
    # Even a malformed application with this candidate's ID cannot cross the firm filter.
    malformed_job = Job(external_id="malformed-isolation", company=job.company, title=job.title)
    test_db.add(malformed_job)
    test_db.flush()
    malformed = Application(firm_id=firm2.id, candidate_id=candidate.id,
                            job_id=malformed_job.id, status="applied")
    test_db.add_all([other_app, foreign_app, malformed])
    test_db.commit()
    _email(test_db, mailbox, key="wrong-candidate-thread-link", application_id=other_app.id)
    _email(test_db, mailbox, key="wrong-firm-thread-link", application_id=foreign_app.id)
    message = _email(test_db, mailbox)
    classification = _run(test_db, monkeypatch, message)
    assert classification.application_id == app.id
    assert other_app.status == foreign_app.status == "applied"
    app.applied_at = None
    app.submitted_by_user_id = None
    test_db.commit()
    second = _email(test_db, mailbox, key="no-local-submission", thread_id="unrelated-thread")
    assert _run(test_db, monkeypatch, second).outcome == "UNMATCHED"
    assert second.application_id is None


def test_matched_thread_is_reused_for_later_reply(test_db, accounts, jobs_in_default_firm, monkeypatch):
    from backend.inbox.gmail_sync import _matching_application_id
    _, _, app, mailbox = _case(test_db, accounts, jobs_in_default_firm)
    first = _email(test_db, mailbox)
    _run(test_db, monkeypatch, first)
    assert _matching_application_id(test_db, mailbox, first.thread_id) == app.id
    second = _email(test_db, mailbox, key="reply", subject="Re: assessment", body="Congratulations!",
                    application_id=_matching_application_id(test_db, mailbox, first.thread_id))
    assert _run(test_db, monkeypatch, second, category="offer").outcome == "AUTO_APPLIED"
    assert second.application_id == app.id and app.status == "offer"


def test_unmatched_email_can_be_linked_and_confirmed_by_bde_review(
        test_db, accounts, jobs_in_default_firm, monkeypatch, api_client):
    candidate, _, app, mailbox = _case(test_db, accounts, jobs_in_default_firm)
    message = _email(test_db, mailbox, subject="Your assessment", body="Please complete this test")
    classification = _run(test_db, monkeypatch, message)
    response = api_client.patch(
        f"/api/firms/{candidate.firm_id}/candidates/{candidate.id}/inbox-messages/{message.id}/review",
        json={"application_id": str(app.id), "status": "assessment", "expected_revision": app.status_revision})
    assert response.status_code == 200, response.text
    test_db.expire_all()
    assert message.application_id == app.id and app.status == "assessment"
    assert classification.outcome == "UNMATCHED" and classification.application_id is None  # Immutable original result.
    review = test_db.query(ApplicationReview).filter_by(inbox_message_id=message.id).one()
    assert review.state == "RESOLVED" and review.classification_id == classification.id
    assert test_db.query(ApplicationStatusEvent).filter_by(application_id=app.id).one().source == "bde_review"


def test_application_resolution_happens_before_status_classification(
        test_db, accounts, jobs_in_default_firm, monkeypatch):
    _, _, app, mailbox = _case(test_db, accounts, jobs_in_default_firm)
    message = _email(test_db, mailbox)
    calls = []
    real_match = worker.matching_application_id
    def matching(*args):
        result = real_match(*args)
        calls.append(("match", result))
        return result
    def classify(subject, body):
        assert calls == [("match", app.id)]
        calls.append(("classify", None))
        return Classification("assessment", {key: 0.9 if key == "assessment" else 0.1 / 9
                                              for key in CATEGORIES}, 0.9, MODEL_ID, "mock", "mock-request")
    monkeypatch.setattr(worker, "matching_application_id", matching)
    monkeypatch.setattr(worker, "classify", classify)
    monkeypatch.setattr(worker, "CANDIDATE_EMAIL_AUTO_STATUS_ENABLED", True)
    assert worker._classify_one(test_db, message.id)
    assert calls[0][0] == "match" and calls[1][0] == "classify"
    assert message.application_id == app.id and app.status == "assessment"


def test_conflicting_thread_links_remain_unmatched(test_db, accounts, jobs_in_default_firm, monkeypatch):
    from backend.inbox.gmail_sync import _matching_application_id
    candidate, _, app, mailbox = _case(test_db, accounts, jobs_in_default_firm)
    job2 = Job(external_id="other-thread-job", company="Different Company", title="Other Engineer")
    test_db.add(job2)
    test_db.flush()
    app2 = Application(firm_id=candidate.firm_id, candidate_id=candidate.id, job_id=job2.id, status="applied")
    test_db.add(app2)
    test_db.commit()
    _email(test_db, mailbox, key="prior-1", application_id=app.id)
    _email(test_db, mailbox, key="prior-2", application_id=app2.id)
    assert _matching_application_id(test_db, mailbox, "thread-1") is None
    message = _email(test_db, mailbox, key="conflict")
    assert _run(test_db, monkeypatch, message).outcome == "UNMATCHED"
    assert message.application_id is None and app.status == app2.status == "applied"


@pytest.mark.parametrize(("title", "company", "subject"), [
    (".NET Developer", "Grovepoint Technologies", ".NET Developer at Grovepoint Technologies"),
    ("C# Developer", "Example & Partners", "C# Developer at Example and Partners"),
    ("C++ Developer", "Example Systems, Inc.", "C++ Developer at Example Systems Inc"),
])
def test_punctuation_preserves_technology_and_company_names(
        test_db, accounts, jobs_in_default_firm, monkeypatch, title, company, subject):
    _, job, app, mailbox = _case(test_db, accounts, jobs_in_default_firm)
    job.title, job.company = title, company
    test_db.commit()
    message = _email(test_db, mailbox, subject=subject)
    assert _run(test_db, monkeypatch, message).application_id == app.id


def test_registered_company_alias_is_allowed(test_db, accounts, jobs_in_default_firm, monkeypatch):
    from backend.models.db import Company
    _, _, app, mailbox = _case(test_db, accounts, jobs_in_default_firm)
    test_db.add(Company(name="Alderbyte Systems", aliases=["Alderbyte Software Group"], active=False))
    test_db.commit()
    message = _email(test_db, mailbox, subject="Java Backend Engineer at Alderbyte Software Group")
    assert _run(test_db, monkeypatch, message).application_id == app.id


def test_worker_preserves_bde_link_and_manual_change_during_provider_call(
        test_db, accounts, jobs_in_default_firm, monkeypatch):
    from backend.models.db import SessionLocal
    candidate, _, app, mailbox = _case(test_db, accounts, jobs_in_default_firm)
    job2 = Job(external_id="concurrent-human-job", company="Other Company", title="Other Engineer")
    test_db.add(job2)
    test_db.flush()
    app2 = Application(firm_id=candidate.firm_id, candidate_id=candidate.id, job_id=job2.id, status="offer")
    test_db.add(app2)
    test_db.commit()
    message = _email(test_db, mailbox)
    message_id, app2_id = message.id, app2.id
    def classify(subject, body):
        with SessionLocal() as concurrent:
            concurrent.get(InboxMessage, message_id).application_id = app2_id
            concurrent.get(Application, app2_id).last_manual_change_at = utcnow()
            concurrent.commit()
        return Classification("assessment", {key: 0.9 if key == "assessment" else 0.1 / 9
                                              for key in CATEGORIES}, 0.9, MODEL_ID, "mock", "mock-request")
    monkeypatch.setattr(worker, "classify", classify)
    monkeypatch.setattr(worker, "CANDIDATE_EMAIL_AUTO_STATUS_ENABLED", True)
    assert worker._classify_one(test_db, message.id)
    test_db.expire_all()
    assert message.application_id == app2.id
    classification = test_db.query(EmailClassification).filter_by(inbox_message_id=message.id).one()
    assert classification.application_id == app2.id and classification.outcome == "REVIEW"
    assert app.status == "applied" and app2.status == "offer"
    assert test_db.query(ApplicationReview).filter_by(inbox_message_id=message.id).one().reason == "STATUS_REVIEW"


@pytest.mark.parametrize('category', list(CATEGORIES))
def test_each_confident_matched_category_moves_directly_without_bde_review(
        test_db, accounts, jobs_in_default_firm, monkeypatch, category):
    _, _, app, mailbox = _case(test_db, accounts, jobs_in_default_firm)
    message = _email(test_db, mailbox)
    result = _run(test_db, monkeypatch, message, category=category, confidence=0.6)
    assert message.application_id == app.id and app.status == category
    assert result.outcome == ('NO_CHANGE' if category == 'applied' else 'AUTO_APPLIED')
    assert test_db.query(ApplicationReview).filter_by(inbox_message_id=message.id).count() == 0


def test_automatic_status_audit_uses_agent_and_is_idempotent(test_db, accounts, jobs_in_default_firm, monkeypatch):
    from backend.models.tenancy import LedgerEntry
    candidate, _, app, mailbox = _case(test_db, accounts, jobs_in_default_firm)
    message = _email(test_db, mailbox, application_id=app.id)
    _run(test_db, monkeypatch, message, category='offer')
    entries = test_db.query(LedgerEntry).filter_by(candidate_id=candidate.id, entity_type='application').all()
    assert len(entries) == 1
    assert entries[0].actor_type == 'AGENT'
    assert entries[0].actor_user_id is None
    assert entries[0].action == 'STATE_CHANGE'
    assert message.subject not in entries[0].summary and message.body not in entries[0].summary
    assert not worker._classify_one(test_db, message.id)
    assert test_db.query(LedgerEntry).filter_by(candidate_id=candidate.id, entity_type='application').count() == 1
