"""F2b: a row a firm user creates belongs to that user's firm, and a job the firm finds or captures is linked to it
in firm_jobs (docs/integration/07-auth-and-tenancy.md F2b, agreed 2026-10-23)."""
import uuid

import pytest
from fastapi import HTTPException

from backend.auth.scoping import writer_firm_id
from backend.auth.sessions import Principal
from backend.models.db import Application, CoverLetter, Job, Resume, Search
from backend.models.tenancy import DEFAULT_FIRM_ID, FirmJob


def _links(db, job_id):
    db.expire_all()
    return db.query(FirmJob).filter(FirmJob.job_id == job_id).all()


def test_a_platform_admin_cannot_write_firm_data():
    admin = Principal(kind="platform", user_id=uuid.uuid4(), session_id=uuid.uuid4(), role="PLATFORM_ADMIN")
    with pytest.raises(HTTPException) as err:
        writer_firm_id(admin)
    assert err.value.status_code == 403


def test_a_logged_application_belongs_to_the_users_firm(api_client, accounts, test_db):
    resp = api_client.post("/api/applications", json={"title": "Engineer", "company": "Acme",
                                                      "url": "https://acme.test/jobs/1"})
    assert resp.status_code in (200, 201), resp.text
    app = test_db.query(Application).one()
    assert app.firm_id == accounts.firm_id
    [link] = _links(test_db, app.job_id)
    assert (link.firm_id, link.origin, link.captured_by_user_id) == (accounts.firm_id, "CAPTURED", accounts.user_id)


def test_a_hand_added_job_is_captured_by_the_user(api_client, accounts, test_db):
    resp = api_client.post("/api/jobs/manual", json={"title": "Analyst", "company": "Globex",
                                                     "url": "https://globex.test/jobs/2"})
    assert resp.status_code == 200, resp.text
    [link] = _links(test_db, uuid.UUID(resp.json()["id"]))
    assert (link.firm_id, link.origin, link.captured_by_user_id) == (accounts.firm_id, "CAPTURED", accounts.user_id)

    # The same posting again changes nothing and adds no second link.
    again = api_client.post("/api/jobs/manual", json={"title": "Analyst", "company": "Globex",
                                                      "url": "https://globex.test/jobs/2"})
    assert again.json()["created"] is False
    assert len(_links(test_db, link.job_id)) == 1


def test_documents_belong_to_the_users_firm(api_client, accounts, test_db):
    resume = api_client.post("/api/resumes", json={"name": "Base"})
    assert resume.status_code == 201, resume.text
    letter = api_client.post("/api/cover-letters", json={"name": "Letter"})
    assert letter.status_code == 201, letter.text
    test_db.expire_all()
    assert test_db.get(Resume, uuid.UUID(resume.json()["id"])).firm_id == accounts.firm_id
    assert test_db.get(CoverLetter, uuid.UUID(letter.json()["id"])).firm_id == accounts.firm_id


def test_a_scraped_job_goes_to_its_searchs_firm(test_db, default_firm):
    search = Search(firm_id=DEFAULT_FIRM_ID, name="Keywords", search_mode="keyword")
    test_db.add(search)
    test_db.flush()
    job = Job(external_id="ext-1", title="Engineer", company="Acme", url="https://a.test", source="jobspy_indeed",
              search_id=search.id)
    test_db.add(job)
    test_db.commit()
    [link] = _links(test_db, job.id)
    assert (link.firm_id, link.origin, link.search_id, link.captured_by_user_id) == (
        DEFAULT_FIRM_ID, "SCRAPED", search.id, None)


def test_a_captured_job_is_not_linked_as_scraped(test_db, default_firm):
    """The extension's jobs carry the Extension search's id, but its route links them CAPTURED, by the user."""
    search = Search(firm_id=DEFAULT_FIRM_ID, name="Extension", search_mode="extension")
    test_db.add(search)
    test_db.flush()
    job = Job(external_id="ext-2", title="Engineer", company="Acme", url="https://b.test", source="extension",
              search_id=search.id)
    test_db.add(job)
    test_db.commit()
    assert _links(test_db, job.id) == []
