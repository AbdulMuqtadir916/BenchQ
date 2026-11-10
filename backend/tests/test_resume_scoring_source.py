"""Résumé scoring reads each candidate's active base from the versions (docs/team/resume-versioning.md §4.8)."""
import pytest

from backend.models.tenancy import DEFAULT_FIRM_ID
from backend.tests.resume_support import make_posting, make_version

pytestmark = pytest.mark.usefixtures("default_firm")


def _seed_resume(test_db, name, summary, **over):
    """A candidate called `name` whose active base v1 has `summary` and one role."""
    row = make_version(test_db, DEFAULT_FIRM_ID, full_name=name, summary=summary,
                       experiences=[{"id": f"{name}-e", "company": "Acme", "job_title": f"{name} Lead",
                                     "bullets": [{"id": f"{name}-b", "text": f"shipped {name} platform"}]}],
                       skills=[{"id": f"{name}-s", "category": "core", "name": "Python"}], **over)
    test_db.commit()
    return row


def test_get_resume_texts_returns_dict_keyed_by_candidate(test_db):
    from backend.analyzer.cv_scorer import _get_resume_texts
    _seed_resume(test_db, "PM", "Product manager focused on fintech")
    _seed_resume(test_db, "TPgM", "Technical program manager")

    texts = _get_resume_texts(test_db, DEFAULT_FIRM_ID)
    assert set(texts.keys()) == {"PM", "TPgM"}
    assert "Product manager" in texts["PM"]
    assert "Technical program" in texts["TPgM"]


def test_get_resume_texts_skips_tailored_and_later_versions(test_db):
    """Only the workflow résumé (the active base's v1) is scored: not a tailored résumé, not an unpicked edit."""
    from backend.analyzer.cv_scorer import _get_resume_texts
    from backend.models.candidates import Candidate
    base = _seed_resume(test_db, "PM", "summary")
    candidate = test_db.get(Candidate, base.candidate_id)
    job = make_posting(test_db, DEFAULT_FIRM_ID, candidate.id, candidate.created_by_user_id)   # 0023: a posting
    make_version(test_db, DEFAULT_FIRM_ID, candidate=candidate, category="TAILORED", job_id=job.id, summary="tailored")
    make_version(test_db, DEFAULT_FIRM_ID, candidate=candidate, version=2, summary="an edit")
    test_db.commit()

    texts = _get_resume_texts(test_db, DEFAULT_FIRM_ID)
    assert list(texts.keys()) == ["PM"]
    assert "tailored" not in texts["PM"] and "an edit" not in texts["PM"]
