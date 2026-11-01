"""Candidate OAuth starts with Google-hosted sign-in and requests Gmail read-only access."""
from urllib.parse import parse_qs, urlparse

import pytest


def test_authorization_url_requests_readonly_and_pkce(monkeypatch):
    from backend.inbox.google_oauth import build_authorization

    monkeypatch.setattr("backend.inbox.google_oauth.CANDIDATE_GMAIL_CLIENT_ID", "client-id")
    monkeypatch.setattr("backend.inbox.google_oauth.CANDIDATE_GMAIL_REDIRECT_URI", "http://localhost/callback")
    result = build_authorization()
    params = parse_qs(urlparse(result.url).query)
    assert params["scope"] == ["openid email https://www.googleapis.com/auth/gmail.readonly"]
    assert params["access_type"] == ["offline"]
    assert params["prompt"] == ["consent"]
    assert params["code_challenge_method"] == ["S256"]
    assert params["code_challenge"] == [result.challenge]
    assert params["state"] == [result.state]
    assert len(result.verifier) >= 43


@pytest.mark.parametrize("return_to", ["https://attacker.test/", "//attacker.test", "/\\attacker.test", "javascript:alert(1)"])
def test_oauth_return_target_rejects_external_redirects(return_to):
    from backend.inbox.google_oauth import validate_return_to

    with pytest.raises(ValueError):
        validate_return_to(return_to)


def test_oauth_return_target_accepts_local_candidate_inbox_path():
    from backend.inbox.google_oauth import validate_return_to

    assert validate_return_to("/adnan-staffing/candidates/123?tab=inbox") == "/adnan-staffing/candidates/123?tab=inbox"
