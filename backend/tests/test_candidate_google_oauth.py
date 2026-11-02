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


def test_credential_encryption_roundtrip_and_wrong_key(monkeypatch):
    from cryptography.fernet import Fernet
    from backend.inbox import google_oauth
    monkeypatch.setattr(google_oauth, 'CANDIDATE_GMAIL_ENCRYPTION_KEY', Fernet.generate_key().decode())
    encrypted = google_oauth.encrypt_secret('synthetic-refresh')
    assert b'synthetic-refresh' not in encrypted
    assert google_oauth.decrypt_secret(encrypted) == 'synthetic-refresh'
    monkeypatch.setattr(google_oauth, 'CANDIDATE_GMAIL_ENCRYPTION_KEY', Fernet.generate_key().decode())
    with pytest.raises(RuntimeError, match='cannot be decrypted'):
        google_oauth.decrypt_secret(encrypted)


def test_rotation_decrypts_old_ciphertext_and_writes_with_new_key(monkeypatch):
    from cryptography.fernet import Fernet
    from backend.inbox import google_oauth as oauth
    old, new = Fernet.generate_key(), Fernet.generate_key()
    ciphertext = Fernet(old).encrypt(b'private synthetic text')
    monkeypatch.setattr(oauth, 'CANDIDATE_GMAIL_ENCRYPTION_KEY', new.decode() + ',' + old.decode())
    assert oauth.decrypt_secret(ciphertext) == 'private synthetic text'
    assert Fernet(new).decrypt(oauth.encrypt_secret('new synthetic text')) == b'new synthetic text'


def test_revoke_is_bounded_and_reports_provider_failure():
    from backend.inbox.google_oauth import revoke_token
    class Client:
        def post(self, url, data):
            assert url == 'https://oauth2.googleapis.com/revoke'
            assert data == {'token': 'synthetic'}
            return type('Response', (), {'status_code': 503})()
    assert revoke_token('synthetic', client=Client()) is False


def test_identity_failure_preserves_issued_grant_for_cleanup(monkeypatch):
    import httpx
    from backend.inbox import google_oauth as oauth
    monkeypatch.setattr(oauth, 'CANDIDATE_GMAIL_CLIENT_ID', 'synthetic-client')
    monkeypatch.setattr(oauth, 'CANDIDATE_GMAIL_CLIENT_SECRET', 'synthetic-secret')
    monkeypatch.setattr(oauth, 'CANDIDATE_GMAIL_REDIRECT_URI', 'http://localhost/callback')
    def provider(request):
        if request.method == 'POST':
            return httpx.Response(200, json={'access_token':'synthetic-access', 'refresh_token':'issued-synthetic-grant'})
        return httpx.Response(503)
    with httpx.Client(transport=httpx.MockTransport(provider)) as client:
        with pytest.raises(oauth.OAuthGrantError) as error:
            oauth.exchange_code('synthetic-code', 'verifier', client=client)
    assert error.value.token == 'issued-synthetic-grant'
    assert 'issued-synthetic-grant' not in str(error.value)
