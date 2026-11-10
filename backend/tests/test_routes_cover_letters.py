"""Tests for /api/cover-letters — CRUD, templates, generate validation."""
import uuid
import pytest

from backend.models.db import Setting, Resume, Job
from backend.models.tenancy import DEFAULT_FIRM_ID
from backend.tests.resume_support import make_version

pytestmark = pytest.mark.usefixtures("jobs_in_default_firm")


def _seed_first_run(db):
    db.add(Setting(key="cover_letter_prompt", value="Voice {voice_instruction} Len {length_instruction} JD {job_description}"))
    db.commit()


def _make_resume(db, name="PM"):
    r = make_version(db, DEFAULT_FIRM_ID, name=name, full_name="Viktor", summary="PM.")
    db.commit()
    return r


def _make_job(db, description="We need a fintech PM with roadmapping skills."):
    j = Job(id=uuid.uuid4(), external_id=uuid.uuid4().hex, company="Acme",
            title="Senior PM", url="https://acme.com/jobs/1", status="saved",
            description=description)
    db.add(j)
    db.commit()
    return j


# ── CRUD ─────────────────────────────────────────────────────────────────────


def test_get_missing_404(api_client, test_db):
    _seed_first_run(test_db)
    assert api_client.get(f"/api/cover-letters/{uuid.uuid4()}").status_code == 404


# ── Templates ────────────────────────────────────────────────────────────────

def test_templates_endpoint(api_client, test_db):
    _seed_first_run(test_db)
    resp = api_client.get("/api/cover-letters/templates")
    assert resp.status_code == 200
    ids = {t["id"] for t in resp.json()}
    # tracked templates only — `garamond` is gitignored (licensed fonts), absent on fresh clones / CI
    assert {"garamond_alt", "inter", "traditional"} <= ids


# ── Generate validation ──────────────────────────────────────────────────────


# ── Tracer cross-owner sharing ───────────────────────────────────────────────


def test_base_resume_stub_uses_zero_prefix(test_db):
    """A base resume has no job_id to namespace the token; in a *_jobid style with an explicit stub, the token is '0{stub}'."""
    import uuid
    from backend.models.db import Setting, Resume, TracerLink
    from backend.api.render_shared import _rewrite_urls_with_tracers

    test_db.add(Setting(key="tracer_links_enabled", value="true"))
    test_db.add(Setting(key="tracer_links_base_url", value="https://t.example.com"))
    test_db.add(Setting(key="tracer_links_url_style", value="path_jobid"))
    resume = make_version(test_db, DEFAULT_FIRM_ID)
    test_db.commit()
    resume_header = {"header": {"name": "V", "contact_items": [{"text": "LinkedIn", "url": "linkedin.com/in/v", "stub": "li"}]}}

    result = _rewrite_urls_with_tracers(resume_header, str(resume.id), test_db)

    link = test_db.query(TracerLink).filter(TracerLink.resume_id == resume.id).first()
    assert link is not None
    assert link.token == "0li"
    assert result["header"]["contact_items"][0]["url"] == "https://t.example.com/cv/0li"


def test_base_resume_without_stub_stays_random(test_db):
    """No stub and no job short_id → fall back to a random token (not '0…'); it comes from
    `secrets.token_urlsafe(8)` since R4-T5-07, so ≥ 8 chars rather than the old 6."""
    import uuid
    from backend.models.db import Setting, Resume, TracerLink
    from backend.api.render_shared import _rewrite_urls_with_tracers

    test_db.add(Setting(key="tracer_links_enabled", value="true"))
    test_db.add(Setting(key="tracer_links_base_url", value="https://t.example.com"))
    test_db.add(Setting(key="tracer_links_url_style", value="path_jobid"))
    resume = make_version(test_db, DEFAULT_FIRM_ID)
    test_db.commit()
    resume_header = {"header": {"name": "V", "contact_items": [{"text": "Portfolio", "url": "example.com/v"}]}}

    _rewrite_urls_with_tracers(resume_header, str(resume.id), test_db)

    link = test_db.query(TracerLink).filter(TracerLink.resume_id == resume.id).first()
    assert link is not None
    assert len(link.token) >= 8
    assert link.token != "0li"        # not the deterministic 0{stub} shape


