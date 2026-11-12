"""PR 4 T7.1 / T7.3 (DEBUG D-27, D-23): setup-failure recovery and historical classification. Synthetic only."""
from datetime import timedelta
from types import SimpleNamespace

import pytest

from backend import config
from backend.inbox import backfill, classification_worker as worker, classifier_pause
from backend.models.candidates import CandidateMailbox, InboxMessage
from backend.models.db import Application, ApplicationReview, ApplicationStatusEvent, EmailClassification, JobRun, utcnow
from backend.models.tenancy import LedgerEntry
from backend.tests.test_pr3_matching import matching_case, mailbox_case, email  # noqa: F401 (fixtures)
from backend.tests.test_pr3_pipeline import decision, pipeline  # noqa: F401 (fixture)

CFG = SimpleNamespace(provider='openrouter', model='synthetic-test-only', api_key='synthetic-not-real',
                      prompts={}, preset_id=None, preset_version=None)


@pytest.fixture
def fake_provider(monkeypatch):
    calls = []
    monkeypatch.setattr(worker, 'build_request', lambda *args, **kwargs: {})
    monkeypatch.setattr(backfill, 'masking_ready', lambda: True)
    monkeypatch.setattr(worker, 'classify', lambda subject, body, cfg, known=None, **_: calls.append(subject) or decision('screening_call', .95))
    return calls


def _row(test_db, message_id):
    test_db.expire_all()
    return test_db.get(InboxMessage, message_id)


def _set(test_db, message_id, **fields):
    test_db.expire_all()
    row = test_db.get(InboxMessage, message_id)
    for key, value in fields.items():
        setattr(row, key, value)
    test_db.commit()
    return row


def _summaries(test_db, word):
    return test_db.query(LedgerEntry).filter(LedgerEntry.summary.contains(word)).count()


# ── setup-failure recovery ─────────────────────────────────────────────────────────────────────────────────────

def test_setup_failure_is_recovered_once_and_classified(test_db, pipeline, fake_provider, monkeypatch):
    _, _, message_id = pipeline
    _set(test_db, message_id, classification_state='ERROR', classification_error='CLASSIFIER_NOT_CONFIGURED', classification_attempts=1)
    monkeypatch.setattr(config, 'CANDIDATE_EMAIL_SETUP_RECOVERY_ENABLED', True)
    assert worker.process_pending() == 1
    assert _row(test_db, message_id).classification_state == 'DONE'
    assert test_db.get(JobRun, backfill.marker_id(backfill.RECOVERY, message_id)) is not None
    assert _summaries(test_db, 'not set up') == 1


def test_a_repeated_setup_failure_is_not_recovered_again(test_db, pipeline, fake_provider, monkeypatch):
    _, _, message_id = pipeline
    _set(test_db, message_id, classification_state='ERROR', classification_error='PROVIDER_AUTH_REJECTED', classification_attempts=1)
    monkeypatch.setattr(config, 'CANDIDATE_EMAIL_SETUP_RECOVERY_ENABLED', True)
    assert worker.process_pending() == 1
    _set(test_db, message_id, classification_state='ERROR', classification_error='PROVIDER_AUTH_REJECTED')  # fails again
    assert worker.process_pending() == 0
    row = _row(test_db, message_id)
    assert (row.classification_state, row.classification_error) == ('ERROR', 'PROVIDER_AUTH_REJECTED')  # manual Retry remains
    assert _summaries(test_db, 'not set up') == 1


@pytest.mark.parametrize('blocker', ['switch_off', 'disconnected', 'paused', 'other_error', 'masking_unavailable'])
def test_recovery_is_skipped_when_it_must_not_run(test_db, pipeline, fake_provider, monkeypatch, blocker):
    _, mailbox_id, message_id = pipeline
    _set(test_db, message_id, classification_state='ERROR', classification_attempts=1,
         classification_error='INVALID_RESPONSE' if blocker == 'other_error' else 'CLASSIFIER_NOT_CONFIGURED')
    monkeypatch.setattr(config, 'CANDIDATE_EMAIL_SETUP_RECOVERY_ENABLED', blocker != 'switch_off')
    if blocker == 'disconnected':
        test_db.get(CandidateMailbox, mailbox_id).status = 'DISCONNECTED'
        test_db.commit()
    if blocker == 'paused':
        with worker.SessionLocal() as db:
            classifier_pause.record_pause(db, CFG, 'PROVIDER_AUTH_REJECTED')
    if blocker == 'masking_unavailable':  # CodeRabbit #127: no recovery is spent while masking cannot run
        monkeypatch.setattr(backfill, 'masking_ready', lambda: False)
    worker.process_pending()
    assert _row(test_db, message_id).classification_state == 'ERROR'
    assert fake_provider == [] and test_db.get(JobRun, backfill.marker_id(backfill.RECOVERY, message_id)) is None


