"""Password hashing: Argon2id with argon2-cffi's defaults (Q37). `needs_rehash` lets the cost rise later."""
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

MIN_PASSWORD_LENGTH = 8

_hasher = PasswordHasher()

# Verifying against this when the email is unknown keeps sign-in's timing the same for unknown accounts.
_DUMMY_HASH = _hasher.hash("benchq-timing-equaliser")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    try:
        return _hasher.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def needs_rehash(password_hash: str) -> bool:
    return _hasher.check_needs_rehash(password_hash)
