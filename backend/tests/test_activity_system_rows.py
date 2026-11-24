"""Background work in the activity log: system and AI rows with no firm, which only the Super Admin reads."""
import pytest

from backend import job_monitor
from backend.activity import log_activity
from backend.analyzer.llm_logger import log_llm_call, one_row_per_run
from backend.models.tenancy import ActivityEntry

USAGE = {"input_tokens": 1000, "output_tokens": 50}


def _rows(test_db, **filters):
    test_db.expire_all()
    return test_db.query(ActivityEntry).filter_by(**filters).order_by(ActivityEntry.created_at).all()


def test_a_background_event_is_a_system_row_with_no_firm(test_db):
    log_activity("scrape", "Acme (Greenhouse): 3 new / 9 found in 1.0s", company="Acme", details={"source": "ats"})
    row = _rows(test_db, entity_type="system_event")[0]
    assert (row.actor_type, row.actor_name, row.action, row.firm_id) == ("SYSTEM", "Scraper", "CREATE", None)
    assert (row.entity_label, row.note) == ("Acme", '{"source": "ats"}')


def test_an_empty_event_leaves_no_row(test_db):
    log_activity("scrape", "Acme: 0 new / 0 found", is_empty=True)
    assert _rows(test_db, entity_type="system_event") == []


@pytest.mark.parametrize("summary", ["No new replies", "No sources ran", "Synced 0 candidate inboxes.", None])
async def test_a_run_that_did_nothing_leaves_no_row(test_db, summary):
    async with job_monitor.tracked_run("email_check", "scheduler") as tracked:
        tracked.summary = summary
    assert _rows(test_db, entity_type="job_run") == []


@pytest.mark.parametrize("summary", ["3 replies", "Digest sent", "Synced 2 candidate inboxes."])
async def test_a_scheduled_run_that_did_something_is_a_row(test_db, summary):
    async with job_monitor.tracked_run("email_check", "scheduler") as tracked:
        tracked.summary = summary
    row = _rows(test_db, entity_type="job_run")[0]
    assert (row.actor_type, row.actor_name, row.firm_id) == ("SYSTEM", "Scheduler", None)
    assert row.summary == f"Email check: {summary}"


async def test_a_failed_scheduled_run_is_a_row(test_db):
    with pytest.raises(RuntimeError):
        async with job_monitor.tracked_run("scrape_all", "scheduler"):
            raise RuntimeError("source down")
    assert _rows(test_db, entity_type="job_run")[0].summary.startswith("Scrape all failed:")


async def test_a_manual_run_leaves_no_run_row(test_db):
    async with job_monitor.tracked_run("email_check", "manual") as tracked:
        tracked.summary = "3 replies"
    assert _rows(test_db, entity_type="job_run") == []


def test_a_persons_ai_call_is_one_row_with_what_it_did(test_db):
    log_llm_call("autofill", "openrouter", "model-x", USAGE)
    row = _rows(test_db, entity_type="llm_call")[0]
    assert (row.actor_type, row.actor_name, row.action, row.firm_id, row.model_id) == ("AGENT", "Autofill", "AI_GENERATE", None, "model-x")
    assert row.summary.startswith("AI agent drafted 1 answer: 1,000 tokens in, 50 out, $")


def test_an_ai_call_made_inside_the_callers_session_is_a_row_too(test_db):
    """The email classifier (PR 4 on main) logs its call into its own transaction, which is never committed here. The
    Super Admin's row is written on its own, so it is there whichever way the call was logged."""
    log_llm_call("autofill", "openrouter", "model-x", USAGE, db=test_db)
    row = _rows(test_db, entity_type="llm_call")[0]
    assert (row.actor_type, row.firm_id, row.model_id) == ("AGENT", None, "model-x")


def test_a_scheduled_batch_is_one_row_with_the_totals(test_db):
    with one_row_per_run():
        for _ in range(80):
            log_llm_call("score_light", "openrouter", "model-x", USAGE)
        log_llm_call("score_full", "openrouter", "model-x", USAGE, success=False)
    rows = _rows(test_db, entity_type="llm_call")
    assert sorted(row.summary.split(":")[0] for row in rows) == [
        "AI agent scored 1 job against the résumés (1 failed)", "AI agent scored 80 jobs against the résumés"]
    assert "80,000 tokens in, 4,000 out" in next(row.summary for row in rows if "80 jobs" in row.summary)


def test_a_batch_that_used_two_models_credits_neither(test_db):
    with one_row_per_run():
        log_llm_call("score_light", "openrouter", "model-x", USAGE)
        log_llm_call("score_light", "openrouter", "model-y", USAGE)          # a fallback joined in
    (row,) = _rows(test_db, entity_type="llm_call")
    assert row.model_id is None and "scored 2 jobs" in row.summary


