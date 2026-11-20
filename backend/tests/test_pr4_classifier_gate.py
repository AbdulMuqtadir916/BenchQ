"""PR 4 T1.1 (DEBUG D-02, D-03): configuration guard and the configuration-scoped pause. Synthetic only."""
from datetime import datetime, timedelta
from types import SimpleNamespace
import uuid

from backend.ai.config import ai_config
from backend.inbox import classification_worker as worker, classifier_pause
from backend.inbox.decider import DeciderError
from backend.models.candidates import InboxMessage
from backend.models.db import JobRun, LlmCallLog, Setting, utcnow
from backend.tests.test_pr3_matching import matching_case, mailbox_case, email  # noqa: F401 (fixtures)
from backend.tests.test_pr3_pipeline import decision, pipeline  # noqa: F401 (fixture)

CFG = SimpleNamespace(provider='openrouter', model='synthetic-test-only', api_key='synthetic-not-real',
                      prompts={}, preset_id=None, preset_version=None)


def _row(test_db, message_id):
    test_db.expire_all()
    return test_db.get(InboxMessage, message_id)


def _pause_meta(test_db):
    test_db.expire_all()
    return test_db.get(JobRun, classifier_pause.pause_id(CFG))


def _make_probe_due(test_db):
    pause = _pause_meta(test_db)
    pause.meta = {**pause.meta, 'next_probe_at': (utcnow() - timedelta(seconds=1)).isoformat()}
    test_db.commit()


def test_classifier_never_borrows_the_primary_provider(test_db):
    for key, value in (('llm_provider', 'claude_api'), ('llm_model', 'primary-model'), ('llm_api_key', 'primary-key')):
        test_db.merge(Setting(key=key, value=value))
    test_db.commit()
    cfg = ai_config('email_classification', db=test_db)
    assert (cfg.provider, cfg.model, cfg.api_key) == ('', '', '')
    assert ai_config('scoring', db=test_db).provider == 'claude_api'  # other modules keep their fallback


def test_missing_configuration_leaves_mail_queued_without_a_claim(test_db, pipeline, monkeypatch):
    _, _, message_id = pipeline
    monkeypatch.setattr(worker, 'ai_config', lambda *a, **kw: SimpleNamespace(
        provider='claude_api', model='x', api_key='y', prompts={}, preset_id=None, preset_version=None))
    calls = []
    assert not worker.process_one(message_id, provider=lambda *a: calls.append(a) or decision())
    assert worker.process_pending() == 0
    row = _row(test_db, message_id)
    assert (row.classification_state, row.classification_attempts, row.classification_error) == ('PENDING', 0, None)
    assert calls == [] and test_db.query(JobRun).count() == 0


def test_rejected_key_pauses_and_releases_the_email(test_db, pipeline):
    _, _, message_id = pipeline
    def rejected(*args): raise DeciderError('PROVIDER_AUTH_REJECTED')
    assert not worker.process_one(message_id, provider=rejected)
    row = _row(test_db, message_id)
    assert (row.classification_state, row.classification_attempts, row.classification_error) == ('PENDING', 0, None)
    pause = _pause_meta(test_db)
    assert pause.status == 'running' and pause.meta['reason'] == 'PROVIDER_AUTH_REJECTED'
    assert 'synthetic-not-real' not in str(pause.meta)
    # Paused and no probe due: nothing is claimed or sent.
    calls = []
    assert not worker.process_one(message_id, provider=lambda *a: calls.append(a) or decision())
    assert calls == [] and _row(test_db, message_id).classification_attempts == 0


def test_only_one_probe_lease_at_a_time(test_db, pipeline):
    with worker.SessionLocal() as db:
        classifier_pause.record_pause(db, CFG, 'PROVIDER_AUTH_REJECTED')
        classifier_pause.record_pause(db, CFG, 'PROVIDER_AUTH_REJECTED')  # concurrent insert: still one row
    assert test_db.query(JobRun).filter_by(job_type=classifier_pause.PAUSE_JOB_TYPE).count() == 1
    with worker.SessionLocal() as db:
        assert not classifier_pause.claim_probe(db, CFG)  # first probe not due yet
    _make_probe_due(test_db)
    with worker.SessionLocal() as first, worker.SessionLocal() as second:
        assert classifier_pause.claim_probe(first, CFG)
        assert not classifier_pause.claim_probe(second, CFG)