def test_the_counts_command_runs_and_counts_by_candidate(test_db, pipeline):
    """CodeRabbit #127: `full_name` is read off the résumé, not a column; the command failed before printing."""
    _, _, message_id = pipeline
    _set(test_db, message_id, classification_state='ERROR', classification_error='CLASSIFIER_NOT_CONFIGURED')
    lines = backfill.report(test_db)
    assert lines[0].startswith('setup_recovery: 1 ') and lines[-1] == f'batch per sweep: {backfill.BATCH}'


# ── historical classification ──────────────────────────────────────────────────────────────────────────────────

def test_historical_mail_is_classified_but_only_reviewed(test_db, pipeline, fake_provider, monkeypatch):
    app_id, _, message_id = pipeline
    _set(test_db, message_id, classification_state='NOT_QUEUED')
    for name, value in (('CANDIDATE_EMAIL_AUTO_STATUS_ENABLED', True), ('CANDIDATE_EMAIL_AUTOMATION_APPROVED', True),
                        ('CANDIDATE_EMAIL_AUTOMATION_START_AT', (utcnow() - timedelta(days=30)).isoformat()),
                        ('CANDIDATE_EMAIL_HISTORICAL_ENABLED', True)):
        monkeypatch.setattr(config, name, value)
    assert worker.process_pending() == 1
    test_db.expire_all()
    assert test_db.get(Application, app_id).status == 'applied'  # confirmed status preserved, automation notwithstanding
    assert test_db.query(ApplicationStatusEvent).filter_by(application_id=app_id).count() == 0
    assert test_db.query(EmailClassification).one().outcome == 'REVIEW'
    assert test_db.query(ApplicationReview).filter_by(inbox_message_id=message_id).count() == 1
    assert backfill.is_historical(test_db, message_id)
    assert _summaries(test_db, 'earlier emails') == 1


def test_historical_batches_are_oldest_first_bounded_and_once_only(test_db, pipeline, monkeypatch):
    from backend.tests.test_candidate_mailbox import email as make_email
    _, mailbox_id, first_id = pipeline
    box = test_db.get(CandidateMailbox, mailbox_id)
    source = test_db.get(InboxMessage, first_id).source_address
    ids = [first_id]
    for n in range(2):
        extra = make_email(test_db, box, key=f'historical-{n}')
        extra.source_address = source
        test_db.commit()
        ids.append(extra.id)
    for age, message_id in zip((1, 3, 2), ids):  # days ago: oldest is ids[1], then ids[2]
        _set(test_db, message_id, classification_state='NOT_QUEUED', received_at=utcnow() - timedelta(days=age))
    monkeypatch.setattr(config, 'CANDIDATE_EMAIL_HISTORICAL_ENABLED', True)
    with worker.SessionLocal() as db:
        assert backfill.queue_historical(db, limit=2) == 2
    states = {message_id: _row(test_db, message_id).classification_state for message_id in ids}
    assert states == {ids[1]: 'PENDING', ids[2]: 'PENDING', first_id: 'NOT_QUEUED'}
    _set(test_db, ids[1], classification_state='NOT_QUEUED')  # even if it were reset, it is never queued twice
    with worker.SessionLocal() as db:
        assert backfill.queue_historical(db, limit=5) == 1  # only the one never queued
    assert _row(test_db, ids[1]).classification_state == 'NOT_QUEUED'


def test_disconnected_historical_mail_is_excluded_and_counted(test_db, pipeline, monkeypatch):
    _, mailbox_id, message_id = pipeline
    _set(test_db, message_id, classification_state='NOT_QUEUED')
    test_db.get(CandidateMailbox, mailbox_id).status = 'DISCONNECTED'
    test_db.commit()
    monkeypatch.setattr(config, 'CANDIDATE_EMAIL_HISTORICAL_ENABLED', True)
    with worker.SessionLocal() as db:
        counts = backfill.eligible_counts(db)
        assert backfill.queue_historical(db) == 0
    assert counts['historical'] == {} and sum(counts['excluded_disconnected'].values()) == 1
    assert _row(test_db, message_id).classification_state == 'NOT_QUEUED'
