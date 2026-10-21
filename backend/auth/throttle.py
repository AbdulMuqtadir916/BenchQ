"""Sign-in throttle (07-auth §2): failures counted per client IP and per email, in memory.

In-memory is right for the one backend worker the deployment runs (docs/integration/07); shared state in
Postgres or Redis comes with a second worker. A restart forgives everything, which is fine.
"""
import logging
import time

from fastapi import HTTPException, Request

logger = logging.getLogger("jobnavigator")

# (failures allowed, window in seconds). Per IP stops one client guessing many accounts; per email stops
# many clients guessing one account. A locked email unlocks itself after the window.
IP_LIMIT = (10, 60.0)
EMAIL_LIMIT = (5, 15 * 60.0)

_failures: dict[str, list[float]] = {}


def client_ip(request: Request) -> str:
    """Caller IP. Behind the proxy every request has the proxy's address as the peer, so prefer the
    forwarded client address; otherwise one client would lock out everyone."""
    fwd = request.headers.get("x-forwarded-for", "")
    first = fwd.split(",")[0].strip() if fwd else ""
    return first or (request.client.host if request.client else "unknown")


def _buckets(request: Request, email: str) -> list[tuple[str, tuple[int, float]]]:
    return [(f"ip:{client_ip(request)}", IP_LIMIT), (f"email:{email}", EMAIL_LIMIT)]


def check(request: Request, email: str) -> None:
    """Raise 429 with Retry-After while the IP or the email is over its failure budget."""
    now = time.monotonic()
    for key, (limit, window) in _buckets(request, email):
        hits = [t for t in _failures.get(key, []) if now - t < window]
        if hits:
            _failures[key] = hits
        else:
            _failures.pop(key, None)
        if len(hits) >= limit:
            retry_after = max(1, int(window - (now - hits[0])) + 1)
            logger.warning("sign-in throttle: %s locked for %ss", key.split(":")[0], retry_after)
            raise HTTPException(status_code=429, detail="Too many attempts. Try again in a few minutes.",
                                headers={"Retry-After": str(retry_after)})


def record_failure(request: Request, email: str) -> None:
    now = time.monotonic()
    for key, _ in _buckets(request, email):
        _failures.setdefault(key, []).append(now)


def clear(request: Request, email: str) -> None:
    for key, _ in _buckets(request, email):
        _failures.pop(key, None)


def reset() -> None:
    """Forget every failure (tests, and a manual unlock)."""
    _failures.clear()
