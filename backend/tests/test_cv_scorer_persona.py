"""Persona-as-virtual-Resume scoring helpers."""
import pytest
from backend.models.db import Persona
from backend.analyzer import cv_scorer
from backend.models.tenancy import DEFAULT_FIRM_ID
from backend.tests.resume_support import old_resume

pytestmark = pytest.mark.usefixtures("jobs_in_default_firm")


def test_get_persona_text_empty_returns_empty_dict(test_db):
    """No persona row → {}."""
    out = cv_scorer._get_persona_text(test_db)
    assert out == {}


def test_get_persona_text_blank_resume_content_returns_empty_dict(test_db):
    """Persona row with empty resume_content → {} (don't return blank entry)."""
    test_db.add(Persona(id=1, resume_content={}))
    test_db.commit()
    out = cv_scorer._get_persona_text(test_db)
    assert out == {}


def test_get_persona_text_returns_persona_keyed_dict(test_db):
    """Persona with resume_content → {'Persona': flattened_text}."""
    test_db.add(Persona(id=1, resume_content={
        "summary": "Senior PM with 10 years of FinTech experience.",
        "experience": [{"title": "PM", "company": "Acme", "dates": "2020-2024",
                        "bullets": ["Shipped X", "Led Y"]}],
    }))
    test_db.commit()
    out = cv_scorer._get_persona_text(test_db)
    assert list(out.keys()) == ["Persona"]
    assert "Senior PM" in out["Persona"]
    assert "Shipped X" in out["Persona"]


from backend.models.db import Resume, Setting, Company
import uuid


def _seed_persona(db, summary="P-summary"):
    db.add(Persona(id=1, resume_content={"summary": summary}))
    db.commit()


def _seed_resume(db, name="PM"):
    r = old_resume(db, DEFAULT_FIRM_ID, name, {"summary": f"{name}-summary"})
    db.commit()
    return r


def test_get_resume_texts_includes_persona_when_populated(test_db):
    _seed_resume(test_db, "PM")
    _seed_persona(test_db)
    out = cv_scorer._get_resume_texts(test_db, DEFAULT_FIRM_ID)
    assert "PM" in out
    assert "Persona" in out


def test_get_resume_texts_omits_persona_when_empty(test_db):
    _seed_resume(test_db, "PM")
    out = cv_scorer._get_resume_texts(test_db, DEFAULT_FIRM_ID)
    assert "PM" in out
    assert "Persona" not in out


# The platform-wide default_resume_id (persona included) is no longer read since résumé versioning PR 6; a company's
# selection can still name the persona (below).


def test_get_resume_texts_for_company_persona_in_selection(test_db):
    r = _seed_resume(test_db, "PM")
    _seed_persona(test_db)
    company = Company(id=uuid.uuid4(), name="Acme", selected_resume_ids=["persona"])
    test_db.add(company)
    test_db.commit()
    out = cv_scorer._get_resume_texts_for_company(test_db, company, DEFAULT_FIRM_ID)
    assert list(out.keys()) == ["Persona"]


def test_get_resume_texts_for_company_mixed_selection(test_db):
    r = _seed_resume(test_db, "PM")
    _seed_persona(test_db)
    company = Company(id=uuid.uuid4(), name="Acme",
                      selected_resume_ids=[str(r.id), "persona"])
    test_db.add(company)
    test_db.commit()
    out = cv_scorer._get_resume_texts_for_company(test_db, company, DEFAULT_FIRM_ID)
    assert "PM" in out
    assert "Persona" in out


from unittest.mock import patch, AsyncMock
from backend.models.db import Job


@pytest.mark.asyncio
async def test_score_single_job_persona_id_uses_persona_text(test_db, monkeypatch):
    """score_single_job(cv_ids=['persona']) flattens persona.resume_content into the LLM call."""
    job = Job(id=uuid.uuid4(), title="PM", company="Acme",
              external_id="ext-persona-test",
              description="Looking for a PM with FinTech experience")
    test_db.add(job)
    _seed_persona(test_db, summary="Strong FinTech PM")
    test_db.commit()
    job_id = str(job.id)

    captured = {}

    async def fake_score_job_sync(job_obj, cv_texts, db=None, depth="full", preloaded_text=None):
        captured["cv_texts"] = cv_texts
        return {"Persona": {"score": 80, "summary": "Good fit"}}

    monkeypatch.setattr("backend.analyzer.cv_scorer.score_job_sync", fake_score_job_sync)
    # score_single_job reads the text off the row (no session held for a fetch),
    # so stub that seam rather than the old _get_job_text wrapper.
    monkeypatch.setattr("backend.analyzer.cv_scorer._job_text_from_row",
                        lambda job: "JD text")

    await cv_scorer.score_single_job(job_id, cv_ids=["persona"], depth="full", firm_id=DEFAULT_FIRM_ID)

    assert "Persona" in captured["cv_texts"]
    assert "Strong FinTech PM" in captured["cv_texts"]["Persona"]
