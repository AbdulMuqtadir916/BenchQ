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


def test_a_scheduled_batch_is_one_row_with_the_totals(test_db):
    with one_row_per_run():
        for _ in range(80):
            log_llm_call("score_light", "openrouter", "model-x", USAGE)
        log_llm_call("score_full", "openrouter", "model-x", USAGE, success=False)
    rows = _rows(test_db, entity_type="llm_call")
    assert sorted(row.summary.split(":")[0] for row in rows) == [
        "AI agent scored 1 job against the résumés (1 failed)", "AI agent scored 80 jobs against the résumés"]
    assert "80,000 tokens in, 4,000 out" in next(row.summary for row in rows if "80 jobs" in row.summary)


def test_a_firm_reader_never_gets_these_rows(api_client, test_db, accounts):
    log_activity("scrape", "Acme: 3 new / 9 found")
    log_llm_call("autofill", "openrouter", "model-x", USAGE)
    url = f"/api/firms/{accounts.firm_id}/ledger"
    assert api_client.get(url, params={"actor_type": "SYSTEM"}).json() == []
    assert api_client.get(url, params={"actor_type": "AGENT"}).json() == []
    assert api_client.get(f"{url}/people").json()["total"] == 0
