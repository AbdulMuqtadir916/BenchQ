"""The email classifier's AI calls are in AI spend, and its log lines carry ids and codes (docs/team/uzair.md §1,
step 4a). Uses the classification pipeline of test_pr3_pipeline.py."""
import logging

from backend.inbox import classification_worker as worker
from backend.inbox.decider import Classification, DeciderError
from backend.models.candidates import InboxMessage
from backend.models.db import LlmCallLog
from backend.tests.test_pr3_matching import mailbox_case, matching_case  # noqa: F401  (fixtures)
from backend.tests.test_pr3_pipeline import decision, pipeline  # noqa: F401  (pipeline is a fixture)


def test_a_classification_is_one_llm_call_log_row_for_its_firm(test_db, pipeline):
    _, _, message_id = pipeline
    base = decision()
    answer = Classification(base.category, base.confidence, base.probabilities,
                            {"prompt_tokens": 120, "completion_tokens": 8, "cost_quality": "UNKNOWN"})
    assert worker.process_one(message_id, provider=lambda *a: answer)
    row = test_db.query(LlmCallLog).filter_by(purpose="email_classification").one()
    message = test_db.get(InboxMessage, message_id)
    assert (row.firm_id, row.success, row.input_tokens, row.output_tokens) == (message.firm_id, True, 120, 8)
    assert (row.provider, row.model) == ("openrouter", "synthetic-test-only")


def test_a_refused_call_is_logged_as_failed_with_its_code(test_db, pipeline):
    _, _, message_id = pipeline

    def refused(*args):
        raise DeciderError("PROVIDER_REJECTED")

    assert not worker.process_one(message_id, provider=refused)
    row = test_db.query(LlmCallLog).filter_by(purpose="email_classification").one()
    assert (row.success, row.error) == (False, "PROVIDER_REJECTED")


def test_a_classifier_that_isnt_set_up_sent_nothing_and_costs_nothing(test_db, pipeline, monkeypatch):
    _, _, message_id = pipeline
    from types import SimpleNamespace
    monkeypatch.setattr(worker, "ai_config", lambda *a, **kw: SimpleNamespace(
        provider="openrouter", model="", api_key="", prompts={}, preset_id=None, preset_version=None))
    assert not worker.process_one(message_id)                # refused before any claim or provider call
    assert test_db.query(LlmCallLog).filter_by(purpose="email_classification").count() == 0
    test_db.expire_all()
    # PR 4 (T1.1, DEBUG D-02/D-03): a missing configuration leaves the email waiting, never failed.
    row = test_db.get(InboxMessage, message_id)
    assert (row.classification_state, row.classification_attempts, row.classification_error) == ("PENDING", 0, None)


def test_a_failure_logs_the_email_id_and_code_never_the_errors_text(test_db, pipeline, caplog):
    _, _, message_id = pipeline

    def fail(*args):
        raise RuntimeError("private secret subject and body")

    with caplog.at_level(logging.INFO, logger="jobnavigator.inbox"):
        assert not worker.process_one(message_id, provider=fail)
    written = "\n".join(r.getMessage() for r in caplog.records)
    assert f"Email {message_id} classification failed: PROCESSING_FAILED" in written
    assert "private secret" not in written
