"""LinkedIn's pace, one for the whole backend (decided 2026-11-16, Q76, Q81, Q82, Q85, Q86; migration 0029).

LinkedIn limits by IP address, and every firm's requests leave from one backend. Measured live on 2026-11-16 (8 and
10 rounds of 4 requests): about 16 requests in 25 s, then refusals (429) that clear within 7 s. So every request to
LinkedIn, a search page or a job's posting, takes one of `SLOTS` slots:

- at most `SLOTS` (4) requests at a time, for every firm together;
- a slot given back stays busy `GAP_SECONDS` (5 s): the gap between rounds;
- a refused request (429) is sent again after `RETRY_SECONDS` (7 s), holding its slot, at most `TRIES` (3) times;
- who waits goes in this order: opens (someone is looking at a job) before searches; then firms take turns (each
  firm's first waiting request, then each one's second, ...); then first come.

The state is in Postgres (`linkedin_slots`, `linkedin_waiting`) so every backend process keeps one pace (Q82). Taking a
slot is one short transaction under an advisory lock; a waiter polls every `POLL_SECONDS` and refreshes its row, and
a row nobody refreshed for `STALE_SECONDS` (a process that died) is dropped. A taken slot is held at most
`HOLD_SECONDS`, so a holder that died frees it then. Blocking: callers run it in a worker thread, never on the event
loop. Logs carry codes, counts and timings, never a URL, a query or a place.
"""
import logging
import time
import uuid
from contextlib import contextmanager

from sqlalchemy import text

from backend.models.db import SessionLocal

logger = logging.getLogger("benchq.job_search")

SLOTS = 4
GAP_SECONDS = 5.0
RETRY_SECONDS = 7.0
TRIES = 3
POLL_SECONDS = 0.25
STALE_SECONDS = 30
HOLD_SECONDS = 90             # longer than one request's every try: 3 × 10 s + 2 × 7 s
REQUEST_TIMEOUT_SECONDS = 10.0
MAX_BYTES = 5 * 1024 * 1024
_LOCK = 2026_11_16_29         # the take transaction's advisory lock (any constant every process agrees on)
KINDS = ("open", "search")

# Waiting order: opens first, then each firm's n-th waiting request (firms take turns), then first come.
_POSITION = text("""
    SELECT pos FROM (
        SELECT id, row_number() OVER (ORDER BY CASE kind WHEN 'open' THEN 0 ELSE 1 END, firm_turn, created_at, id) AS pos
        FROM (SELECT id, kind, created_at,
                     row_number() OVER (PARTITION BY kind, firm_id ORDER BY created_at, id) AS firm_turn
              FROM linkedin_waiting) AS w
    ) AS ranked WHERE id = :ticket
""")


class Busy(Exception):
    """No slot came free before the caller's deadline."""


def _take(ticket: uuid.UUID) -> int | None:
    """The slot this ticket may have now, taken; None while it must wait."""
    with SessionLocal() as db:
        db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": _LOCK})
        # The 4 rows the migration made; put back if they ever went (a test database is emptied between tests).
        db.execute(text("INSERT INTO linkedin_slots (slot) SELECT generate_series(0, :last) ON CONFLICT DO NOTHING"),
                   {"last": SLOTS - 1})
        db.execute(text("DELETE FROM linkedin_waiting WHERE seen_at < now() - make_interval(secs => :stale)"),
                   {"stale": STALE_SECONDS})
        db.execute(text("UPDATE linkedin_waiting SET seen_at = now() WHERE id = :ticket"), {"ticket": ticket})
        position = db.execute(_POSITION, {"ticket": ticket}).scalar()
        free = db.execute(text("SELECT slot FROM linkedin_slots WHERE busy_until <= now() ORDER BY slot")).scalars().all()
        if position is None or position > len(free):
            db.commit()
            return None
        slot = free[0]
        db.execute(text("UPDATE linkedin_slots SET busy_until = now() + make_interval(secs => :hold), holder = :ticket "
                        "WHERE slot = :slot"), {"hold": HOLD_SECONDS, "ticket": ticket, "slot": slot})
        db.execute(text("DELETE FROM linkedin_waiting WHERE id = :ticket"), {"ticket": ticket})
        db.commit()
        return slot


@contextmanager
def slot(kind: str, firm_id, deadline: float):
    """Hold one LinkedIn slot for the block; raises `Busy` when none comes free before `deadline` (time.monotonic()).
    Given back on leaving: busy for `GAP_SECONDS` more."""
    if kind not in KINDS:
        raise ValueError(f"unknown LinkedIn request kind {kind!r}")
    ticket = uuid.uuid4()
    with SessionLocal() as db:
        db.execute(text("INSERT INTO linkedin_waiting (id, kind, firm_id) VALUES (:id, :kind, :firm)"),
                   {"id": ticket, "kind": kind, "firm": firm_id})
        db.commit()
    taken = None
    started = time.monotonic()
    try:
        while taken is None:
            taken = _take(ticket)
            if taken is None:
                if time.monotonic() >= deadline:
                    logger.warning("linkedin queue kind=%s code=busy waited_ms=%d", kind,
                                   (time.monotonic() - started) * 1000)
                    raise Busy()
                time.sleep(POLL_SECONDS)
        yield taken
    finally:
        with SessionLocal() as db:
            db.execute(text("DELETE FROM linkedin_waiting WHERE id = :ticket"), {"ticket": ticket})
            if taken is not None:
                db.execute(text("UPDATE linkedin_slots SET busy_until = now() + make_interval(secs => :gap), "
                                "holder = NULL WHERE slot = :slot AND holder = :ticket"),
                           {"gap": GAP_SECONDS, "slot": taken, "ticket": ticket})
            db.commit()


def _send(url: str, params: dict | None, headers: dict) -> tuple[int, str]:
    """One GET: (status, body). Redirects aren't followed (a sign-in wall is a refusal); the body is capped."""
    import requests
    with requests.get(url, params=params, headers=headers, timeout=REQUEST_TIMEOUT_SECONDS, allow_redirects=False,
                      stream=True, verify=True) as resp:
        raw = bytearray()
        for chunk in resp.iter_content(64 * 1024):
            raw.extend(chunk)
            if len(raw) > MAX_BYTES:
                return 413, ""
        return resp.status_code, raw.decode(resp.encoding or "utf-8", errors="replace")


def get(url: str, params: dict | None, headers: dict, *, kind: str, firm_id, deadline: float) -> tuple[int, str]:
    """GET `url` from LinkedIn in turn: one slot, a 429 sent again after `RETRY_SECONDS` while holding it, at most
    `TRIES` times. Returns the last (status, body); raises `Busy` when no slot came before `deadline`, and the
    request's own error (a timeout, a dropped connection) as it is."""
    with slot(kind, firm_id, deadline):
        for attempt in range(1, TRIES + 1):
            started = time.monotonic()
            status, body = _send(url, params, headers)
            logger.info("linkedin request kind=%s attempt=%d status=%s ms=%d", kind, attempt, status,
                        (time.monotonic() - started) * 1000)
            if status != 429 or attempt == TRIES:
                return status, body
            time.sleep(RETRY_SECONDS)
    return 429, ""          # unreachable: the loop returns
