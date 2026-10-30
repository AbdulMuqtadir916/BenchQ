"""Rate limits on the public auth routes (07-auth §2), in memory: sign-in failures per client IP and per email, and
invite acceptance attempts per client IP.

In-memory is right for the one backend worker the deployment runs (docs/integration/07); shared state in
Postgres or Redis comes with a second worker. A restart forgives everything, which is fine.
"""
import logging
import time

from fastapi import HTTPException, Request

from backend.config import TRUSTED_PROXY_HOPS

logger = logging.getLogger("jobnavigator")

# (attempts allowed, window in seconds). Per IP stops one client guessing many accounts; per email stops
# many clients guessing one account. A locked email unlocks itself after the window.
IP_LIMIT = (10, 60.0)
EMAIL_LIMIT = (5, 15 * 60.0)
# Every accept attempt counts, not just failures. An invite's token can't be guessed, so this only stops a
# client hammering the route; it is loose enough for an office of new BDEs accepting from one address.
INVITE_ACCEPT_LIMIT = (20, 15 * 60.0)

TOO_MANY = "Too many attempts. Try again in a few minutes."

_hits: dict[str, list[float]] = {}


def client_ip(request: Request) -> str:
    """Caller IP. Behind the proxy every request has the proxy's address as the peer, so use the forwarded
    address; otherwise one client would lock out everyone. Only the entries our own proxies appended (the
    rightmost TRUSTED_PROXY_HOPS) are believed: a client can put anything at the left of the header."""
    entries = [e.strip() for e in request.headers.get("x-forwarded-for", "").split(",") if e.strip()]
    if TRUSTED_PROXY_HOPS and entries:
        return entries[max(0, len(entries) - TRUSTED_PROXY_HOPS)]
    return request.client.host if request.client else "unknown"


def _recent(key: str, window: float, now: float) -> list[float]:
    hits = [t for t in _hits.get(key, []) if now - t < window]
    if hits:
        _hits[key] = hits
    else:
        _hits.pop(key, None)
    return hits


def _refuse_if_over(key: str, limit: tuple[int, float], now: float) -> None:
    """Raise 429 with Retry-After while `key` has used its budget in the window."""
    allowed, window = limit
    hits = _recent(key, window, now)
    if len(hits) >= allowed:
        retry_after = max(1, int(window - (now - hits[0])) + 1)
        logger.warning("auth throttle: %s locked for %ss", key.split(":")[0], retry_after)
        raise HTTPException(status_code=429, detail=TOO_MANY, headers={"Retry-After": str(retry_after)})


def _sign_in_buckets(request: Request, email: str) -> list[tuple[str, tuple[int, float]]]:
    return [(f"ip:{client_ip(request)}", IP_LIMIT), (f"email:{email}", EMAIL_LIMIT)]


def check(request: Request, email: str) -> None:
    """Sign-in: raise 429 with Retry-After while the IP or the email is over its failure budget."""
    now = time.monotonic()
    for key, limit in _sign_in_buckets(request, email):
        _refuse_if_over(key, limit, now)


def record_failure(request: Request, email: str) -> None:
    now = time.monotonic()
    for key, _ in _sign_in_buckets(request, email):
        _hits.setdefault(key, []).append(now)


def clear(request: Request, email: str) -> None:
    for key, _ in _sign_in_buckets(request, email):
        _hits.pop(key, None)


def check_invite_accept(request: Request) -> None:
    """Invite acceptance: count this attempt, or raise 429 with Retry-After when the IP is over its budget.
    A refused attempt isn't counted, so waiting out Retry-After is enough."""
    now = time.monotonic()
    key = f"invite-ip:{client_ip(request)}"
    _refuse_if_over(key, INVITE_ACCEPT_LIMIT, now)
    _hits.setdefault(key, []).append(now)


def reset() -> None:
    """Forget every attempt (tests, and a manual unlock)."""
    _hits.clear()
