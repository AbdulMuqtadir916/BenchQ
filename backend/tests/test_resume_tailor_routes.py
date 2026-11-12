"""Tailoring a candidate's résumé through the API (docs/team/tailoring.md §7, part 2; decided 2026-11-12): who starts
and reads one, the refusals, the run and the TAILORED version it writes, lost runs and the heartbeat, and the logs.
The model answers with recorded replies (resume_tailor_samples), and the run is driven here, as launch_background's
wrapper would."""
import asyncio
import uuid
from datetime import timedelta

import pytest

from backend.models.db import JobRun, Resume, Setting, utcnow
from backend.resume_tailor import runs
from backend.resume_tailor import settings as tailor_settings
from backend.tests.resume_support import make_posting
from backend.tests.resume_tailor_samples import ANALYSIS, DRAFT, REVIEW, VERIFY
from backend.tests.test_candidates_api import _assign, world  # noqa: F401  (the fixture)
from backend.tests.test_resume_tailor_pipeline import _replies_from
from backend.tests.test_resume_versions import _candidate, _listing


@pytest.fixture
def launched(monkeypatch, test_db):
    """launch_background, recorded: the run's row is written as the real one writes it; the run waits for `_drive`."""
    from backend import job_monitor
    from backend.api import routes_resume_tailoring
    from backend.seed import seed_settings
    seed_settings(test_db)
    test_db.merge(Setting(key=tailor_settings.KEY_ROW, value="test-key"))
    test_db.commit()
    calls = []

    def launch(job_type, coro_func, *, scope_key=None, meta=None, target_job_id=None, firm_id=None,
               func_kwargs=None, **_):
        run_id = uuid.uuid4()
        job_monitor._insert_job_run(run_id, job_type, "manual", meta, target_job_id=target_job_id, firm_id=firm_id)
        calls.append({"run_id": str(run_id), "job_type": job_type, "coro": coro_func, "kwargs": func_kwargs})
        return str(run_id)
    monkeypatch.setattr(routes_resume_tailoring, "launch_background", launch)
    return calls


def _drive(test_db, launched, replies=None, monkeypatch=None):
    """Run the oldest launched tailoring to its end, as launch_background's wrapper does."""
    from backend import job_monitor
    from backend.logging_setup import run_id as log_run_id
    if replies is not None:
        _replies_from(monkeypatch, replies)
    call = launched.pop(0)

    async def go():
        log_run_id.set(call["run_id"])
        job_monitor._run_failure.set(None)
        summary = await call["coro"](**call["kwargs"])
        reason = job_monitor._take_run_failure()
        job_monitor._finish_job_run(uuid.UUID(call["run_id"]), "failed" if reason else "completed", summary, reason)
    asyncio.run(go())
    test_db.expire_all()
    return call["run_id"]


REPLIES = [ANALYSIS, DRAFT, REVIEW, DRAFT, VERIFY]


@pytest.fixture
def setup(anonymous_client, test_db, world, launched):
    """A candidate of Fatima's team with Adnan as BDE (Base 1 v1 from onboarding), and one of their job postings."""
    c = _candidate(anonymous_client, test_db, world, bde="adnan")
    posting = make_posting(test_db, world["firm"].id, uuid.UUID(c["id"]), world["people"]["adnan"].id, title="Dev")
    test_db.commit()
    return {"c": c, "posting": posting, "base": _listing(anonymous_client, world, c)["bases"][0]}


def _url(world, c, tail=""):
    return f"/api/firms/{world['firm'].id}/candidates/{c['id']}/resumes{tail}"


def _start(client, world, s, who="adnan", **body):
    return client.post(_url(world, s["c"], "/tailor"), headers=world["as"][who],
                       json={"job_posting_id": str(s["posting"].id), **body})


def _status(client, world, s, run_id, who="adnan"):
    return client.get(_url(world, s["c"], f"/tailorings/{run_id}"), headers=world["as"][who])


# ── The run ──────────────────────────────────────────────────────────────────

