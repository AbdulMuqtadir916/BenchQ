"""Durable candidate-email classification. Never writes application status or history.

One HTTP attempt per lease; no session/row lock is held across provider I/O.
PENDING rows are the queue, so import/enqueue crashes are recovered by the sweep.
"""
from concurrent.futures import ThreadPoolExecutor
from functools import partial
import time
from datetime import timedelta
import logging
import threading
import time
from types import SimpleNamespace
import uuid

from sqlalchemy import or_, func

from backend.ai.config import ai_config
from backend.analyzer.llm_cost import calc_cost, get_pricing
from backend.analyzer.llm_logger import log_llm_call
from backend.auth.scoping import scoped
from backend.inbox.application_matching import (ai_input, company_aliases, email_parts, has_too_little_text,
                                                matching_application_id, submitted_applications)
from backend.inbox.decider import (DeciderError, build_request, classify, config_identity, decision_value,
                                  is_configured, values_disagree)
from backend.inbox import backfill, classifier_pause
from backend.inbox.decider_categories import CATEGORY_VERSION, CONFIDENCE_THRESHOLD
from backend.inbox.policy import review_reason
from backend.applications.tracking import apply_email_decision, automation_ready, email_history
from backend.inbox.masking import KnownIdentity
from backend.models.candidates import Candidate, CandidateMailbox, InboxMessage
from backend.models.db import Application, ApplicationReview, EmailClassification, JobRun, SessionLocal, utcnow
from backend.models.tenancy import Firm
import logging

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


def _still_sendable(db, message_id, snapshot, token, fingerprint, cfg, probing):
    """The claimed work is still the work to send: the firm isn't suspended, the same mailbox is still connected, the
    email is neither deleted nor hidden nor changed, the switches and settings are as claimed, and no pause began.
    Read fresh, so a change committed meanwhile by another request counts. Raises WORK_INVALIDATED otherwise."""
    db.expire_all()
    row = scoped(db, InboxMessage, snapshot.firm_id).filter_by(id=message_id).first()
    box = _current(db, row) if row else None
    if (not enabled() or not box or box.connected_at != snapshot.generation
            or row.classification_token != token or row.content_revision != snapshot.content_revision
            or config_identity(ai_config('email_classification', db=db)) != fingerprint
            or (not probing and classifier_pause.active_pause(db, cfg) is not None)):
        raise DeciderError('WORK_INVALIDATED')
    return row, box


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
    db.flush()
    from backend.auth.ledger import record_automated
    from backend.applications.postings import posting_job
    title = posting_job(app.posting).title if app is not None and app.posting is not None else None
    record_automated(db, actor_type='AGENT', actor_name='Email classifier', action='CREATE',
                     entity_type='application_review', entity_id=row.id, entity_label=title or 'Candidate inbox',
                     summary=f"Email sent to BDE review ({str(result.reason).replace('_', ' ').lower()})"
                             + (f" for {title}." if title else "."),
                     firm_id=message.firm_id, candidate_id=message.candidate_id)
    return row


def _account(db, cfg, job, firm_id, *, success, duration_ms):
    """Record one dispatched call in AI spend, in the caller's result transaction, exactly once (DEBUG D-15, Q33).

    Every dispatched call gets one llm_call_log row for its firm, failures included (main's AI-spend rule). Its cost is
    the provider's charge (ACTUAL) or OpenRouter price x tokens (ESTIMATED); when neither is known the row's cost is the
    price table's result and the call is also counted as unpriced from job_runs, so it is never silently free.
    """
    meta = dict(job.meta or {})
    if not meta.get('dispatch_started'):
        return
    usage = dict(meta.get('usage') or {})
    tokens = {'input_tokens': int(usage.get('prompt_tokens') or 0),
              'output_tokens': int(usage.get('completion_tokens') or 0)}
    if isinstance(usage.get('cost'), (int, float)) and not isinstance(usage.get('cost'), bool):
        quality, cost = 'ACTUAL', float(usage['cost'])
    elif get_pricing('openrouter', cfg.model) and (tokens['input_tokens'] or tokens['output_tokens']):
        quality, cost = 'ESTIMATED', calc_cost('openrouter', cfg.model, **tokens)
    else:
        quality, cost = 'UNKNOWN', None
    meta['usage'] = {**usage, 'cost_quality': quality}
    row_id = log_llm_call('email_classification', 'openrouter', cfg.model, tokens, duration_ms=duration_ms,
                          success=success, error=meta.get('error_code'), firm_id=firm_id, cost_usd=cost, db=db)
    if row_id:
        meta['llm_call_log_id'] = str(row_id)
    job.meta = meta


