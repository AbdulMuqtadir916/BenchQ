"""Applications review entry points; synthetic data, no provider or mailbox calls."""
from datetime import timedelta
import uuid

import pytest

from backend.auth.sessions import start_session
from backend.models.candidates import Candidate, InboxMessage
from backend.models.db import EmailClassification
from backend.tests.auth_support import make_user
from backend.tests.isolation_support import make_world, offline  # noqa: F401


@pytest.fixture
def world(test_db, accounts, offline):
    return make_world(test_db, accounts)


def _queue(client, world, **params):
    return client.get(f"/api/firms/{world.a.firm_id}/inbox/unmatched-reviews", headers=world.a.cookie, params=params)


def _copy_email(world, *, category="assessment", state="DONE", application_id=None, outcome="UNMATCHED"):
    source = world.db.get(InboxMessage, world.a.ids["unmatched_message"])
    message = InboxMessage(firm_id=source.firm_id, candidate_id=source.candidate_id, mailbox_id=source.mailbox_id,
        application_id=application_id, provider_message_id=str(uuid.uuid4()), from_name="Synthetic Recruiter",
        from_email="recruiter@example.test", subject="Synthetic review email", snippet="Assessment",
        body="Private synthetic body", received_at=source.received_at - timedelta(days=1), classification_state=state)
    world.db.add(message)
    world.db.flush()
    world.db.add(EmailClassification(firm_id=source.firm_id, candidate_id=source.candidate_id,
        inbox_message_id=message.id, application_id=application_id, category=category, probabilities={category: 0.9},
        confidence=0.9, model="mock", category_version="mock", outcome=outcome))
    world.db.commit()
    return message


def test_queue_includes_only_actionable_unlinked_classifications_and_omits_bodies(anonymous_client, world):
    _copy_email(world, category="other")
    _copy_email(world, state="ERROR")
    _copy_email(world, state="PENDING")
    _copy_email(world, application_id=world.a.ids["app"])
    _copy_email(world, outcome="NO_CHANGE")
    result = _queue(anonymous_client, world)
    assert result.status_code == 200
    assert result.json()["total"] == 1
    message = result.json()["messages"][0]
    assert message["id"] == str(world.a.ids["unmatched_message"])
    assert message["application_id"] is None
    assert message["body"] == ""
    assert message["classification"]["outcome"] == "UNMATCHED"
    world.db.expire_all()
    assert not world.db.get(InboxMessage, world.a.ids["unmatched_message"]).is_read


def test_queue_pages_without_dropping_older_reviews(anonymous_client, world):
    older = _copy_email(world)
    first = _queue(anonymous_client, world, limit=1, offset=0).json()
    second = _queue(anonymous_client, world, limit=1, offset=1).json()
    assert first["total"] == second["total"] == 2
    assert first["messages"][0]["id"] == str(world.a.ids["unmatched_message"])
    assert second["messages"][0]["id"] == str(older.id)


def test_confirming_an_unmatched_email_removes_it_from_review(anonymous_client, world):
    from backend.models.db import Application

    app = world.db.get(Application, world.a.ids["app"])
    message_id = world.a.ids["unmatched_message"]
    path = f"/api/firms/{world.a.firm_id}/candidates/{world.a.ids['candidate']}/inbox-messages/{message_id}/review"
    result = anonymous_client.patch(path, headers=world.a.cookie, json={
        "application_id": str(app.id), "status": "assessment", "expected_revision": app.status_revision,
    })
    assert result.status_code == 200, result.text
    assert _queue(anonymous_client, world).json() == {"total": 0, "messages": []}
    world.db.expire_all()
    assert world.db.get(Application, app.id).status == "assessment"
    assert world.db.get(InboxMessage, message_id).application_id == app.id


@pytest.mark.parametrize("role", ["BDE", "MANAGER"])
def test_queue_respects_candidate_assignment_inside_the_firm(anonymous_client, world, role):
    from backend.models.tenancy import Firm, User

    user = world.db.get(User, world.a.ids["bde_user" if role == "BDE" else "manager"])
    token, _ = start_session(world.db, user)
    world.db.commit()
    path = f"/api/firms/{world.a.firm_id}/inbox/unmatched-reviews"
    headers = {"cookie": f"bq_session={token}"}
    assert anonymous_client.get(path, headers=headers).json()["total"] == 1
    candidate = world.db.get(Candidate, world.a.ids["candidate"])
    if role == "BDE":
        candidate.bde_id = None
    else:
        other_manager = make_user(world.db, world.db.get(Firm, world.a.firm_id),
                                  email="other-manager@example.test", role="MANAGER")
        candidate.manager_id = other_manager.id
    world.db.commit()
    assert anonymous_client.get(path, headers=headers).json() == {"total": 0, "messages": []}
    assert _queue(anonymous_client, world).json()["total"] == 1


def test_review_link_loads_older_email_beyond_the_latest_page(anonymous_client, world):
    older = _copy_email(world)
    path = f"/api/firms/{world.a.firm_id}/candidates/{world.a.ids['candidate']}/inbox"
    latest = anonymous_client.get(path, headers=world.a.cookie, params={"limit": 1}).json()
    assert str(older.id) not in [item["id"] for item in latest["messages"]]
    linked = anonymous_client.get(path, headers=world.a.cookie, params={"limit": 1, "message_id": str(older.id)})
    assert linked.status_code == 200
    found = next(item for item in linked.json()["messages"] if item["id"] == str(older.id))
    assert found["body"] == "Private synthetic body"


def test_review_link_never_loads_a_different_candidates_email(anonymous_client, world):
    from backend.tests.isolation_support import add_firm_b

    foreign = add_firm_b(world)
    path = f"/api/firms/{world.a.firm_id}/candidates/{world.a.ids['candidate']}/inbox"
    for message_id in [foreign.ids["unmatched_message"], uuid.uuid4()]:
        result = anonymous_client.get(path, headers=world.a.cookie, params={"message_id": str(message_id)})
        assert result.status_code == 404
        assert result.json() == {"detail": "Email not found."}


def test_review_link_cannot_read_another_candidate_in_the_same_firm(anonymous_client, world):
    from backend.models.candidates import CandidateMailbox

    original = world.db.get(Candidate, world.a.ids["candidate"])
    other = Candidate(firm_id=original.firm_id, manager_id=original.manager_id,
        created_by_user_id=original.created_by_user_id, full_name="Other Synthetic Candidate", work_auth="H1B")
    world.db.add(other)
    world.db.flush()
    mailbox = CandidateMailbox(firm_id=original.firm_id, candidate_id=other.id,
        address="other-candidate@example.test", connected_by_user_id=original.created_by_user_id)
    world.db.add(mailbox)
    world.db.flush()
    message = InboxMessage(firm_id=original.firm_id, candidate_id=other.id, mailbox_id=mailbox.id,
        provider_message_id="other-candidate-mail", from_name="Recruiter", from_email="recruiter@example.test",
        subject="Other synthetic candidate", snippet="Private to the other candidate",
        body="Other candidate body", received_at=world.db.get(InboxMessage, world.a.ids["unmatched_message"]).received_at)
    world.db.add(message)
    world.db.commit()
    path = f"/api/firms/{world.a.firm_id}/candidates/{original.id}/inbox"
    response = anonymous_client.get(path, headers=world.a.cookie, params={"message_id": str(message.id)})
    assert response.status_code == 404
    assert response.json() == {"detail": "Email not found."}
