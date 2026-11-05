"""Durable candidate-email classification. Never writes application status or history.

One HTTP attempt per lease; no session/row lock is held across provider I/O.
PENDING rows are the queue, so import/enqueue crashes are recovered by the sweep.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
import logging
import threading
import time
from types import SimpleNamespace
import uuid

from sqlalchemy import or_, func

from backend.ai.config import ai_config
from backend.auth.scoping import scoped
from backend.inbox.application_matching import classification_text, matching_application_id, submitted_applications
from backend.inbox.decider import DeciderError, classify, config_identity
from backend.inbox.decider_categories import CATEGORY_VERSION, CONFIDENCE_THRESHOLD
from backend.inbox.policy import review_reason
from backend.inbox.google_oauth import encrypt_content
from backend.models.candidates import CandidateMailbox, InboxMessage
from backend.models.db import Application, ApplicationReview, EmailClassification, JobRun, SessionLocal, utcnow
from backend.models.tenancy import Firm

logger = logging.getLogger("jobnavigator.inbox")
MAX_ATTEMPTS = 3
_EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix='candidate-email')
_WAKE_LOCK = threading.Lock()
_FUTURE = None


def enabled():
    from backend import config
    return config.CANDIDATE_EMAIL_CLASSIFICATION_ENABLED and config.CANDIDATE_EMAIL_REAL_MAIL_APPROVED


def _current(db, message):
    mailbox = scoped(db, CandidateMailbox, message.firm_id).filter_by(
        id=message.mailbox_id, candidate_id=message.candidate_id).first()
    firm = db.get(Firm, message.firm_id)
    return (mailbox if mailbox and firm and firm.status != 'SUSPENDED'
            and mailbox.status == 'CONNECTED' and mailbox.refresh_token_ciphertext
            and message.deleted_at is None and message.hidden_at is None
            and message.source_address.strip().lower() == mailbox.address.strip().lower() else None)


def _add_review(db, message, app, result):
    query = scoped(db, ApplicationReview, message.firm_id).filter_by(
        inbox_message_id=message.id, candidate_id=message.candidate_id)
    # Preserve human work/results; never overwrite an existing pending/resolved decision on rerun.
    existing = query.filter_by(state='PENDING').first()
    if existing:
        return existing
    row = ApplicationReview(firm_id=message.firm_id, candidate_id=message.candidate_id,
        application_id=app.id if app else None, application_revision=app.status_revision if app else None,
        inbox_message_id=message.id, classification_id=result.id, classification_version=result.result_version, reason=result.reason)
    db.add(row)
    return row


def _log_ai_call(cfg, result, error, snapshot, duration_ms):
    """One llm_call_log row per provider call, with the firm, as every other AI feature writes (Q33)."""
    from backend.analyzer.llm_logger import log_llm_call
    usage = (result.usage if result else error.usage) or {}
    log_llm_call('email_classification', cfg.provider, cfg.model,
                 {'input_tokens': int(usage.get('prompt_tokens', 0)), 'output_tokens': int(usage.get('completion_tokens', 0))},
                 duration_ms=duration_ms, success=error is None,   # job_id is a job posting's: none here
                 error=error.code if error else None, firm_id=snapshot.firm_id)


def process_one(message_id, *, provider=None):
    if not enabled():
        return False
    with SessionLocal() as db:
        message = db.query(InboxMessage).filter_by(id=message_id).with_for_update(skip_locked=True).first()
        if not message or not _current(db, message):
            return False
        now = utcnow()
        if message.classification_state not in {'PENDING', 'PROCESSING'}:
            return False
        if (message.classification_state == 'PROCESSING' and message.classification_lease_until
                and message.classification_lease_until > now):
            return False
        if message.classification_next_retry_at and message.classification_next_retry_at > now:
            return False
        if message.classification_attempts >= MAX_ATTEMPTS:
            message.classification_state = 'ERROR'
            message.classification_error = 'RETRY_EXHAUSTED'
            db.commit()
            logger.warning("Email %s classification gave up after %d attempts", message.id, message.classification_attempts)
            return False
        mailbox = _current(db, message)
        cfg = ai_config('email_classification', db=db)
        fingerprint = config_identity(cfg)
        token = uuid.uuid4()
        message.classification_token = token
        message.classification_state = 'PROCESSING'
        message.classification_attempts += 1
        message.classification_lease_until = now + timedelta(minutes=2)
        message.classification_error = None
        job = JobRun(firm_id=message.firm_id, job_type='candidate_email_classification',
                     trigger='scheduler', status='running', meta={
                         'message_id': str(message.id), 'candidate_id': str(message.candidate_id),
                         'attempt': message.classification_attempts, 'cost_quality': 'UNKNOWN'})
        db.add(job)
        db.flush()
        snapshot = SimpleNamespace(firm_id=message.firm_id, candidate_id=message.candidate_id,
            mailbox_id=mailbox.id, address=mailbox.address, generation=mailbox.connected_at,
            content_revision=message.content_revision, result_version=message.classification_version + 1,
            job_id=job.id, token=token)
        db.commit()
    result = None
    error = None
    called_at = None
    try:
        with SessionLocal() as db:
            # Immediate dispatch check after claim: no stale provider send after disconnect/erase/off.
            row = scoped(db, InboxMessage, snapshot.firm_id).filter_by(id=message_id).first()
            box = _current(db, row) if row else None
            if (not enabled() or not box or box.connected_at != snapshot.generation
                    or row.classification_token != token or row.content_revision != snapshot.content_revision
                    or config_identity(ai_config('email_classification', db=db)) != fingerprint):
                raise DeciderError('WORK_INVALIDATED')
            subject, body = classification_text(row)
        called_at = time.monotonic()
        result = (provider or classify)(subject, body, cfg)
    except DeciderError as exc:
        error = exc
    except Exception:
        # No exception text: it may include a key, decrypted data or provider request.
        error = DeciderError('PROCESSING_FAILED')
    # The provider was called: count it in AI spend (Q33). A classifier that isn't set up refuses before sending.
    if called_at is not None and not (error and error.code == 'CLASSIFIER_NOT_CONFIGURED'):
        _log_ai_call(cfg, result, error, snapshot, int((time.monotonic() - called_at) * 1000))
    with SessionLocal() as db:
        row = scoped(db, InboxMessage, snapshot.firm_id).filter_by(id=message_id).with_for_update().first()
        job = scoped(db, JobRun, snapshot.firm_id).filter_by(id=snapshot.job_id).one()
        job.status = 'failed' if error else 'completed'
        job.finished_at = utcnow()
        job.meta = {**job.meta, 'usage': result.usage if result else error.usage,
                    'error_code': error.code if error else None}
        box = _current(db, row) if row else None
        valid = (enabled() and box and box.connected_at == snapshot.generation
                 and row.classification_token == token and row.content_revision == snapshot.content_revision
                 and config_identity(ai_config('email_classification', db=db)) == fingerprint)
        if not valid:
            if row and row.classification_token == token:
                row.classification_attempts = max(0, row.classification_attempts - 1)
                row.classification_next_retry_at = None
                row.classification_error = None
                row.classification_state = 'PENDING' if row.deleted_at is None else 'EXCLUDED'
                row.classification_token = None
                row.classification_lease_until = None
            job.meta = {**job.meta, 'discarded': True}
            db.commit()
            return False
        row.classification_token = None
        row.classification_lease_until = None
        if error and error.code == 'WORK_INVALIDATED':
            row.classification_attempts = max(0, row.classification_attempts - 1)
            row.classification_state = 'PENDING'
            row.classification_next_retry_at = None
            row.classification_error = None
            job.meta = {**job.meta, 'discarded': True}
            db.commit()
            return False
        if error:
            retry = error.retryable and row.classification_attempts < MAX_ATTEMPTS
            row.classification_state = 'PENDING' if retry else 'ERROR'
            row.classification_next_retry_at = utcnow() + timedelta(seconds=30 * 2 ** (row.classification_attempts - 1)) if retry else None
            row.classification_error = error.code
            job.meta = {**job.meta, 'retry_exhausted': not retry}
            db.commit()
            logger.warning("Email %s classification failed: %s (attempt %d, %s)", message_id, error.code,
                           row.classification_attempts, 'will retry' if retry else 'gave up')
            return False
        # Snapshot match/app revision after I/O; never trust a stale pre-call match.
        had_application_link = row.application_id is not None
        app_id = row.application_id
        if app_id is None:
            app_id = matching_application_id(db, box, row, allow_thread=row.sender_auth_result == 'PASS')
        app = submitted_applications(db, row.firm_id, row.candidate_id).filter_by(id=app_id).with_for_update().first() if app_id else None
        if app and app.applied_at is None and app.submitted_by_user_id is None:
            app = None
        # Existing human link is not overwritten by model-derived identity.
        if row.application_id is None and app:
            row.application_id = app.id
        confident_other = result.category == 'other' and result.confidence >= CONFIDENCE_THRESHOLD
        reason = 'OTHER' if confident_other else 'LOW_CONFIDENCE' if result.category == 'other' else review_reason(app, row, result, body)
        record = EmailClassification(firm_id=row.firm_id, candidate_id=row.candidate_id,
            inbox_message_id=row.id, application_id=app.id if app else None,
            application_revision=app.status_revision if app else None,
            result_version=snapshot.result_version, content_revision=row.content_revision,
            category=result.category, confidence=result.confidence, probabilities=result.probabilities,
            provider=cfg.provider, model=cfg.model, prompt_version=fingerprint,
            category_version=CATEGORY_VERSION, sender_auth_result=row.sender_auth_result,
            receive_time_verified=row.receive_time_verified,
            outcome='OTHER' if confident_other else 'NO_CHANGE' if reason == 'SAME_STAGE' else 'REVIEW', reason=reason)
        db.add(record)
        db.flush()
        # An existing pending human business review must remain accessible until human resolution.
        pending = scoped(db, ApplicationReview, row.firm_id).filter_by(inbox_message_id=row.id, state='PENDING').first()
        if confident_other and pending is None and not had_application_link:
            row.hidden_at = utcnow()
            row.other_purge_after = row.hidden_at + timedelta(days=30)
            for field in ('subject', 'from_name', 'from_email'):
                setattr(row, field, encrypt_content(getattr(row, field)))
        elif not confident_other and reason != 'SAME_STAGE':
            _add_review(db, row, app, record)
        row.classification_state = 'DONE'
        row.classification_version = snapshot.result_version
        row.classification_error = None
        row.classification_next_retry_at = None
        db.commit()
        logger.info("Email %s classified: %s", message_id, record.outcome)
    return True


def process_pending(*, limit=20):
    if not enabled():
        return 0
    with SessionLocal() as db:
        rows = db.query(InboxMessage.id).filter(
            InboxMessage.deleted_at.is_(None), InboxMessage.hidden_at.is_(None),
            InboxMessage.classification_state.in_(['PENDING', 'PROCESSING']),
            or_(InboxMessage.classification_lease_until.is_(None), InboxMessage.classification_lease_until <= utcnow()),
            or_(InboxMessage.classification_next_retry_at.is_(None), InboxMessage.classification_next_retry_at <= utcnow()),
        ).join(CandidateMailbox, InboxMessage.mailbox_id == CandidateMailbox.id).filter(
            CandidateMailbox.status == 'CONNECTED', func.lower(func.trim(InboxMessage.source_address)) == func.lower(func.trim(CandidateMailbox.address)),
        ).order_by(InboxMessage.received_at, InboxMessage.id).limit(min(limit, 100)).all()
    done = sum(process_one(identity) for (identity,) in rows)
    if rows:
        logger.info("Email classification: %d of %d pending emails classified", done, len(rows))
    return done


def wake_worker():
    global _FUTURE
    if not enabled():
        return
    with _WAKE_LOCK:
        if _FUTURE is None or _FUTURE.done():
            _FUTURE = _EXECUTOR.submit(process_pending)