def test_probe_success_clears_the_pause_and_classifies(test_db, pipeline):
    _, _, message_id = pipeline
    with worker.SessionLocal() as db:
        classifier_pause.record_pause(db, CFG, 'PROVIDER_AUTH_REJECTED')
    _make_probe_due(test_db)
    assert worker.process_one(message_id, provider=lambda *a: decision())
    assert _row(test_db, message_id).classification_state == 'DONE'
    pause = _pause_meta(test_db)
    assert pause.status == 'completed' and pause.meta['cleared_at']


def test_probe_rejected_again_waits_an_hour(test_db, pipeline):
    _, _, message_id = pipeline
    with worker.SessionLocal() as db:
        classifier_pause.record_pause(db, CFG, 'PROVIDER_AUTH_REJECTED')
    _make_probe_due(test_db)
    def rejected(*args): raise DeciderError('PROVIDER_AUTH_REJECTED')
    assert not worker.process_one(message_id, provider=rejected)
    pause = _pause_meta(test_db)
    wait = datetime.fromisoformat(pause.meta['next_probe_at']) - utcnow()
    assert pause.status == 'running' and timedelta(minutes=55) < wait <= timedelta(hours=1)
    assert pause.meta['probe_failures'] == 1 and pause.meta['probe_lease_until'] is None
    row = _row(test_db, message_id)
    assert (row.classification_state, row.classification_attempts) == ('PENDING', 0)


def test_inconclusive_probe_keeps_the_pause_and_the_attempt(test_db, pipeline):
    _, _, message_id = pipeline
    with worker.SessionLocal() as db:
        classifier_pause.record_pause(db, CFG, 'PROVIDER_AUTH_REJECTED')
    _make_probe_due(test_db)
    def unavailable(*args): raise DeciderError('PROVIDER_UNAVAILABLE', retryable=True)
    assert not worker.process_one(message_id, provider=unavailable)
    pause = _pause_meta(test_db)
    wait = datetime.fromisoformat(pause.meta['next_probe_at']) - utcnow()
    assert pause.status == 'running' and timedelta(minutes=10) < wait <= timedelta(minutes=15)
    assert pause.meta['probe_failures'] == 0
    row = _row(test_db, message_id)
    assert (row.classification_state, row.classification_attempts) == ('PENDING', 0)


def _masking_fails(monkeypatch):
    def broken(*args, **kwargs):
        raise RuntimeError('synthetic masking failure')
    monkeypatch.setattr(worker, 'build_request', broken)


def test_a_masking_failure_sends_nothing_costs_nothing_and_retries_later(test_db, pipeline, monkeypatch):
    """CodeRabbit #127: the request is masked before the dispatch is marked, so a masking failure is never a call."""
    _, _, message_id = pipeline
    _masking_fails(monkeypatch)
    sent = []
    monkeypatch.setattr(worker, 'classify', lambda *args, **kwargs: sent.append(args) or decision())
    assert not worker.process_one(message_id)
    row = _row(test_db, message_id)
    assert sent == [] and (row.classification_state, row.classification_error) == ('PENDING', 'MASKING_FAILED')
    assert row.classification_next_retry_at is not None
    assert test_db.query(LlmCallLog).filter_by(purpose='email_classification').count() == 0
    job = test_db.query(JobRun).filter_by(job_type='candidate_email_classification').one()
    assert 'dispatch_started' not in job.meta and job.meta['error_code'] == 'MASKING_FAILED'


def _masking_while(monkeypatch, change):
    """Masking that takes long enough for someone else to `change` the email or its mailbox meanwhile."""
    def slow(*args, **kwargs):
        with worker.SessionLocal() as other:
            change(other)
            other.commit()
        return {}
    monkeypatch.setattr(worker, 'build_request', slow)


def _assert_nothing_sent(test_db, message_id, sent, state):
    row = _row(test_db, message_id)
    assert sent == [], "the email was sent to the classifier after it stopped being sendable"
    assert (row.classification_state, row.classification_attempts, row.classification_token) == (state, 0, None)
    assert test_db.query(LlmCallLog).filter_by(purpose='email_classification').count() == 0
    job = test_db.query(JobRun).filter_by(job_type='candidate_email_classification').one()
    assert 'dispatch_started' not in job.meta and job.meta['error_code'] == 'WORK_INVALIDATED'