@pytest.mark.parametrize("path,worker,count,summary", [
    ("/api/email/check-now", "backend.email_monitor.gmail_client.check_emails", 2, "2 replies"),
    ("/api/email/check-now", "backend.email_monitor.gmail_client.check_emails", 0, "No new replies"),
    ("/api/telegram/digest", "backend.notifier.telegram.send_digest", 1, "1 alert"),
    ("/api/telegram/digest", "backend.notifier.telegram.send_digest", 0, "No digest sent"),
])
async def test_a_manual_email_check_or_digest_reports_what_its_worker_did(api_client, monkeypatch, path, worker, count, summary):
    import backend.main
    started = {}

    def capture(job_type, func, **kwargs):
        started["run"] = func
        return "run-1"

    async def did(*args, **kwargs):
        return count
    monkeypatch.setattr(backend.main, "launch_background", capture)
    monkeypatch.setattr(worker, did)
    assert api_client.post(path).status_code == 202
    assert await started["run"]() == summary


@pytest.mark.parametrize("sent,summary,rows", [(0, "No digest sent", 0), (2, "2 alerts", 1)])
async def test_the_scheduled_digest_says_what_it_sent_and_logs_only_a_send(test_db, monkeypatch, sent, summary, rows):
    """Issue #157: the scheduled digest that sent nothing reads "No digest sent", as the manual one does, and leaves no
    Scheduler row."""
    from backend import scheduler
    from backend.models.db import JobRun

    async def did(*args, **kwargs):
        return sent
    monkeypatch.setattr("backend.notifier.telegram.send_digest", did)
    await scheduler.send_daily_digest()
    test_db.expire_all()
    run = test_db.query(JobRun).filter(JobRun.job_type == "daily_digest").order_by(JobRun.started_at.desc()).first()
    assert run.result_summary == summary
    assert len(_rows(test_db, entity_type="job_run", actor_name="Scheduler")) == rows


async def test_a_digest_telegram_refused_is_not_counted_as_sent(test_db, monkeypatch):
    from backend.notifier import telegram

    async def refused(*args, **kwargs):
        return False
    monkeypatch.setattr(telegram, "_is_enabled", lambda: True)
    monkeypatch.setattr(telegram, "_get_chat_id", lambda: "chat-1")
    monkeypatch.setattr(telegram, "_send_message", refused)
    assert await telegram.send_digest() == 0
    assert not [row for row in _rows(test_db, entity_type="system_event") if "digest sent" in row.summary]


class _FakeGmail:
    """httpx.AsyncClient for check_emails: lists the given message ids and returns each one."""
    ids: list[str] = []

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get(self, url, **kwargs):
        import httpx
        payload = {"headers": [{"name": "From", "value": "jobs@acme.test"}, {"name": "Subject", "value": "Hello"}]}
        body = {"messages": [{"id": i} for i in self.ids]} if url.endswith("/messages") else {"payload": payload}
        return httpx.Response(200, json=body)


@pytest.mark.parametrize("seen_before,rows", [(set(), 1), ({"m1"}, 0)])
async def test_an_email_check_that_could_not_classify_a_new_message_still_leaves_a_row(test_db, monkeypatch, seen_before, rows):
    """CodeRabbit on #144: a failed classification marks the message handled, so the check did something."""
    from backend.email_monitor import gmail_client as gmail, response_parser

    async def token():
        return "token"

    async def no_result(*args, **kwargs):
        return None

    async def no_wait(*args):
        return None
    _FakeGmail.ids = ["m1"]
    monkeypatch.setattr(gmail, "_get_access_token", token)
    monkeypatch.setattr(gmail, "_load_processed_ids", lambda db: set(seen_before))
    monkeypatch.setattr(gmail, "_save_processed_ids", lambda db, ids: None)
    monkeypatch.setattr(gmail, "_build_gmail_query", lambda db: "from:acme.test")
    monkeypatch.setattr(gmail, "_get_active_apps_for_llm", lambda db: [])
    monkeypatch.setattr(gmail, "classify_email", lambda subject, body: {"classification": "other", "confidence": 0.1})
    monkeypatch.setattr(response_parser, "classify_email_llm", no_result)
    monkeypatch.setattr(gmail.asyncio, "sleep", no_wait)
    monkeypatch.setattr(gmail.httpx, "AsyncClient", _FakeGmail)
    assert await gmail.check_emails() == 0
    checks = [row for row in _rows(test_db, entity_type="system_event") if row.summary.startswith("Email check:")]
    assert len(checks) == rows


def test_a_firm_reader_never_gets_these_rows(api_client, test_db, accounts):
    log_activity("scrape", "Acme: 3 new / 9 found")
    log_llm_call("autofill", "openrouter", "model-x", USAGE)
    url = f"/api/firms/{accounts.firm_id}/ledger"
    assert api_client.get(url, params={"actor_type": "SYSTEM"}).json() == []
    assert api_client.get(url, params={"actor_type": "AGENT"}).json() == []
    assert api_client.get(f"{url}/people").json()["total"] == 0