def test_the_bde_tailors_and_a_tailored_v1_is_written(anonymous_client, test_db, world, launched, setup, monkeypatch):
    from backend.models.tenancy import LedgerEntry
    r = _start(anonymous_client, world, setup)
    assert r.status_code == 202, r.text
    run_id = r.json()["run_id"]
    assert _status(anonymous_client, world, setup, run_id).json()["status"] == "running"
    assert launched[0]["job_type"] == "resume_tailor"

    _drive(test_db, launched, list(REPLIES), monkeypatch)
    status = _status(anonymous_client, world, setup, run_id).json()
    assert (status["status"], status["error_code"]) == ("completed", None)
    row = test_db.get(Resume, uuid.UUID(status["resume_id"]))
    assert (row.category, row.version, row.name, row.job_id) == ("TAILORED", 1, "Tailored", setup["posting"].id)
    assert str(row.base_resume_id) == setup["base"]["id"] and row.created_by_user_id == world["people"]["adnan"].id
    assert row.title == "Backend Developer specializing in Python"            # the tailored headline
    tailored = _listing(anonymous_client, world, setup["c"])["tailored"][0]
    assert [t["id"] for t in tailored["versions"]] == [str(row.id)]
    # The listing names the copy by its own job, so no screen loads jobs to name it (Zuhair 2026-11-12).
    assert tailored["job"] == {"title": "Dev 0", "company": "Acme"}

    run = test_db.get(JobRun, uuid.UUID(run_id))
    assert (run.status, run.firm_id, run.target_job_id) == ("completed", world["firm"].id, setup["posting"].id)
    assert run.meta["counts"]["review_edits_applied"] >= 0 and set(run.meta["counts"]["tokens"]) == set(
        ("analyse", "draft", "review", "revise", "verify"))
    entry = test_db.query(LedgerEntry).filter(LedgerEntry.entity_id == str(row.id)).one()
    assert (entry.action, entry.summary, entry.model_id) == ("CREATE", "Tailored Base 1 for Dev 0", "openai/gpt-6-luna")
    assert entry.actor_user_id == world["people"]["adnan"].id and str(entry.candidate_id) == setup["c"]["id"]


def test_a_retailor_is_the_next_version_and_carries_what_the_bde_typed(anonymous_client, test_db, world, launched,
                                                                       setup, monkeypatch):
    _start(anonymous_client, world, setup)
    first = _status(anonymous_client, world, setup, _drive(test_db, launched, list(REPLIES), monkeypatch)).json()
    typed = {"edited": {}, "custom": {"Why this job?": "Payments work."}}
    test_db.get(Resume, uuid.UUID(first["resume_id"])).autofill = typed
    test_db.commit()

    assert _start(anonymous_client, world, setup).status_code == 202
    second = _status(anonymous_client, world, setup, _drive(test_db, launched, list(REPLIES), monkeypatch)).json()
    row = test_db.get(Resume, uuid.UUID(second["resume_id"]))
    assert row.version == 2 and row.autofill == typed


def test_a_step_that_fails_writes_no_version(anonymous_client, test_db, world, launched, setup, monkeypatch):
    from backend.models.tenancy import LedgerEntry
    run_id = _start(anonymous_client, world, setup).json()["run_id"]
    _drive(test_db, launched, [ANALYSIS, RuntimeError("provider down")], monkeypatch)
    status = _status(anonymous_client, world, setup, run_id).json()
    assert (status["status"], status["error_code"], status["resume_id"]) == ("failed", "provider_failed", None)
    assert test_db.query(Resume).filter(Resume.category == "TAILORED").count() == 0
    assert test_db.query(LedgerEntry).filter(LedgerEntry.summary.like("Tailored%")).count() == 0


@pytest.mark.parametrize("change", ["posting_deleted", "base_hidden", "firm_suspended", "marked_lost"])
def test_what_changed_during_the_run_stops_it_with_no_version(anonymous_client, test_db, world, launched, setup,
                                                              monkeypatch, change):
    from backend.models.candidates import BaseResume
    from backend.models.job_search import JobPosting
    run_id = _start(anonymous_client, world, setup).json()["run_id"]
    if change == "posting_deleted":
        test_db.delete(test_db.get(JobPosting, setup["posting"].id))
    elif change == "base_hidden":
        test_db.get(BaseResume, uuid.UUID(setup["base"]["id"])).archived_at = utcnow()
    elif change == "firm_suspended":
        world["firm"].status = "SUSPENDED"
    else:
        runs.merge_meta(test_db, run_id, {"error_code": "lost"})
    test_db.commit()
    _drive(test_db, launched, list(REPLIES), monkeypatch)
    run = test_db.get(JobRun, uuid.UUID(run_id))
    assert run.status == "failed" and run.meta["error_code"] == ("lost" if change == "marked_lost" else "gone")
    assert "resume_id" not in run.meta and test_db.query(Resume).filter(Resume.category == "TAILORED").count() == 0


def test_a_candidate_handed_to_another_bde_still_gets_the_version(anonymous_client, test_db, world, launched, setup,
                                                                  monkeypatch):
    run_id = _start(anonymous_client, world, setup).json()["run_id"]
    assert _assign(anonymous_client, world, "fatima", setup["c"], "fatima", "sneha").status_code == 200
    _drive(test_db, launched, list(REPLIES), monkeypatch)
    status = _status(anonymous_client, world, setup, run_id, who="fatima").json()
    assert status["status"] == "completed"
    assert test_db.get(Resume, uuid.UUID(status["resume_id"])).created_by_user_id == world["people"]["adnan"].id


