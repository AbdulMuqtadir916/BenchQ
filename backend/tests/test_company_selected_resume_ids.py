"""Company.selected_resume_ids replaces selected_cv_ids (Task 6)."""
import uuid
from backend.models.db import Company
import pytest
from backend.models.tenancy import DEFAULT_FIRM_ID
from backend.tests.resume_support import make_version

pytestmark = pytest.mark.usefixtures("default_firm")


def test_company_has_selected_resume_ids_column():
    cols = {c.name for c in Company.__table__.columns}
    assert "selected_resume_ids" in cols
    assert "selected_cv_ids" not in cols  # renamed, not duplicated


def test_company_default_is_empty_list(test_db):
    co = Company(name="Acme", scrape_urls=[], aliases=[], active=True, playwright_enabled=True)
    test_db.add(co)
    test_db.commit()
    assert co.selected_resume_ids in ([], None)


def test_get_resume_texts_for_company_uses_selected_ids(test_db):
    """When the column names base versions, only those are scored, labelled with their candidate."""
    from backend.analyzer.cv_scorer import _get_resume_texts_for_company
    pm = make_version(test_db, DEFAULT_FIRM_ID, full_name="PM", summary="PM summary")
    make_version(test_db, DEFAULT_FIRM_ID, full_name="Other", summary="Other summary")
    co = Company(name="Acme", scrape_urls=[], aliases=[],
                 selected_resume_ids=[str(pm.id)],
                 active=True, playwright_enabled=True)
    test_db.add(co)
    test_db.commit()

    texts = _get_resume_texts_for_company(test_db, co, DEFAULT_FIRM_ID)
    assert list(texts.keys()) == ["PM"]
