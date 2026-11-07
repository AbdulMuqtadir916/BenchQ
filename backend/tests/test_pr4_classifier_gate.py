"""PR 4 T1.1 (DEBUG D-02, D-03): configuration guard and the configuration-scoped pause. Synthetic only."""
from datetime import datetime, timedelta
from types import SimpleNamespace
import uuid

from backend.ai.config import ai_config
from backend.inbox import classification_worker as worker, classifier_pause
from backend.inbox.decider import DeciderError
from backend.models.candidates import InboxMessage
from backend.models.db import JobRun, Setting, utcnow
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
