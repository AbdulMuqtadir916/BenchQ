"""Opaque secrets for session cookies and invite links. Only their SHA-256 is ever stored (Q37)."""
import hashlib
import secrets


def new_token() -> str:
    """256 random bits, URL-safe (43 characters)."""
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()
