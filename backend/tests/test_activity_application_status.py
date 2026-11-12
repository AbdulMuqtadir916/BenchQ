"""Activity logs: every way an application's status changes is an entry, with who did it, which candidate, and the before and
after. A person's move, a BDE's review, an Undo, and what the AI does by itself (an automatic change, or an email it sends to
BDE review). The AI works for the candidate's BDE, so those entries are theirs, and their manager's. Synthetic data only."""
import uuid

import pytest

from backend.applications.tracking import STATUSES
from backend.inbox import classification_worker as worker
from backend.models.candidates import Candidate, InboxMessage
from backend.models.db import Application, ApplicationReview
from backend.models.tenancy import ActivityEntry, Firm
from backend.tests.auth_support import make_user
from backend.tests.test_ledger import _session_for
from backend.tests.test_pr3_matching import matching_case, mailbox_case, email  # noqa: F401 (fixtures)
from backend.tests.test_pr3_pipeline import decision, pipeline  # noqa: F401 (fixture)
from backend.tests.test_pr4_automation import automation  # noqa: F401 (fixture)


def _entries(test_db, **filters):
    test_db.expire_all()
    return test_db.query(ActivityEntry).filter_by(**filters).order_by(ActivityEntry.created_at, ActivityEntry.id).all()


@pytest.fixture
def teams(test_db, accounts, pipeline):
    """The pipeline's candidate belongs to a manager and their BDE; another manager has a BDE of their own."""
    app_id, _, message_id = pipeline
    firm = test_db.get(Firm, accounts.firm_id)
    manager = make_user(test_db, firm, email="mgr@teams.test", role="MANAGER", name="Mira")
    bde = make_user(test_db, firm, email="bde@teams.test", role="BDE", name="Bea")
    other_manager = make_user(test_db, firm, email="mgr2@teams.test", role="MANAGER", name="Zed")
    other_bde = make_user(test_db, firm, email="bde2@teams.test", role="BDE", name="Cara")
    bde.manager_id, other_bde.manager_id = manager.id, other_manager.id
    candidate = test_db.get(Candidate, test_db.get(Application, app_id).candidate_id)
    candidate.manager_id, candidate.bde_id = manager.id, bde.id
    test_db.commit()
    return type("Teams", (), dict(app_id=app_id, message_id=message_id, firm=firm, manager=manager, bde=bde,
                                  other_bde=other_bde, candidate=candidate))


def _status(entries):
    return [(entry.changes or {}).get("status", {}).get("after") for entry in entries]


def test_an_automatic_change_is_the_candidates_bdes_and_keeps_before_and_after(test_db, teams, automation):
    assert worker.process_one(teams.message_id, provider=lambda *a: decision("screening_call", .95))
    (entry,) = _entries(test_db, action="STATE_CHANGE", entity_type="application")
    assert (entry.actor_type, entry.actor_name, entry.actor_user_id) == ("AGENT", "Email classifier", None)
    assert entry.on_behalf_of_user_id == teams.bde.id and entry.actor_role == "BDE"
    assert (entry.candidate_id, entry.candidate_bde_id, entry.candidate_manager_id) == (
        teams.candidate.id, teams.bde.id, teams.manager.id)
    assert entry.team_manager_id == teams.manager.id
    assert entry.changes == {"status": {"before": "applied", "after": "screening_call"}}
    assert entry.summary.startswith("Automatic status change from email: applied → screening_call.")
    assert "Private synthetic" not in entry.summary            # the email's own words never reach the log


def test_the_bde_their_manager_and_the_owner_see_it_but_another_teams_bde_does_not(
        anonymous_client, api_client, test_db, accounts, teams, automation):
    assert worker.process_one(teams.message_id, provider=lambda *a: decision("screening_call", .95))
    (entry,) = _entries(test_db, action="STATE_CHANGE", entity_type="application")
    url = f"/api/firms/{teams.firm.id}/ledger?limit=200"
    seen = lambda headers: {row["id"] for row in anonymous_client.get(url, headers=headers).json()}
    assert str(entry.id) in seen(_session_for(test_db, teams.bde))
    assert str(entry.id) in seen(_session_for(test_db, teams.manager))
    assert str(entry.id) in {row["id"] for row in api_client.get(url).json()}               # the owner
    assert str(entry.id) not in seen(_session_for(test_db, teams.other_bde))
    row = next(row for row in anonymous_client.get(url, headers=_session_for(test_db, teams.bde)).json()
               if row["id"] == str(entry.id))
    assert (row["actor_type"], row["on_behalf_of_name"], row["actor_role"]) == ("AGENT", "Bea", "BDE")


