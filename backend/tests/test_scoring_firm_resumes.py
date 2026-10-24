"""Scoring reads only the résumés of the firm it scores for (docs/integration/07-auth-and-tenancy.md F2c, "known
leak"). A résumé is firm data: another firm's must never reach the LLM or a job's scores, whether it comes in as
an explicit id, the company's selection, the platform-wide `default_resume_id`, or the all-résumés fallback."""
import pytest
from sqlalchemy.orm import sessionmaker

import backend.analyzer.cv_scorer as scorer
from backend.models.db import Company, Job, Resume, Setting
from backend.models.tenancy import DEFAULT_FIRM_ID, FirmJob
from backend.tests.auth_support import make_firm, make_plan

TEXT = {"summary": "Product manager with five years of experience shipping at scale."}


@pytest.fixture
def two_firms(test_db, accounts):
    """The signed-in firm ("acme", which is the Default firm's id) and "globex", each with one base résumé."""
    globex = make_firm(test_db, make_plan(test_db, name="Other plan"), slug="globex").id
    mine = Resume(firm_id=accounts.firm_id, name="Acme PM", is_base=True, json_data=TEXT)
    theirs = Resume(firm_id=globex, name="Globex secret", is_base=True, json_data=TEXT)
    test_db.add_all([mine, theirs])
    test_db.commit()
    return {"acme": accounts.firm_id, "globex": globex, "mine": mine, "theirs": theirs}


def test_the_all_resumes_fallback_is_the_firms_own(test_db, two_firms):
    assert list(scorer._get_resume_texts(test_db, two_firms["acme"])) == ["Acme PM"]
    assert list(scorer._get_resume_texts(test_db, two_firms["globex"])) == ["Globex secret"]


def test_a_default_resume_of_another_firm_is_ignored(test_db, two_firms):
    test_db.add(Setting(key="default_resume_id", value=str(two_firms["theirs"].id)))
    test_db.commit()
    assert scorer._get_default_resume(test_db, two_firms["acme"]) == {}
    assert list(scorer._get_default_resume(test_db, two_firms["globex"])) == ["Globex secret"]


def test_a_companys_selection_skips_another_firms_resume(test_db, two_firms):
    company = Company(name="Initech", selected_resume_ids=[str(two_firms["theirs"].id), str(two_firms["mine"].id)])
    test_db.add(company)
    test_db.commit()
    assert list(scorer._get_resume_texts_for_company(test_db, company, two_firms["acme"])) == ["Acme PM"]


def test_explicit_ids_of_another_firm_are_skipped(test_db, two_firms):
    ids = [str(two_firms["theirs"].id)]
    assert scorer._cv_texts_for_ids(test_db, ids, two_firms["acme"]) == {}
    assert scorer.resolve_score_resume_names(test_db, cv_ids=ids, firm_id=two_firms["acme"]) == []


@pytest.mark.asyncio
async def test_scoring_a_job_never_sends_another_firms_resume(test_db, two_firms, monkeypatch):
    monkeypatch.setattr(scorer, "SessionLocal", sessionmaker(bind=test_db.get_bind()))
    sent = []

    async def fake_score(job_obj, cv_texts, db=None, depth="full", preloaded_text=None):
        sent.append(sorted(cv_texts))
        return {"scores": {name: 70 for name in cv_texts}, "best_cv": next(iter(cv_texts))}

    monkeypatch.setattr(scorer, "score_job_sync", fake_score)
    job = Job(company="Initech", title="PM", url="https://initech.test/1", external_id="e-initech",
              description="A long job description for a product manager role. " * 5, status="new")
    test_db.add(job)
    test_db.commit()

    await scorer.score_single_job(str(job.id), firm_id=two_firms["acme"])
    assert sent == [["Acme PM"]]
    summary = await scorer.score_single_job(str(job.id), cv_ids=[str(two_firms["theirs"].id)], firm_id=two_firms["acme"])
    assert summary == "No resumes to score against" and len(sent) == 1


def test_analyze_names_only_the_firms_resumes(api_client, test_db, two_firms, monkeypatch):
    """POST /api/analyze with another firm's résumé id: the run is named for none of it."""
    job = Job(company="Initech", title="PM", url="https://initech.test/2", external_id="e-initech-2", status="new")
    test_db.add(job)
    test_db.flush()
    test_db.add(FirmJob(firm_id=two_firms["acme"], job_id=job.id, origin="CAPTURED"))
    test_db.commit()
    calls = []

    async def fake_score_single_job(job_id, cv_ids=None, depth="full", *, firm_id):
        calls.append(firm_id)
        return "ok"

    monkeypatch.setattr(scorer, "score_single_job", fake_score_single_job)
    resp = api_client.post(f"/api/analyze/{job.id}", json={"cv_ids": [str(two_firms["theirs"].id)]})
    assert resp.status_code == 202, resp.text
    from backend.models.db import JobRun
    test_db.expire_all()
    run = test_db.query(JobRun).filter(JobRun.target_job_id == job.id).one()
    assert (run.meta or {}).get("resume_names") == []


@pytest.mark.asyncio
async def test_the_pipeline_scores_only_the_default_firms_jobs(test_db, two_firms, monkeypatch):
    """The scheduler's pass has no signed-in firm: it scores the Default firm's jobs with its résumés, never a
    job only another firm has."""
    monkeypatch.setattr(scorer, "SessionLocal", sessionmaker(bind=test_db.get_bind()))
    scored = []

    async def fake_score(job_obj, cv_texts, db=None, depth="full", preloaded_text=None):
        scored.append((job_obj.title, sorted(cv_texts)))
        return {"scores": {name: 70 for name in cv_texts}, "best_cv": next(iter(cv_texts))}

    monkeypatch.setattr(scorer, "score_job_sync", fake_score)
    desc = "A long job description for a product manager role. " * 5
    ours = Job(company="A", title="Default firm job", url="https://a.test/1", external_id="e-a", description=desc,
               status="saved", saved=True)
    theirs = Job(company="B", title="Globex job", url="https://b.test/1", external_id="e-b", description=desc,
                 status="saved", saved=True)
    test_db.add_all([ours, theirs])
    test_db.flush()
    test_db.add_all([FirmJob(firm_id=DEFAULT_FIRM_ID, job_id=ours.id, origin="SCRAPED"),
                     FirmJob(firm_id=two_firms["globex"], job_id=theirs.id, origin="CAPTURED")])
    test_db.commit()

    await scorer.analyze_unscored_jobs(status="saved")
    assert scored == [("Default firm job", ["Acme PM"])]
