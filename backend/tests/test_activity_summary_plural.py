"""Run summaries must use a real plural, not noun + "s"; _count_summary takes an explicit plural."""
import pytest

pytest.importorskip("apscheduler")   # scheduler.py imports it at module level

from backend.scheduler import _count_summary


def test_singular_reply():
    assert _count_summary(1, "reply", "replies") == "1 reply"


def test_plural_replies():
    assert _count_summary(3, "reply", "replies") == "3 replies"


def test_zero_is_still_empty():
    """An empty string is what makes the caller's `or "No new replies"` fire."""
    assert _count_summary(0, "reply", "replies") == ""


def test_regular_nouns_need_no_plural_argument():
    """The digest's "alert" / "alerts" caller keeps working unchanged."""
    assert _count_summary(1, "alert") == "1 alert"
    assert _count_summary(2, "alert") == "2 alerts"


async def test_email_check_summary_uses_the_replies_it_read(monkeypatch):
    from backend import job_monitor, scheduler
    from backend.email_monitor import gmail_client as gmail
    seen = []

    async def fake_check_emails():
        return 2

    real = job_monitor._finish_job_run
    monkeypatch.setattr(job_monitor, "_finish_job_run", lambda run_id, status, summary, error: seen.append(summary))
    monkeypatch.setattr(gmail, "check_emails", fake_check_emails)
    monkeypatch.setattr(job_monitor, "_insert_job_run", lambda *a, **k: None)
    await scheduler.run_email_check()
    assert seen == ["2 replies"]
    assert real is not None
