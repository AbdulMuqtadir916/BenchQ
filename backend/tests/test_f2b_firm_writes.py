"""F2b: a row a firm user creates belongs to that user's firm, and a job the firm finds or captures is linked to it
in firm_jobs (docs/integration/07-auth-and-tenancy.md F2b, agreed 2026-10-23)."""
import uuid

import pytest
from fastapi import HTTPException

from backend.auth.scoping import writer_firm_id
from backend.auth.sessions import Principal
from backend.models.db import CoverLetter, Job, Resume, Search
from backend.models.tenancy import DEFAULT_FIRM_ID, FirmJob


def _links(db, job_id):
    db.expire_all()
    return db.query(FirmJob).filter(FirmJob.job_id == job_id).all()


def test_a_platform_admin_cannot_write_firm_data():
    admin = Principal(kind="platform", user_id=uuid.uuid4(), session_id=uuid.uuid4(), role="PLATFORM_ADMIN")
    with pytest.raises(HTTPException) as err:
        writer_firm_id(admin)
    assert err.value.status_code == 403


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