def _settle_pause(cfg, outcome):
    """Open the pause (outcome None) or finish a probe, in a separate short transaction."""
    with SessionLocal() as db:
        if outcome is None:
            classifier_pause.record_pause(db, cfg, 'PROVIDER_AUTH_REJECTED')
        else:
            classifier_pause.finish_probe(db, cfg, outcome)


def _gate(db, cfg):
    """'go', 'probe' (this caller holds the probe lease) or None (do not claim anything)."""
    if not is_configured(cfg):
        return None
    if classifier_pause.active_pause(db, cfg) is None:
        return 'go'
    return 'probe' if classifier_pause.claim_probe(db, cfg) else None


def _unclaimed(cfg, probing):
    """No email was claimed: a probe lease this caller holds goes back unused, so the next sweep can test the key."""
    if probing:
        with SessionLocal() as db:
            classifier_pause.release_probe(db, cfg)
    return False


def _known_identity(db, row, mailbox):
    """What the masking must remove for this email, read with the content it is sent with. Never stored or logged."""
    candidate = scoped(db, Candidate, row.firm_id).filter_by(id=row.candidate_id).first()
    values = (candidate.email, candidate.phone, candidate.linkedin_url) if candidate else ()
    return KnownIdentity(candidate_name=candidate.full_name if candidate else '',
                         candidate_values=tuple(v for v in (*values, mailbox.address) if v),
                         sender_name=row.from_name or '', sender_email=row.from_email or '')


