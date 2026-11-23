"""LinkedIn's pace, one for the whole backend (backend/job_search/linkedin_queue.py; decided 2026-11-16, Q76, Q81, Q82,
Q85, Q86): at most 4 requests at a time for every firm together, a slot given back stays busy for the gap, a 429 is
sent again after the retry wait (at most 3 tries), opens go before searches, firms take turns, and a waiter that
can't get a slot in time gives up. No network: the request itself is faked."""
import threading
import time
import uuid

import pytest
from sqlalchemy import text

from backend.job_search import linkedin_queue as queue
from backend.models.db import SessionLocal
from backend.tests.auth_support import make_firm, make_plan


@pytest.fixture
def firms(test_db):
    plan = make_plan(test_db)
    a, b = make_firm(test_db, plan, slug="firm-a"), make_firm(test_db, plan, slug="firm-b")
    test_db.commit()
    return a.id, b.id


@pytest.fixture
def quick(monkeypatch):
    monkeypatch.setattr(queue, "GAP_SECONDS", 1.0)
    monkeypatch.setattr(queue, "RETRY_SECONDS", 0.05)
    monkeypatch.setattr(queue, "POLL_SECONDS", 0.02)


def _wait(kind, firm_id, created_ago: float = 0) -> uuid.UUID:
    """A waiting request, as `slot()` writes it, `created_ago` seconds old."""
    ticket = uuid.uuid4()
    with SessionLocal() as db:
        db.execute(text("INSERT INTO linkedin_waiting (id, kind, firm_id, created_at) "
                        "VALUES (:id, :kind, :firm, now() - make_interval(secs => :ago))"),
                   {"id": ticket, "kind": kind, "firm": firm_id, "ago": created_ago})
        db.commit()
    return ticket


def _busy(slots):
    """Make these slots busy for a minute (held by someone else)."""
    with SessionLocal() as db:
        db.execute(text("INSERT INTO linkedin_slots (slot) SELECT generate_series(0, 3) ON CONFLICT DO NOTHING"))
        db.execute(text("UPDATE linkedin_slots SET busy_until = now() + interval '1 minute' WHERE slot = ANY(:s)"),
                   {"s": list(slots)})
        db.commit()


def test_at_most_four_at_once_for_every_firm_together(firms, quick):
    a, b = firms
    held, release = [], threading.Event()

    def hold(firm):
        with queue.slot("search", firm, time.monotonic() + 5):
            held.append(firm)
            release.wait(5)
    threads = [threading.Thread(target=hold, args=(a if n % 2 else b,)) for n in range(4)]
    for t in threads:
        t.start()
    deadline = time.monotonic() + 5
    while len(held) < 4 and time.monotonic() < deadline:
        time.sleep(0.02)
    assert len(held) == 4
    with pytest.raises(queue.Busy):                                    # a fifth waits, and gives up at its deadline
        with queue.slot("open", a, time.monotonic() + 0.3):
            pass
    release.set()
    for t in threads:
        t.join()


def test_a_slot_given_back_stays_busy_for_the_gap(firms, quick):
    a, _ = firms
    _busy([1, 2, 3])
    with queue.slot("search", a, time.monotonic() + 2) as first:
        assert first == 0
    started = time.monotonic()
    with queue.slot("search", a, time.monotonic() + 3):
        waited = time.monotonic() - started
    assert waited >= 0.8                                              # the 1 s gap (5 s in production)


def test_opens_go_before_searches(firms):
    a, _ = firms
    _busy([1, 2, 3])                                                  # one slot free
    search = _wait("search", a, created_ago=5)
    open_ = _wait("open", a)
    assert queue._take(search) is None                                # an open waits: it goes first
    assert queue._take(open_) == 0


def test_firms_take_turns(firms):
    a, b = firms
    _busy([2, 3])                                                     # two slots free
    a1, a2 = _wait("search", a, created_ago=9), _wait("search", a, created_ago=8)
    b1 = _wait("search", b, created_ago=1)
    assert queue._take(a2) is None                                    # firm A's second waits behind firm B's first
    assert queue._take(b1) is not None and queue._take(a1) is not None


def test_a_waiter_nobody_refreshed_is_dropped(firms, monkeypatch):
    a, _ = firms
    _busy([1, 2, 3])
    gone = _wait("open", a, created_ago=60)
    with SessionLocal() as db:
        db.execute(text("UPDATE linkedin_waiting SET seen_at = now() - interval '1 minute' WHERE id = :id"),
                   {"id": gone})
        db.commit()
    mine = _wait("search", a)
    assert queue._take(mine) == 0                                     # the dead process's open no longer blocks it


def test_a_429_is_sent_again_after_the_wait_and_at_most_three_times(firms, quick, monkeypatch):
    a, _ = firms
    replies = [(429, ""), (429, ""), (200, "ok")]
    monkeypatch.setattr(queue, "_send", lambda url, params, headers: replies.pop(0))
    assert queue.get("https://www.linkedin.com/x", None, {}, kind="search", firm_id=a,
                     deadline=time.monotonic() + 5) == (200, "ok")
    replies[:] = [(429, "")] * 5
    status, _ = queue.get("https://www.linkedin.com/x", None, {}, kind="open", firm_id=a,
                          deadline=time.monotonic() + 5)
    assert status == 429 and len(replies) == 2                        # three tries, then the refusal is returned


def test_the_slots_come_back_if_they_were_ever_deleted(firms):
    a, _ = firms
    with SessionLocal() as db:
        db.execute(text("DELETE FROM linkedin_slots"))
        db.commit()
    assert queue._take(_wait("open", a)) == 0
    with SessionLocal() as db:
        assert db.execute(text("SELECT count(*) FROM linkedin_slots")).scalar() == 4
