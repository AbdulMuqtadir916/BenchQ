"""Round 4 · T5 regressions — template whitelist, auth throttle, analyze 404, tracer tokens.

Findings: R4-T5-01 (path traversal via the `template` field), R4-T5-06 (no rate limit on
the unauthenticated auth endpoints), R4-T5-07 (guessable tracer tokens), R4-T5-09 (a
well-formed but unknown job id 500s on the JobRun FK), R4-T5-12 (`https://` prefixed onto
`tel:`/`mailto:` contact values).
"""
import uuid

import pytest
from fastapi import HTTPException

from backend.api.render_shared import _is_traceable_url, _rewrite_urls_with_tracers, template_paths, validate_template_name
from backend.api.routes_cover_letters import TEMPLATES_DIR as CL_TEMPLATES_DIR
from backend.models.db import Setting, TracerLink
from backend.models.tenancy import DEFAULT_FIRM_ID
from backend.tests.resume_support import make_version

pytestmark = pytest.mark.usefixtures("default_firm")


# The résumé's own backend templates went in résumé versioning PR 6 (the studio's designs are BenchQ's); the
# whitelist still guards the cover-letter templates.


# ── R4-T5-01 · template name whitelist ───────────────────────────────────────

TRAVERSALS = [
    "../cover_letter_templates/garamond",
    "../../backend/resume_templates/inter",
    "../../../../etc",
    "/etc/passwd",
    "/etc",
    "..",
    ".",
    "./inter",
    "inter/../inter",
    "inter/",
    "\\..\\inter",
    "..%2f..%2fetc",          # a client that double-encodes gets the literal string
    "%2e%2e%2fgaramond",
    "Inter",                   # the folders are lowercase; no case-folding lookups
    "inter ",
    "",
    "in-ter",
]


@pytest.mark.parametrize("name", TRAVERSALS)
def test_template_name_rejects_anything_that_is_not_a_folder(name):
    with pytest.raises(HTTPException) as exc:
        validate_template_name(name, CL_TEMPLATES_DIR)
    assert exc.value.status_code == 422


@pytest.mark.parametrize("name", [None, 1, ["inter"], {"id": "inter"}])
def test_template_name_rejects_non_strings(name):
    with pytest.raises(HTTPException) as exc:
        validate_template_name(name, CL_TEMPLATES_DIR)
    assert exc.value.status_code == 422


def test_template_name_accepts_every_discovered_template():
    names = list(template_paths(CL_TEMPLATES_DIR))
    assert names
    for name in names:
        assert validate_template_name(name, CL_TEMPLATES_DIR) == name


def test_cover_letter_render_rejects_a_traversal(test_db):
    from backend.api.routes_cover_letters import _render_html as cl_render
    with pytest.raises(HTTPException) as exc:
        cl_render({}, "../resume_templates/inter", "letter")
    assert exc.value.status_code == 422


def test_patch_cover_letter_rejects_a_bad_template(api_client, test_db):
    from backend.models.db import CoverLetter
    cl = CoverLetter(firm_id=DEFAULT_FIRM_ID, name="CL", template="inter", page_format="letter", json_data={})
    test_db.add(cl)
    test_db.commit()
    resp = api_client.patch(f"/api/cover-letters/{cl.id}", json={"template": "../resume_templates/inter"})
    assert resp.status_code == 422


# ── R4-T5-09 · analyze a job that does not exist ─────────────────────────────

def test_analyze_unknown_job_id_is_404(api_client, test_db):
    resp = api_client.post(f"/api/analyze/{uuid.uuid4()}")
    assert resp.status_code == 404
    assert resp.json()["detail"]


def test_analyze_malformed_job_id_is_still_404(api_client, test_db):
    assert api_client.post("/api/analyze/not-a-uuid").status_code == 404


def test_analyze_writes_no_job_run_for_an_unknown_id(api_client, test_db):
    from backend.models.db import JobRun
    api_client.post(f"/api/analyze/{uuid.uuid4()}")
    assert test_db.query(JobRun).count() == 0


# ── R4-T5-07 / R4-T5-12 · tracer links ───────────────────────────────────────

@pytest.fixture
def tracer_on(test_db):
    test_db.add_all([
        Setting(key="tracer_links_enabled", value="true"),
        Setting(key="tracer_links_base_url", value="https://example.test"),
    ])
    test_db.commit()


def _rewrite(test_db, items):
    r = make_version(test_db, DEFAULT_FIRM_ID)
    test_db.commit()
    out = _rewrite_urls_with_tracers({"header": {"contact_items": items}}, str(r.id), test_db)
    return out["header"]["contact_items"]


@pytest.mark.parametrize("url", [
    "tel:+15551234567",
    "mailto:someone@example.com",
    "sms:+15551234567",
    "SMS:+15551234567",
    "skype:live.someone",
    "someone@gmail.com",
])
def test_non_web_contact_values_are_left_alone(test_db, tracer_on, url):
    items = _rewrite(test_db, [{"text": "Contact", "url": url}])
    assert items[0]["url"] == url
    assert test_db.query(TracerLink).count() == 0


@pytest.mark.parametrize("url", ["tel:+1555", "mailto:a@b.co", "sms:+1555", "a@b.co", "", "   "])
def test_is_traceable_url_says_no(url):
    assert _is_traceable_url(url) is False


@pytest.mark.parametrize("url", ["https://x.com", "http://x.com", "x.com", "linkedin.com/in/v"])
def test_is_traceable_url_says_yes(url):
    assert _is_traceable_url(url) is True


def test_a_web_url_still_gets_a_tracer(test_db, tracer_on):
    items = _rewrite(test_db, [{"text": "Site", "url": "viktoresadze.com"}])
    assert items[0]["url"].startswith("https://example.test/cv/")
    link = test_db.query(TracerLink).one()
    assert link.destination_url == "https://viktoresadze.com"


def test_random_tokens_are_long_and_unguessable(test_db, tracer_on):
    """No job → no deterministic short_id, so the token is the random fallback."""
    tokens = set()
    for i in range(5):
        items = _rewrite(test_db, [{"text": "Site", "url": f"site{i}.example"}])
        tokens.add(items[0]["url"].rsplit("/", 1)[-1])
    assert len(tokens) == 5
    for t in tokens:
        assert len(t) >= 8, t


def test_random_tokens_come_from_secrets(test_db, tracer_on, monkeypatch):
    """`random` (Mersenne Twister) must not be what stands behind a tracer token."""
    import random as _random
    def _boom(*a, **kw):
        raise AssertionError("tracer token drawn from random, not secrets")
    monkeypatch.setattr(_random, "choices", _boom)
    monkeypatch.setattr(_random, "choice", _boom)
    items = _rewrite(test_db, [{"text": "Site", "url": "site.example"}])
    assert items[0]["url"].startswith("https://example.test/cv/")
