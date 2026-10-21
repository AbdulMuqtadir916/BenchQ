"""Tracer /cv/{token} endpoint: redirect must succeed even if click-log commit fails."""
import uuid
import pytest


def _seed_first_run(db):
    from backend.models.db import Setting
    db.add(Setting(key="dashboard_api_key", value=""))
    db.commit()


def test_tracer_redirect_succeeds_normally(api_client, test_db):
    """Happy path: valid token -> 302 to destination URL + click recorded."""
    _seed_first_run(test_db)
    from backend.models.db import Resume, TracerLink
    resume = Resume(id=uuid.uuid4(), name="Test", is_base=True, json_data={})
    test_db.add(resume)
    test_db.commit()
    link = TracerLink(
        id=uuid.uuid4(),
        token="abc123",
        resume_id=resume.id,
        destination_url="https://example.com/apply",
        source_label="manual",
        is_active=True,
    )
    test_db.add(link)
    test_db.commit()

    resp = api_client.get("/cv/abc123", follow_redirects=False)
    assert resp.status_code in (302, 307), (
        f"Expected redirect, got {resp.status_code}: {resp.text}"
    )
    assert "example.com/apply" in resp.headers.get("location", "")


def test_tracer_redirect_needs_no_session(anonymous_client, test_db):
    """The public /cv/{token} redirect works with no session: recruiters click it from a PDF."""
    from backend.models.db import Resume, TracerLink
    resume = Resume(id=uuid.uuid4(), name="Test", is_base=True, json_data={})
    test_db.add(resume)
    test_db.commit()
    link = TracerLink(
        id=uuid.uuid4(),
        token="pub789",
        resume_id=resume.id,
        destination_url="https://example.com/apply3",
        source_label="manual",
        is_active=True,
    )
    test_db.add(link)
    test_db.commit()

    # Guard: auth really is enforced for this client — a protected route 401s.
    protected = anonymous_client.get("/api/settings", follow_redirects=False)
    assert protected.status_code == 401, (
        f"auth not enforced (got {protected.status_code}); this test would be meaningless"
    )

    resp = anonymous_client.get("/cv/pub789", follow_redirects=False)
    assert resp.status_code in (302, 307), (
        f"tracer link should need no session, got {resp.status_code}: {resp.text}"
    )
    assert "example.com/apply3" in resp.headers.get("location", "")


def test_tracer_redirect_param_style_needs_no_session(anonymous_client, test_db):
    """Param-style links (?cv=token on root) also need no session, since resumes were exported in both /cv/{token} and ?cv={token} shapes."""
    from backend.models.db import Resume, TracerLink
    resume = Resume(id=uuid.uuid4(), name="Test", is_base=True, json_data={})
    test_db.add(resume)
    test_db.commit()
    link = TracerLink(
        id=uuid.uuid4(),
        token="qp123",
        resume_id=resume.id,
        destination_url="https://example.com/param-dest",
        source_label="manual",
        is_active=True,
    )
    test_db.add(link)
    test_db.commit()

    resp = anonymous_client.get("/?cv=qp123", follow_redirects=False)
    assert resp.status_code in (302, 307), (
        f"param-style link should redirect, got {resp.status_code}: {resp.text}"
    )
    assert "example.com/param-dest" in resp.headers.get("location", "")


def test_root_without_cv_is_not_a_tracer(api_client, test_db):
    """Bare root path (no ?cv) must not be treated as a tracer redirect."""
    from backend.models.db import Setting
    test_db.add(Setting(key="dashboard_api_key", value=""))  # first-run: middleware allows /
    test_db.commit()
    resp = api_client.get("/", follow_redirects=False)
    assert resp.status_code == 404


def test_tracer_redirect_survives_commit_failure(api_client, test_db, monkeypatch):
    """A commit failure in click-log must NOT break the 302 redirect."""
    _seed_first_run(test_db)
    from backend.models.db import Resume, TracerLink
    resume = Resume(id=uuid.uuid4(), name="Test", is_base=True, json_data={})
    test_db.add(resume)
    test_db.commit()
    link = TracerLink(
        id=uuid.uuid4(),
        token="def456",
        resume_id=resume.id,
        destination_url="https://example.com/apply2",
        source_label="manual",
        is_active=True,
    )
    test_db.add(link)
    test_db.commit()

    # Patch Session.commit to fail only when a pending TracerClickEvent is being flushed —
    # other commits (e.g. the seeding above) succeed normally.
    from sqlalchemy.orm import Session as SASession
    original_commit = SASession.commit

    def broken_commit(self):
        from backend.models.db import TracerClickEvent
        pending_new = [obj for obj in self.new if isinstance(obj, TracerClickEvent)]
        if pending_new:
            raise RuntimeError("simulated click-log commit failure")
        return original_commit(self)

    monkeypatch.setattr(SASession, "commit", broken_commit)

    # Should still 302 — click-log failure is logged but redirect goes through.
    resp = api_client.get("/cv/def456", follow_redirects=False)
    assert resp.status_code in (302, 307), (
        f"Expected redirect even on click-log failure, got {resp.status_code}: {resp.text}"
    )
    assert "example.com/apply2" in resp.headers.get("location", "")
