"""Activity Log PR 5 part 1: applications, interviews and autofill write their entries."""
import uuid

import pytest

from backend.models.candidates import Candidate
from backend.models.db import Application, utcnow
from backend.models.tenancy import ActivityEntry, Firm, User
from backend.tests.auth_support import make_user


def _entries(test_db, **filters):
    test_db.expire_all()
    return test_db.query(ActivityEntry).filter_by(**filters).order_by(ActivityEntry.created_at).all()


@pytest.fixture
def tracked(test_db, accounts):
    """An application on a candidate (naming one of the candidate's postings, since migration 0027), and the owner signed
    in through `api_client`."""
    from backend.tests.posting_support import posting_for
    firm = test_db.get(Firm, accounts.firm_id)
    owner = test_db.get(User, accounts.user_id)
    manager = make_user(test_db, firm, email="mira@acme.test", role="MANAGER", name="Mira")
    candidate = Candidate(firm_id=firm.id, manager_id=manager.id, created_by_user_id=owner.id, full_name="Asha",
                          work_auth="H1B")
    test_db.add(candidate)
    test_db.flush()
    posting = posting_for(test_db, firm.id, candidate.id, title="Data Engineer", company="Acme", url="https://jobs.example.test/1")
    app = Application(firm_id=firm.id, job_id=posting.id, candidate_id=candidate.id, status="applied", applied_at=utcnow())
    test_db.add(app)
    test_db.commit()
    return app


# Logging an application with no candidate, and its status moves, edits and deletes, were retired by main (#129: every
# application has a candidate, and a delete is refused). A candidate's application moves through tracking.move, which
# test_activity_application_status.py covers.

def test_a_refused_delete_writes_nothing(api_client, test_db, tracked):
    assert api_client.delete(f"/api/applications/{tracked.id}").status_code == 409
    assert _entries(test_db, action="DELETE") == []


def test_an_interview_is_logged_on_its_candidate_from_start_to_end(api_client, test_db, tracked):
    created = api_client.post(f"/api/applications/{tracked.id}/interviews", json={"what": "Phone screen", "when_at": "2026-12-01T10:00:00+00:00"})
    assert created.status_code == 201, created.text
    interview_id = created.json()["id"]
    assert api_client.patch(f"/api/applications/interviews/{interview_id}", json={"status": "completed"}).status_code == 200
    assert api_client.delete(f"/api/applications/interviews/{interview_id}").status_code == 200
    entries = _entries(test_db, entity_type="interview", entity_id=str(interview_id))
    assert [e.action for e in entries] == ["CREATE", "UPDATE", "DELETE"]
    assert {e.candidate_id for e in entries} == {tracked.candidate_id}
    assert entries[0].summary == "Added interview: Phone screen for Data Engineer."
    assert entries[1].changes == {"status": {"before": "scheduled", "after": "completed"}}


def test_an_interview_edit_that_changes_nothing_writes_nothing(api_client, test_db, tracked):
    created = api_client.post(f"/api/applications/{tracked.id}/interviews", json={"what": "Phone screen"}).json()
    assert api_client.patch(f"/api/applications/interviews/{created['id']}", json={"what": "Phone screen"}).status_code == 200
    assert [e.action for e in _entries(test_db, entity_type="interview")] == ["CREATE"]


def _mock_llm(monkeypatch):
    async def fake(*args, **kwargs):
        return {"text": '{"answer": "I have five years of experience."}', "input_tokens": 1, "output_tokens": 1}
    monkeypatch.setattr("backend.api.routes_autofill.call_autofill_llm", fake, raising=False)


def test_an_ai_answer_is_logged_as_the_agent_for_the_person(api_client, test_db, accounts, monkeypatch):
    from backend.seed import seed_persona
    from backend.models.db import Setting
    seed_persona(test_db)
    test_db.add(Setting(key="autofill_prompt", value="{persona} {qa_bank} {question} {company} {position} {max_chars}"))
    test_db.commit()
    _mock_llm(monkeypatch)
    response = api_client.post("/api/autofill/answer", json={"question": "Why this job?", "company": "Acme", "position": "Data Engineer"})
    assert response.status_code == 200, response.text
    entry = _entries(test_db, action="AI_GENERATE")[0]
    owner = test_db.get(User, accounts.user_id)
    assert (entry.actor_type, entry.actor_user_id, entry.on_behalf_of_user_id) == ("AGENT", None, owner.id)
    assert entry.actor_name == f"AI agent ({owner.name})"
    assert entry.summary == f"AI agent drafted an answer for Data Engineer at Acme on behalf of {owner.name}"
    assert "Why this job" not in entry.summary


def test_a_streamed_ai_answer_is_logged_once_it_finishes(api_client, test_db, accounts, monkeypatch):
    from backend.seed import seed_persona
    from backend.models.db import Setting
    seed_persona(test_db)
    test_db.add(Setting(key="autofill_prompt", value="{persona} {qa_bank} {question} {company} {position} {max_chars}"))
    test_db.commit()

    async def chunks(*args, **kwargs):
        yield "I have five years."
    monkeypatch.setattr("backend.api.routes_autofill.call_autofill_llm_stream", chunks, raising=False)
    response = api_client.post("/api/autofill/answer/stream", json={"question": "Why?", "company": "Acme", "position": "PM"})
    assert response.status_code == 200 and "[DONE]" in response.text
    assert [e.entity_type for e in _entries(test_db, action="AI_GENERATE")] == ["autofill_answer"]


def test_a_failed_ai_answer_writes_nothing(api_client, test_db, monkeypatch):
    from backend.seed import seed_persona
    from backend.models.db import Setting
    seed_persona(test_db)
    test_db.add(Setting(key="autofill_prompt", value="{persona} {qa_bank} {question} {company} {position} {max_chars}"))
    test_db.commit()

    async def fail(*args, **kwargs):
        raise RuntimeError("no key")
    monkeypatch.setattr("backend.api.routes_autofill.call_autofill_llm", fail, raising=False)
    assert api_client.post("/api/autofill/answer", json={"question": "Why?"}).status_code == 502
    assert _entries(test_db, action="AI_GENERATE") == []