def process_one(message_id, *, provider=None, aliases=None):
    if not enabled():
        return False
    # Configuration and pause are checked before any claim: a missing setting or a rejected key leaves mail PENDING
    # with its attempts untouched (DEBUG D-02, D-03).
    with SessionLocal() as db:
        cfg = ai_config('email_classification', db=db)
        gate = _gate(db, cfg)
    if gate is None:
        return False
    probing = gate == 'probe'
    with SessionLocal() as db:
        message = db.query(InboxMessage).filter_by(id=message_id).with_for_update(skip_locked=True).first()
        if not message or not _current(db, message):
            return _unclaimed(cfg, probing)
        now = utcnow()
        if message.classification_state not in {'PENDING', 'PROCESSING'}:
            return _unclaimed(cfg, probing)
        if (message.classification_state == 'PROCESSING' and message.classification_lease_until
                and message.classification_lease_until > now):
            return _unclaimed(cfg, probing)
        if message.classification_next_retry_at and message.classification_next_retry_at > now:
            return _unclaimed(cfg, probing)
        if message.classification_attempts >= MAX_ATTEMPTS:
            message.classification_state = 'ERROR'
            message.classification_error = 'RETRY_EXHAUSTED'
            db.commit()
            logger.warning("Email %s classification gave up after %d attempts", message.id, message.classification_attempts)
            return _unclaimed(cfg, probing)
        mailbox = _current(db, message)
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
    duration_ms = 0
    try:
        with SessionLocal() as db:
            # Immediate dispatch check after claim: no stale provider send after disconnect/erase/off.
            row, box = _still_sendable(db, message_id, snapshot, token, fingerprint, cfg, probing)
            parts = email_parts(row)
            subject, body = parts.subject, parts.current
            known = _known_identity(db, row, box)
            text = ai_input(parts)
            send = provider
            if send is None:
                # Masked before the dispatch is marked: a masking failure sends nothing, so it is never counted as a
                # possible charge and never settles a probe. It retries with backoff; setup recovery requeues it.
                try:
                    request = build_request(subject, text, cfg, known)
                except Exception:
                    raise DeciderError('MASKING_FAILED', retryable=True) from None
                send = partial(classify, request=request)
            # Checked again just before the dispatch is marked (Abdul's review on #127, P1): masking can take seconds,
            # and a disconnect, an erasure or a switch turned off meanwhile must stop the send, not be found afterwards.
            _still_sendable(db, message_id, snapshot, token, fingerprint, cfg, probing)
            # Committed before the request: "dispatch started; charge unknown" (DEBUG D-15). A crash after this
            # point is counted as possibly charged, never as free.
            started = scoped(db, JobRun, snapshot.firm_id).filter_by(id=snapshot.job_id).one()
            started.meta = {**started.meta, 'dispatch_started': True}
            db.commit()
        sent_at = time.monotonic()
        try:
            result = send(subject, text, cfg, known)
        finally:
            duration_ms = int((time.monotonic() - sent_at) * 1000)
    except DeciderError as exc:
        error = exc
    except Exception:
        # No exception text: it may include a key, decrypted data or provider request.
        error = DeciderError('PROCESSING_FAILED')
    with SessionLocal() as db:
        row = scoped(db, InboxMessage, snapshot.firm_id).filter_by(id=message_id).with_for_update().first()
        job = scoped(db, JobRun, snapshot.firm_id).filter_by(id=snapshot.job_id).with_for_update().one()
        if job.status != 'running':
            # Already finalized: never write a second result or cost row for one attempt.
            db.rollback()
            return False
        job.status = 'failed' if error else 'completed'
        job.finished_at = utcnow()
        job.meta = {**job.meta, 'usage': result.usage if result else error.usage,
                    'error_code': error.code if error else None}
        _account(db, cfg, job, snapshot.firm_id, success=error is None,
                 duration_ms=duration_ms)
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
        rejected = bool(error and error.code == 'PROVIDER_AUTH_REJECTED')
        inconclusive_probe = bool(probing and error and error.retryable)
        if error and (error.code == 'WORK_INVALIDATED' or rejected or inconclusive_probe):
            # Not this email's fault: release it without spending an attempt.
            row.classification_attempts = max(0, row.classification_attempts - 1)
            row.classification_state = 'PENDING'
            row.classification_next_retry_at = None
            row.classification_error = None
            job.meta = {**job.meta, 'discarded': error.code == 'WORK_INVALIDATED', 'released': True}
            db.commit()
            if rejected and not probing:
                _settle_pause(cfg, None)
                logger.warning('Candidate email classifier paused: provider rejected the credentials.')
            elif probing:
                _settle_pause(cfg, 'auth' if rejected else 'inconclusive')
            return False
        if probing:
            # Any other answer proves the credentials are accepted again (own session: the email stays locked here).
            _settle_pause(cfg, 'cleared')
        if error:
            retry = error.retryable and row.classification_attempts < MAX_ATTEMPTS
            row.classification_state = 'PENDING' if retry else 'ERROR'
            row.classification_next_retry_at = utcnow() + timedelta(seconds=30 * 2 ** (row.classification_attempts - 1)) if retry else None
            row.classification_error = error.code
            job.meta = {**job.meta, 'retry_exhausted': not retry}
            db.commit()
            logger.warning("Email %s classification failed: %s (attempt %d, %s)", message_id, error.code,
                           row.classification_attempts, 'will retry' if row.classification_state == 'PENDING' else 'gave up')
            return False
        # Snapshot match/app revision after I/O; never trust a stale pre-call match.
        had_application_link = row.application_id is not None
        app_id = row.application_id
        if app_id is None:
            app_id = matching_application_id(db, box, row, allow_thread=row.sender_auth_result == 'PASS', aliases=aliases)
        app = submitted_applications(db, row.firm_id, row.candidate_id).filter_by(id=app_id).with_for_update().first() if app_id else None
        # Existing human link is not overwritten by model-derived identity.
        if row.application_id is None and app:
            row.application_id = app.id
        # Signals that the answer itself is uncertain come first and are never hidden as Other (DEBUG D-01, D-04).
        uncertain = ('FORWARDED_EMAIL' if parts.is_forward
                     else 'INSUFFICIENT_CONTENT' if has_too_little_text(parts)
                     else 'CONFIDENCE_DISAGREEMENT'
                     if values_disagree(result.confidence, result.probabilities, result.category) else None)
        value = decision_value(result.confidence, result.probabilities, result.category)
        confident_other = uncertain is None and result.category == 'other' and value >= CONFIDENCE_THRESHOLD
        reason = (uncertain or ('OTHER' if confident_other else 'LOW_CONFIDENCE' if result.category == 'other'
                                else review_reason(app, row, result, body)))
        if app is not None and uncertain is None and not confident_other and reason != 'SAME_STAGE':
            # Reclassification never re-applies an email (DEBUG D-11 replay cases).
            # Same category as the current stage: nothing to decide. Otherwise a person decides.
            history = email_history(db, app, row)
            if history and result.category == app.status:
                reason = 'SAME_STAGE'
            elif history == 'UNDONE':
                reason = 'AUTOMATIC_CHANGE_UNDONE'
            elif history == 'APPLIED':
                reason = 'EMAIL_ALREADY_APPLIED'
        # Every check passed and automation is switched on, approved and started: write the status first (PR 4);
        # classification rows are immutable, so the row is inserted once with its final outcome.
        record_id = uuid.uuid4()
        # Historical mail (imported while classification was off) can only create a review (D-23).
        if (reason == 'AUTO_STATUS_DISABLED' and app is not None and automation_ready(row)
                and not backfill.is_historical(db, row.id)
                and apply_email_decision(db, app, row, record_id, target=result.category)):
            reason = 'AUTO_APPLIED'
        record = EmailClassification(id=record_id, firm_id=row.firm_id, candidate_id=row.candidate_id,
            inbox_message_id=row.id, application_id=app.id if app else None,
            application_revision=app.status_revision if app else None,
            result_version=snapshot.result_version, content_revision=row.content_revision,
            category=result.category, confidence=result.confidence, probabilities=result.probabilities,
            provider=cfg.provider, model=cfg.model, prompt_version=fingerprint,
            category_version=CATEGORY_VERSION, sender_auth_result=row.sender_auth_result,
            receive_time_verified=row.receive_time_verified,
            outcome=('OTHER' if confident_other else 'AUTO_APPLIED' if reason == 'AUTO_APPLIED'
                     else 'NO_CHANGE' if reason == 'SAME_STAGE' else 'REVIEW'), reason=reason)
        db.add(record)
        db.flush()
        # An existing pending human business review must remain accessible until human resolution.
        pending = scoped(db, ApplicationReview, row.firm_id).filter_by(inbox_message_id=row.id, state='PENDING').first()
        if confident_other and pending is None and not had_application_link:
            # Shown in the Inbox as Irrelevant (decided 2026-11-07, replacing hide-and-encrypt); still erased after
            # 30 days once the purge switches are on (retention.purge_due).
            row.other_purge_after = utcnow() + timedelta(days=30)
        else:
            # No longer Irrelevant (a newer result went to review, applied, or was the same stage): an earlier purge
            # date must not erase it later, e.g. once a BDE dismisses its review (Abdul's review on #127).
            row.other_purge_after = None
            if not confident_other and reason not in ('SAME_STAGE', 'AUTO_APPLIED'):
                _add_review(db, row, app, record)
        row.classification_state = 'DONE'
        row.classification_version = snapshot.result_version
        row.classification_error = None
        row.classification_next_retry_at = None
        db.commit()
        logger.info("Email %s classified: %s", message_id, row.classification_state)
    return True


