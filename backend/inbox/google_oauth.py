"""Google OAuth helpers for candidate-scoped, read-only Gmail access."""
from __future__ import annotations

import base64
import hashlib
import secrets
from dataclasses import dataclass
from urllib.parse import urlencode, urlsplit

import httpx
from cryptography.fernet import Fernet, InvalidToken

from backend.config import (CANDIDATE_GMAIL_CLIENT_ID, CANDIDATE_GMAIL_CLIENT_SECRET,
                            CANDIDATE_GMAIL_ENCRYPTION_KEY, CANDIDATE_GMAIL_REDIRECT_URI)

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"
GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly"


@dataclass(frozen=True)
class Authorization:
    url: str
    state: str
    verifier: str
    challenge: str


def build_authorization() -> Authorization:
    if not CANDIDATE_GMAIL_CLIENT_ID or not CANDIDATE_GMAIL_REDIRECT_URI:
        raise RuntimeError("Candidate Gmail OAuth is not configured.")
    state = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(64)
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    query = urlencode({
        "client_id": CANDIDATE_GMAIL_CLIENT_ID,
        "redirect_uri": CANDIDATE_GMAIL_REDIRECT_URI,
        "response_type": "code",
        "scope": f"openid email {GMAIL_READONLY_SCOPE}",
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    })
    return Authorization(f"{GOOGLE_AUTH_URL}?{query}", state, verifier, challenge)


def validate_return_to(value: str) -> str:
    """Accept only a same-origin absolute path; never persist an OAuth open redirect."""
    if not value or len(value) > 500 or "\\" in value or value.startswith("//"):
        raise ValueError("Invalid local return path.")
    parsed = urlsplit(value)
    if parsed.scheme or parsed.netloc or not parsed.path.startswith("/") or parsed.fragment:
        raise ValueError("Invalid local return path.")
    return value


def _fernet() -> Fernet:
    if not CANDIDATE_GMAIL_ENCRYPTION_KEY:
        raise RuntimeError("Candidate Gmail encryption is not configured.")
    try:
        return Fernet(CANDIDATE_GMAIL_ENCRYPTION_KEY.encode("ascii"))
    except (ValueError, UnicodeEncodeError) as exc:
        raise RuntimeError("Candidate Gmail encryption key is invalid.") from exc


def encrypt_secret(value: str) -> bytes:
    return _fernet().encrypt(value.encode("utf-8"))


def decrypt_secret(value: bytes) -> str:
    try:
        return _fernet().decrypt(value).decode("utf-8")
    except (InvalidToken, UnicodeDecodeError) as exc:
        raise RuntimeError("Stored candidate Gmail credential cannot be decrypted.") from exc


def state_digest(state: str) -> str:
    return hashlib.sha256(state.encode("utf-8")).hexdigest()


def exchange_code(code: str, verifier: str, *, client: httpx.Client | None = None) -> tuple[str, str]:
    """Exchange the one-time code and verify the Google identity over the authenticated userinfo endpoint."""
    if not CANDIDATE_GMAIL_CLIENT_ID or not CANDIDATE_GMAIL_CLIENT_SECRET or not CANDIDATE_GMAIL_REDIRECT_URI:
        raise RuntimeError("Candidate Gmail OAuth is not configured.")
    own_client = client is None
    http = client or httpx.Client(timeout=20.0, follow_redirects=False)
    try:
        response = http.post(GOOGLE_TOKEN_URL, data={
            "code": code,
            "client_id": CANDIDATE_GMAIL_CLIENT_ID,
            "client_secret": CANDIDATE_GMAIL_CLIENT_SECRET,
            "redirect_uri": CANDIDATE_GMAIL_REDIRECT_URI,
            "grant_type": "authorization_code",
            "code_verifier": verifier,
        })
        if response.status_code >= 400:
            raise RuntimeError("Google rejected the authorization code.")
        tokens = response.json()
        access_token = tokens.get("access_token")
        refresh_token = tokens.get("refresh_token")
        if not isinstance(access_token, str) or not isinstance(refresh_token, str):
            raise RuntimeError("Google did not return the required offline access token.")
        identity = http.get(GOOGLE_USERINFO_URL, headers={"Authorization": f"Bearer {access_token}"})
        identity.raise_for_status()
        profile = identity.json()
        if not profile.get("email_verified") or not isinstance(profile.get("email"), str):
            raise RuntimeError("Google did not verify the authorized email address.")
        return profile["email"].strip().lower(), refresh_token
    except (httpx.HTTPError, ValueError, TypeError) as exc:
        raise RuntimeError("Google OAuth could not be completed.") from exc
    finally:
        if own_client:
            http.close()
