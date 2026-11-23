"""The shared AI key at rest: Fernet with `AI_SETTINGS_ENCRYPTION_KEY`, a server secret of its own (comma-separated,
newest first, so a rotation can still read the previous key). Errors never carry the key or the secret."""
import os

from cryptography.fernet import Fernet, InvalidToken, MultiFernet

import backend.config  # noqa: F401  (loads backend/.env)

SECRET_NAME = "AI_SETTINGS_ENCRYPTION_KEY"


class AiSecretError(RuntimeError):
    """The server secret is missing or wrong."""


def _fernet() -> MultiFernet:
    keys = [key.strip() for key in os.getenv(SECRET_NAME, "").split(",") if key.strip()]
    if not keys:
        raise AiSecretError(f"{SECRET_NAME} is not set")
    try:
        return MultiFernet([Fernet(key.encode("ascii")) for key in keys])
    except (ValueError, UnicodeEncodeError):
        raise AiSecretError(f"{SECRET_NAME} is not a valid Fernet key") from None


def require_secret() -> None:
    _fernet()


def encrypt_key(value: str) -> bytes:
    return _fernet().encrypt(value.encode("utf-8"))


def decrypt_key(value: bytes) -> str:
    try:
        return _fernet().decrypt(bytes(value)).decode("utf-8")
    except InvalidToken:
        raise AiSecretError(f"{SECRET_NAME} can't read the stored API key") from None