def classify_all(ids, aliases, concurrency) -> int:
    """Classify the emails, up to `concurrency` at once; returns how many finished.

    The AI call is the slow part and runs outside any database lock; process_one claims each email under its own row
    lock (skip_locked), so two workers never take the same one, and an application's status is written under its own
    row lock. concurrency 1 is the earlier one-at-a-time behaviour.
    """
    workers = min(concurrency, len(ids))
    if workers <= 1:
        return sum(process_one(identity, aliases=aliases) for identity in ids)
    with ThreadPoolExecutor(max_workers=workers, thread_name_prefix='candidate-email-call') as pool:
        return sum(pool.map(lambda identity: process_one(identity, aliases=aliases), ids))


def process_pending(*, limit=None):
    from backend import config
    limit = config.CANDIDATE_EMAIL_SWEEP_LIMIT if limit is None else limit
    if not enabled():
        return 0
    with SessionLocal() as db:
        cfg = ai_config('email_classification', db=db)
        if not is_configured(cfg):
            logger.warning('Candidate email classification is switched on but not configured; mail stays queued.')
            return 0
        if classifier_pause.active_pause(db, cfg) is not None:
            limit = 1  # a paused classifier sends at most one probe email
        else:
            # Earlier mail joins the normal queue in bounded, once-only batches (both switches default off).
            backfill.recover_setup_failures(db)
            backfill.queue_historical(db)
        rows = db.query(InboxMessage.id).filter(
            InboxMessage.deleted_at.is_(None), InboxMessage.hidden_at.is_(None),
            InboxMessage.classification_state.in_(['PENDING', 'PROCESSING']),
            or_(InboxMessage.classification_lease_until.is_(None), InboxMessage.classification_lease_until <= utcnow()),
            or_(InboxMessage.classification_next_retry_at.is_(None), InboxMessage.classification_next_retry_at <= utcnow()),
        ).join(CandidateMailbox, InboxMessage.mailbox_id == CandidateMailbox.id).filter(
            CandidateMailbox.status == 'CONNECTED', func.lower(func.trim(InboxMessage.source_address)) == func.lower(func.trim(CandidateMailbox.address)),
            # The rest of `_current` too, before the limit: a paused sweep's one probe must be an email it can claim.
            CandidateMailbox.candidate_id == InboxMessage.candidate_id, CandidateMailbox.refresh_token_ciphertext.isnot(None),
        ).join(Firm, Firm.id == InboxMessage.firm_id).filter(Firm.status != 'SUSPENDED').order_by(
            InboxMessage.received_at, InboxMessage.id).limit(min(limit, 100)).all()
        aliases = company_aliases(db) if rows else {}
    done = classify_all([identity for (identity,) in rows], aliases, config.CANDIDATE_EMAIL_CLASSIFY_CONCURRENCY)
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