def test_an_email_sent_to_review_a_review_decision_and_an_undo_are_each_an_entry(
        test_db, api_client, teams, automation):
    message = test_db.get(InboxMessage, teams.message_id)
    message.sender_auth_result = "UNKNOWN"                      # not trusted enough to move the application by itself
    test_db.commit()
    assert worker.process_one(teams.message_id, provider=lambda *a: decision("screening_call", .95))
    (sent,) = _entries(test_db, entity_type="application_review")
    assert (sent.action, sent.actor_name, sent.on_behalf_of_user_id, sent.candidate_id) == (
        "CREATE", "Email classifier", teams.bde.id, teams.candidate.id)
    assert sent.summary.startswith("Email sent to BDE review (") and "Private synthetic" not in sent.summary

    review = test_db.query(ApplicationReview).filter_by(inbox_message_id=teams.message_id).one()
    app, message = test_db.get(Application, teams.app_id), test_db.get(InboxMessage, teams.message_id)
    done = api_client.patch(
        f"/api/firms/{message.firm_id}/candidates/{message.candidate_id}/inbox-messages/{message.id}/review",
        json={"review_id": str(review.id), "command_id": str(uuid.uuid4()), "expected_review_revision": review.revision,
              "expected_content_revision": message.content_revision, "application_id": str(app.id),
              "expected_application_revision": app.status_revision, "action": "SET_STATUS", "status": "screening_call"})
    assert done.status_code == 200, done.text
    reviewed = [entry for entry in _entries(test_db, entity_type="application") if entry.summary.startswith("Reviewed")]
    assert len(reviewed) == 1 and reviewed[0].actor_type == "USER"
    assert reviewed[0].changes == {"status": {"before": "applied", "after": "screening_call"}}
    assert reviewed[0].candidate_id == teams.candidate.id


def test_an_undo_of_an_automatic_change_is_an_entry_with_before_and_after(test_db, api_client, teams, automation):
    from backend.tests.test_pr4_automation import _state, _undo
    assert worker.process_one(teams.message_id, provider=lambda *a: decision("screening_call", .95))
    app, events, _, _ = _state(test_db, teams.app_id, teams.message_id)
    assert _undo(api_client, app, events[-1].id, app.status_revision).status_code == 200
    undone = [entry for entry in _entries(test_db, entity_type="application") if entry.summary.startswith("Undid")]
    assert len(undone) == 1 and undone[0].actor_type == "USER" and undone[0].candidate_id == teams.candidate.id
    assert undone[0].changes == {"status": {"before": "screening_call", "after": "applied"}}


def test_every_status_a_person_can_choose_writes_one_move_and_nothing_else_does(test_db, api_client, teams):
    app = test_db.get(Application, teams.app_id)
    path = [status for status in sorted(STATUSES) if status != app.status]

    def move(status, revision):
        return api_client.patch(f"/api/applications/{teams.app_id}/candidate-status", json={
            "status": status, "expected_revision": revision, "command_id": str(uuid.uuid4())})

    revision, before = app.status_revision, app.status
    for status in path:
        response = move(status, revision)
        assert response.status_code == 200, (status, response.text)
        revision = response.json()["status_revision"]
    moves = [entry for entry in _entries(test_db, entity_type="application") if entry.summary.startswith("Moved")]
    assert _status(moves) == path and len(moves) == len(STATUSES) - 1
    assert all(entry.candidate_id == teams.candidate.id and entry.actor_type == "USER" for entry in moves)
    assert moves[0].changes["status"]["before"] == before
    count = len(_entries(test_db, entity_type="application"))
    assert move("interview", revision).status_code == 400            # an old name: refused, nothing written
    assert move("nonsense", revision).status_code == 400
    assert move(path[-1], revision).status_code == 200                # the status it already has: nothing written
    assert move("offer", revision - 1).status_code == 409             # a stale view: refused, nothing written
    assert len(_entries(test_db, entity_type="application")) == count
