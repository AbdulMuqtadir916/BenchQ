"""Activity Log PR 5 part 3: cover letters write their entries, on the candidate their résumé belongs to."""
import asyncio
from contextlib import asynccontextmanager
from unittest.mock import MagicMock
import uuid

import pytest

import backend.api.routes_cover_letters as rcl
from backend.models.db import Job, Setting
from backend.models.tenancy import ActivityEntry, DEFAULT_FIRM_ID, User
from backend.tests.resume_support import make_version

pytestmark = pytest.mark.usefixtures("jobs_in_default_firm")


def _entries(test_db, **filters):
    test_db.expire_all()
    return test_db.query(ActivityEntry).filter_by(entity_type="cover_letter", **filters).order_by(ActivityEntry.created_at).all()


@pytest.fixture
def resume(test_db, accounts):
    row = make_version(test_db, DEFAULT_FIRM_ID, candidate_name="Asha", name="PM", full_name="Asha", summary="PM.")
    test_db.commit()
    return row


def _create(api_client, resume=None, name="Acme letter"):
    response = api_client.post("/api/cover-letters", json={"name": name, "json_data": {"greeting": "Dear Team,"},
                                                           **({"resume_id": str(resume.id)} if resume else {})})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def test_creating_a_letter_is_logged_on_its_candidate(api_client, test_db, accounts, resume):
    letter = _create(api_client, resume)
    entry = _entries(test_db, entity_id=letter, action="CREATE")[0]
    assert (entry.summary, entry.candidate_id) == ("Created cover letter Acme letter.", resume.candidate_id)
    assert entry.actor_user_id == accounts.user_id


def test_a_letter_with_no_resume_is_about_no_candidate(api_client, test_db, accounts):
    letter = _create(api_client)
    assert _entries(test_db, entity_id=letter)[0].candidate_id is None


def test_an_edit_keeps_before_and_after_but_never_the_letters_text(api_client, test_db, resume):
    letter = _create(api_client, resume)
    assert api_client.patch(f"/api/cover-letters/{letter}", json={"name": "New name", "json_data": {"greeting": "Private words"}}).status_code == 200
    entry = _entries(test_db, entity_id=letter, action="UPDATE")[0]
    assert entry.changes == {"name": {"before": "Acme letter", "after": "New name"}}
    assert "Private words" not in f"{entry.summary} {entry.changes}"


def test_editing_only_the_text_is_logged(api_client, test_db, resume):
    letter = _create(api_client, resume)
    assert api_client.patch(f"/api/cover-letters/{letter}", json={"json_data": {"greeting": "Changed"}}).status_code == 200
    entry = _entries(test_db, entity_id=letter, action="UPDATE")[0]
    assert (entry.summary, entry.changes) == ("Edited cover letter Acme letter.", None)


def test_an_edit_that_changes_nothing_writes_nothing(api_client, test_db, resume):
    letter = _create(api_client, resume)
    assert api_client.patch(f"/api/cover-letters/{letter}", json={"name": "Acme letter"}).status_code == 200
    assert _entries(test_db, entity_id=letter, action="UPDATE") == []


def test_deleting_a_letter_is_logged(api_client, test_db, resume):
    letter = _create(api_client, resume)
    assert api_client.delete(f"/api/cover-letters/{letter}").status_code == 200
    entry = _entries(test_db, entity_id=letter, action="DELETE")[0]
    assert (entry.summary, entry.candidate_id) == ("Deleted cover letter Acme letter.", resume.candidate_id)


def _generate(test_db, resume, requested_by, body=None):
    test_db.add(Setting(key="cover_letter_prompt", value="Voice {voice_instruction} Len {length_instruction} JD {job_description} R {resume_text}"))
    job = Job(id=uuid.uuid4(), external_id=uuid.uuid4().hex, company="Acme", title="Senior PM", url="https://acme.com/1",
              status="saved", description="A fintech PM.")
    test_db.add(job)
    test_db.commit()

    async def written(*args, **kwargs):
        return {"greeting": "Dear Acme,", "body_paragraphs": ["p"], "closing": "Regards,", "signature": "Asha"}

    @asynccontextmanager
    async def track(*args, **kwargs):
        yield MagicMock()

    asyncio.run(rcl._generate_inner(str(resume.id), str(job.id), None, "concise", None, None, lambda db, voice: (None, ""),
                                    body or written, track, firm_id=str(DEFAULT_FIRM_ID), requested_by=requested_by))


def test_a_generated_letter_is_logged_as_the_agent_for_the_person(test_db, accounts, resume):
    owner = test_db.get(User, accounts.user_id)
    _generate(test_db, resume, str(owner.id))
    entry = _entries(test_db, action="AI_GENERATE")[0]
    assert (entry.actor_type, entry.actor_name) == ("AGENT", f"AI agent ({owner.name})")
    assert (entry.on_behalf_of_user_id, entry.candidate_id) == (owner.id, resume.candidate_id)
    assert entry.summary == f"AI agent generated a cover letter for Acme — Senior PM on behalf of {owner.name}"


def test_a_failed_generation_writes_nothing(test_db, accounts, resume):
    async def fails(*args, **kwargs):
        raise RuntimeError("no key")
    with pytest.raises(RuntimeError):
        _generate(test_db, resume, str(accounts.user_id), fails)
    assert _entries(test_db) == []


def test_the_route_tells_the_worker_who_asked(api_client, test_db, accounts, resume, monkeypatch):
    seen = {}
    monkeypatch.setattr(rcl, "launch_background", lambda *args, **kwargs: seen.update(kwargs["func_kwargs"]) or "run")
    test_db.add(Setting(key="cover_letter_prompt", value="x"))
    job = Job(id=uuid.uuid4(), external_id=uuid.uuid4().hex, company="Acme", title="PM", url="https://acme.com/2", status="saved", description="d")
    test_db.add(job)
    test_db.commit()
    response = api_client.post("/api/cover-letters/generate", json={"resume_id": str(resume.id), "job_id": str(job.id)})
    assert response.status_code == 202, response.text
    assert seen["requested_by"] == str(accounts.user_id)
