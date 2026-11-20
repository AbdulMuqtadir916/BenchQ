"""PR 4: emails are classified several at once, each exactly once, and 1 means one at a time."""
import threading
import time

from backend.inbox import classification_worker as worker


def _track(monkeypatch, *, fail=None):
    seen, live, peak, lock = [], [0], [0], threading.Lock()

    def fake(identity, aliases=None):
        with lock:
            live[0] += 1
            peak[0] = max(peak[0], live[0])
        time.sleep(0.05)
        with lock:
            live[0] -= 1
            seen.append(identity)
        if identity == fail:
            return False
        return True

    monkeypatch.setattr(worker, 'process_one', fake)
    return seen, peak


def test_several_emails_run_at_once_and_each_runs_once(monkeypatch):
    seen, peak = _track(monkeypatch)
    ids = list(range(12))
    assert worker.classify_all(ids, {}, 4) == 12
    assert sorted(seen) == ids
    assert 1 < peak[0] <= 4


def test_concurrency_one_is_one_at_a_time_in_order(monkeypatch):
    seen, peak = _track(monkeypatch)
    assert worker.classify_all([3, 1, 2], {}, 1) == 3
    assert seen == [3, 1, 2] and peak[0] == 1


def test_a_failed_email_is_not_counted_and_does_not_stop_the_others(monkeypatch):
    seen, _ = _track(monkeypatch, fail=5)
    assert worker.classify_all(list(range(8)), {}, 4) == 7
    assert sorted(seen) == list(range(8))


def test_an_exception_in_one_email_is_not_swallowed(monkeypatch):
    import pytest

    def boom(identity, aliases=None):
        if identity == 2:
            raise RuntimeError('provider exploded')
        return True

    monkeypatch.setattr(worker, 'process_one', boom)
    with pytest.raises(RuntimeError):
        worker.classify_all([1, 2, 3], {}, 3)