def test_a_mailbox_disconnected_during_masking_stops_the_send(test_db, pipeline, monkeypatch):
    """Abdul's review on #127 (P1): the email is checked again after masking, just before it is sent."""
    from backend.models.candidates import CandidateMailbox
    _, _, message_id = pipeline
    mailbox_id = _row(test_db, message_id).mailbox_id
    _masking_while(monkeypatch, lambda db: setattr(db.get(CandidateMailbox, mailbox_id), 'status', 'DISCONNECTED'))
    sent = []
    monkeypatch.setattr(worker, 'classify', lambda *args, **kwargs: sent.append(args) or decision())
    assert not worker.process_one(message_id)
    _assert_nothing_sent(test_db, message_id, sent, 'PENDING')


def test_an_email_deleted_during_masking_is_never_sent(test_db, pipeline, monkeypatch):
    """Abdul's review on #127 (P1). Only `deleted_at` changes here, so the check can't lean on the content revision."""
    _, _, message_id = pipeline
    _masking_while(monkeypatch, lambda db: setattr(db.get(InboxMessage, message_id), 'deleted_at', utcnow()))
    sent = []
    monkeypatch.setattr(worker, 'classify', lambda *args, **kwargs: sent.append(args) or decision())
    assert not worker.process_one(message_id)
    _assert_nothing_sent(test_db, message_id, sent, 'EXCLUDED')


def test_a_masking_failure_during_a_probe_keeps_the_pause_and_the_attempt(test_db, pipeline, monkeypatch):
    _, _, message_id = pipeline
    with worker.SessionLocal() as db:
        classifier_pause.record_pause(db, CFG, 'PROVIDER_AUTH_REJECTED')
    _make_probe_due(test_db)
    _masking_fails(monkeypatch)
    assert not worker.process_one(message_id)
    pause = _pause_meta(test_db)
    assert pause.status == 'running' and pause.meta['probe_failures'] == 0 and not pause.meta.get('cleared_at')
    row = _row(test_db, message_id)
    assert (row.classification_state, row.classification_attempts) == ('PENDING', 0)


def test_a_probe_that_claims_no_email_gives_its_lease_back(test_db, pipeline):
    """CodeRabbit #127: an email the probe cannot claim (here: waiting for its retry) leaves the probe free."""
    _, _, message_id = pipeline
    with worker.SessionLocal() as db:
        classifier_pause.record_pause(db, CFG, 'PROVIDER_AUTH_REJECTED')
    _make_probe_due(test_db)
    row = _row(test_db, message_id)
    row.classification_next_retry_at = utcnow() + timedelta(minutes=5)
    test_db.commit()
    assert not worker.process_one(message_id, provider=lambda *a: decision())
    pause = _pause_meta(test_db)
    assert pause.status == 'running' and pause.meta['probe_lease_until'] is None
    with worker.SessionLocal() as db:
        assert classifier_pause.claim_probe(db, CFG)  # still due: the next sweep can probe


def test_a_paused_sweep_never_probes_with_a_suspended_firms_email(test_db, pipeline):
    from backend.models.tenancy import Firm
    _, _, message_id = pipeline
    with worker.SessionLocal() as db:
        classifier_pause.record_pause(db, CFG, 'PROVIDER_AUTH_REJECTED')
    _make_probe_due(test_db)
    test_db.get(Firm, _row(test_db, message_id).firm_id).status = 'SUSPENDED'
    test_db.commit()
    assert worker.process_pending() == 0
    assert _pause_meta(test_db).meta['probe_lease_until'] is None


def test_new_configuration_is_not_paused(test_db, pipeline):
    with worker.SessionLocal() as db:
        classifier_pause.record_pause(db, CFG, 'PROVIDER_AUTH_REJECTED')
        new_key = SimpleNamespace(**{**vars(CFG), 'api_key': 'another-synthetic-key'})
        assert classifier_pause.active_pause(db, new_key) is None
        assert classifier_pause.active_pause(db, CFG) is not None


def test_retry_is_refused_while_paused(test_db, pipeline, api_client):
    _, _, message_id = pipeline
    row = _row(test_db, message_id)
    row.classification_state, row.classification_error = 'ERROR', 'PROCESSING_FAILED'
    test_db.commit()
    with worker.SessionLocal() as db:
        classifier_pause.record_pause(db, CFG, 'PROVIDER_AUTH_REJECTED')
    path = f'/api/firms/{row.firm_id}/candidates/{row.candidate_id}/inbox-messages/{row.id}/classification/retry'
    result = api_client.post(path, json={'command_id': str(uuid.uuid4()), 'expected_content_revision': row.content_revision,
                                         'expected_result_version': row.classification_version})
    assert result.status_code == 409 and 'paused' in result.text
    assert _row(test_db, message_id).classification_state == 'ERROR'