# ── Who ──────────────────────────────────────────────────────────────────────

def test_only_the_candidates_bde_starts_one(anonymous_client, world, launched, setup):
    assert _start(anonymous_client, world, setup, who="owner").status_code == 403
    assert _start(anonymous_client, world, setup, who="fatima").status_code == 403
    assert _start(anonymous_client, world, setup, who="vikram").status_code == 404     # not in his scope
    assert launched == []


def test_anyone_who_sees_the_candidate_reads_its_tailorings(anonymous_client, world, launched, setup):
    run_id = _start(anonymous_client, world, setup).json()["run_id"]
    for who in ("owner", "fatima", "adnan"):
        assert _status(anonymous_client, world, setup, run_id, who=who).status_code == 200
        listed = anonymous_client.get(_url(world, setup["c"], "/tailorings?running=true"), headers=world["as"][who])
        assert [t["run_id"] for t in listed.json()] == [run_id]
    assert _status(anonymous_client, world, setup, run_id, who="vikram").status_code == 404
    assert _status(anonymous_client, world, setup, uuid.uuid4()).status_code == 404


# ── Refusals ─────────────────────────────────────────────────────────────────

def test_another_candidates_posting_or_base_is_not_found(anonymous_client, test_db, world, launched, setup):
    other = _candidate(anonymous_client, test_db, world, bde="adnan")
    theirs = make_posting(test_db, world["firm"].id, uuid.UUID(other["id"]), world["people"]["adnan"].id, n=1)
    test_db.commit()
    assert _start(anonymous_client, world, setup, job_posting_id=str(theirs.id)).status_code == 404
    their_base = _listing(anonymous_client, world, other)["bases"][0]["id"]
    assert _start(anonymous_client, world, setup, base_resume_id=their_base).status_code == 404
    assert launched == []


def test_a_job_with_no_description_is_refused(anonymous_client, test_db, world, launched, setup):
    setup["posting"].content = {**setup["posting"].content, "description": "  "}
    test_db.commit()
    r = _start(anonymous_client, world, setup)
    assert r.status_code == 422 and "no description" in r.json()["detail"]

    # A freehire.me description that is only markup has no text either: read as the job page reads it.
    setup["posting"].source = "freehire"
    setup["posting"].content = {**setup["posting"].content, "description": "<p> </p><ul></ul>"}
    test_db.commit()
    assert _start(anonymous_client, world, setup).status_code == 422
    assert launched == []


def test_the_job_reaches_the_tailor_as_the_job_page_shows_it():
    """Read by the posting's own source (Zuhair 2026-11-12): a search's HTML as plain text, a typed one as typed."""
    from backend.models.job_search import JobPosting
    html = JobPosting(source="freehire", content={"title": " Java <b>Dev</b> ", "company": "Acme",
                                                  "description": "<p>Build <b>APIs</b>.</p><ul><li>Python</li></ul>"})
    description, title = runs.posting_text(html)
    assert "<" not in description and "Build APIs." in description and "Python" in description
    assert title                                                   # the reader's own clean-up of the title
    typed = JobPosting(source="manual", content={"title": "Dev", "description": "Needs a < b and a > c."})
    assert runs.posting_text(typed) == ("Needs a < b and a > c.", "Dev")
    assert runs.posting_text(JobPosting(source="nobody-knows", content={"description": "x"})) == ("", "")


def test_a_hidden_base_or_no_active_base_is_refused(anonymous_client, test_db, world, launched, setup):
    from backend.models.candidates import BaseResume
    base = test_db.get(BaseResume, uuid.UUID(setup["base"]["id"]))
    base.archived_at = utcnow()
    test_db.commit()
    r = _start(anonymous_client, world, setup, base_resume_id=setup["base"]["id"])
    assert r.status_code == 409 and "hidden" in r.json()["detail"]
    base.archived_at, base.is_active = None, False
    test_db.commit()
    r = _start(anonymous_client, world, setup)
    assert r.status_code == 409 and "no active base" in r.json()["detail"]


def test_the_same_base_and_job_running_is_refused(anonymous_client, world, launched, setup):
    assert _start(anonymous_client, world, setup).status_code == 202
    r = _start(anonymous_client, world, setup)
    assert r.status_code == 409 and "already being tailored" in r.json()["detail"]
    assert len(launched) == 1


