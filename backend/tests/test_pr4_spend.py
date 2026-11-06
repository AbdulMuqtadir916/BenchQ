"""PR 4 T1.4 (DEBUG D-15): every dispatched classification call is counted once, with a true amount."""
from datetime import timedelta
import uuid

import pytest

from backend.analyzer import llm_cost
from backend.analyzer.llm_logger import log_llm_call
from backend.inbox import classification_worker as worker
from backend.inbox.decider import Classification
from backend.inbox.decider_categories import CATEGORIES
from backend.models.db import JobRun, LlmCallLog, utcnow
from backend.tests.test_pr3_matching import matching_case, mailbox_case, email  # noqa: F401 (fixtures)
from backend.tests.test_pr3_pipeline import pipeline  # noqa: F401 (fixture)


def answer(usage):
    probabilities = {key: .1 / (len(CATEGORIES) - 1) for key in CATEGORIES}
    probabilities['assessment'] = .9
    return Classification('assessment', .9, probabilities, usage)


def _job(test_db):
    test_db.expire_all()
    return test_db.query(JobRun).filter_by(job_type='candidate_email_classification').one()


def test_provider_charge_is_recorded_as_actual(test_db, pipeline):
    _, _, message_id = pipeline
    usage = {'prompt_tokens': 100, 'completion_tokens': 5, 'cost': .0012, 'cost_quality': 'ACTUAL'}
    assert worker.process_one(message_id, provider=lambda *a: answer(usage))
    row = test_db.query(LlmCallLog).one()
    assert (row.purpose, row.provider, row.model) == ('email_classification', 'openrouter', 'synthetic-test-only')
    assert (row.input_tokens, row.output_tokens) == (100, 5) and row.cost_usd == pytest.approx(.0012)
    job = _job(test_db)
    assert row.firm_id == job.firm_id
    assert job.meta['dispatch_started'] and job.meta['usage']['cost_quality'] == 'ACTUAL'
    assert job.meta['llm_call_log_id'] == str(row.id)


def test_priced_model_is_recorded_as_estimated(test_db, pipeline, monkeypatch):
    _, _, message_id = pipeline
    monkeypatch.setitem(llm_cost._OR_PRICES, 'synthetic-test-only', {
        'input_per_mtok': 1.0, 'output_per_mtok': 2.0, 'cache_read_per_mtok': 0.0, 'cache_write_per_mtok': 0.0})
    assert worker.process_one(message_id, provider=lambda *a: answer({'prompt_tokens': 1000, 'completion_tokens': 10}))
    assert test_db.query(LlmCallLog).one().cost_usd == pytest.approx(1000 / 1e6 + 20 / 1e6)
    assert _job(test_db).meta['usage']['cost_quality'] == 'ESTIMATED'


def test_unknown_cost_is_one_row_and_flagged_as_unpriced(test_db, pipeline):
    """Every dispatched call is in AI spend (main's Q33 rule); an unknown charge is also reported as unpriced."""
    from backend.main import _llm_costs_stats
    _, _, message_id = pipeline
    assert worker.process_one(message_id, provider=lambda *a: answer({'prompt_tokens': 50}))
    row = test_db.query(LlmCallLog).one()
    assert (row.input_tokens, row.success) == (50, True)
    assert _job(test_db).meta['usage']['cost_quality'] == 'UNKNOWN'
    stats = _llm_costs_stats(days=7)
    assert stats['candidate_email_classification'] == {'unpriced_calls': 1, 'unconfirmed_calls': 0}


def test_only_dispatched_calls_are_counted(test_db, pipeline):
    from backend.main import _llm_costs_stats
    old = utcnow() - timedelta(minutes=10)
    for meta, status in (({'cost_quality': 'UNKNOWN'}, 'completed'),                     # claim released before dispatch
                         ({'dispatch_started': True}, 'running'),                         # crashed after dispatch
                         ({'dispatch_started': True, 'usage': {'cost_quality': 'UNKNOWN'},
                           'error_code': 'PROVIDER_AUTH_REJECTED'}, 'failed')):           # refused credentials: not charged
        test_db.add(JobRun(id=uuid.uuid4(), job_type='candidate_email_classification', trigger='scheduler',
                           status=status, started_at=old, meta=meta))
    test_db.commit()
    assert _llm_costs_stats(days=7)['candidate_email_classification'] == {'unpriced_calls': 0, 'unconfirmed_calls': 1}


def test_a_finished_email_is_never_charged_twice(test_db, pipeline):
    _, _, message_id = pipeline
    usage = {'prompt_tokens': 10, 'completion_tokens': 1, 'cost': .0001, 'cost_quality': 'ACTUAL'}
    assert worker.process_one(message_id, provider=lambda *a: answer(usage))
    assert not worker.process_one(message_id, provider=lambda *a: answer(usage))
    assert test_db.query(LlmCallLog).count() == 1


def test_logger_with_a_caller_session_never_commits_it(test_db):
    with worker.SessionLocal() as db:
        row_id = log_llm_call('email_classification', 'openrouter', 'm', {'input_tokens': 1}, cost_usd=.5, db=db)
        assert row_id is not None and db.get(LlmCallLog, row_id) is not None
        db.rollback()
    assert test_db.query(LlmCallLog).count() == 0
    log_llm_call('scoring', 'openrouter', 'm', {'input_tokens': 1}, cost_usd=.25)  # old path still commits itself
    assert test_db.query(LlmCallLog).one().cost_usd == pytest.approx(.25)