def test_a_bde_with_five_running_waits_for_one(anonymous_client, test_db, world, launched, setup):
    for n in range(1, runs.MOST_RUNNING_PER_BDE + 1):
        posting = make_posting(test_db, world["firm"].id, uuid.UUID(setup["c"]["id"]), world["people"]["adnan"].id,
                               n=n)
        test_db.commit()
        assert _start(anonymous_client, world, setup, job_posting_id=str(posting.id)).status_code == 202
    r = _start(anonymous_client, world, setup)
    assert r.status_code == 429 and "5 tailorings running" in r.json()["detail"]


def test_a_tailor_not_set_up_is_a_500_naming_the_row(anonymous_client, test_db, world, launched, setup):
    test_db.merge(Setting(key=tailor_settings.KEY_ROW, value=""))
    test_db.commit()
    r = _start(anonymous_client, world, setup)
    assert r.status_code == 500 and "resume_tailor_llm_api_key" in r.json()["detail"] and launched == []


# ── Lost runs and the heartbeat ──────────────────────────────────────────────

def _age(test_db, run_id, minutes):
    test_db.query(JobRun).filter(JobRun.id == uuid.UUID(run_id)).update(
        {JobRun.started_at: utcnow() - timedelta(minutes=minutes)})
    test_db.commit()


def test_a_run_not_stamped_for_two_minutes_is_lost_and_frees_its_job(anonymous_client, test_db, world, launched,
                                                                     setup):
    run_id = _start(anonymous_client, world, setup).json()["run_id"]
    _age(test_db, run_id, 3)
    status = _status(anonymous_client, world, setup, run_id).json()
    assert (status["status"], status["error_code"]) == ("failed", "lost")
    assert _start(anonymous_client, world, setup).status_code == 202          # the 409 lifted


def test_a_stamped_run_stays_running_until_the_thirty_minute_backstop(anonymous_client, test_db, world, launched,
                                                                      setup):
    run_id = _start(anonymous_client, world, setup).json()["run_id"]
    _age(test_db, run_id, 10)
    runs.stamp(test_db, [run_id])
    test_db.commit()
    assert _status(anonymous_client, world, setup, run_id).json()["status"] == "running"
    _age(test_db, run_id, 31)
    runs.stamp(test_db, [run_id])
    test_db.commit()
    assert _status(anonymous_client, world, setup, run_id).json()["error_code"] == "lost"


def test_a_run_failed_by_the_startup_clean_up_reads_as_lost(anonymous_client, test_db, world, launched, setup):
    from backend.job_monitor import cleanup_stale_runs
    run_id = _start(anonymous_client, world, setup).json()["run_id"]
    cleanup_stale_runs()
    test_db.expire_all()
    assert _status(anonymous_client, world, setup, run_id).json()["error_code"] == "lost"


def test_the_heartbeat_stamps_only_running_rows(test_db, world):
    done = JobRun(firm_id=world["firm"].id, job_type=runs.JOB_TYPE, trigger="manual", status="completed", meta={})
    live = JobRun(firm_id=world["firm"].id, job_type=runs.JOB_TYPE, trigger="manual", status="running", meta={"a": 1})
    test_db.add_all([done, live])
    test_db.commit()
    runs.stamp(test_db, [done.id, live.id])
    test_db.commit()
    test_db.expire_all()
    assert "seen_at" in live.meta and live.meta["a"] == 1 and "seen_at" not in done.meta


# ── The gate, the routes' order, the logs ────────────────────────────────────

def test_the_tailor_has_its_own_gate_of_forty(test_db):
    from backend.job_monitor import limiter_for_job_type, reset_limiter
    from backend.seed import seed_settings
    seed_settings(test_db)
    reset_limiter("resume_tailor")
    assert limiter_for_job_type(runs.JOB_TYPE).value == 40
    reset_limiter("resume_tailor")


def test_tailorings_is_never_read_as_a_resume_id(anonymous_client, world, launched, setup):
    r = anonymous_client.get(_url(world, setup["c"], "/tailorings"), headers=world["as"]["owner"])
    assert r.status_code == 200 and r.json() == []


def test_a_run_logs_no_resume_or_posting_text(anonymous_client, test_db, world, launched, setup, monkeypatch, log):
    run_id = _start(anonymous_client, world, setup).json()["run_id"]
    _drive(test_db, launched, [ANALYSIS, DRAFT, REVIEW, DRAFT, VERIFY], monkeypatch)
    written = log.getvalue()
    assert "could not be applied" in written                    # the run did log (a missed review edit), by count
    for text in ("Built the payments API", "Made-up job 0", "Capital Payments", "Backend Developer specializing",
                 "text the draft never had"):
        assert text not in written
    assert test_db.get(JobRun, uuid.UUID(run_id)).status == "completed"
