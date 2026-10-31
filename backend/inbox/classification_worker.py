"""Classify synced candidate mail and apply only fresh, unambiguous status decisions."""
from __future__ import annotations

from datetime import timedelta

from sqlalchemy import or_

from backend.applications.tracking import request_review
from backend.config import (OPENROUTER_API_KEY, CANDIDATE_EMAIL_AUTO_STATUS_ENABLED,
                            CANDIDATE_EMAIL_CLASSIFICATION_ENABLED)
from backend.inbox.decider import DeciderError, classify
from backend.inbox.decider_categories import CATEGORY_TO_STATUS, CATEGORY_VERSION, CONFIDENCE_THRESHOLD, MODEL_ID
from backend.inbox.application_matching import matching_application_id
from backend.models.candidates import CandidateMailbox, FavoriteJob, InboxMessage
from backend.models.db import (Application, ApplicationReview, ApplicationStatusEvent,
                               EmailClassification, SessionLocal, utcnow)
from backend.auth.scoping import scoped

# The product said each category maps directly to its corresponding status and
# this is not one mandatory linear sequence. Fresh, uniquely matched email can
# therefore set any of the ten mapped statuses; confidence and stale/manual
# precedence checks remain the gates.
_LEASE_MINUTES = 15
_MAX_ATTEMPTS = 3
_BATCH = 50


def _allowed_auto_transition(current: str, target: str) -> bool:
    return target in CATEGORY_TO_STATUS.values()


def _apply_auto_status(db, app: Application, target: str, message: InboxMessage,
                       classification: EmailClassification) -> bool:
    now = utcnow()
    if app.applied_at and message.received_at < app.applied_at:
        return False
    if app.last_manual_change_at and app.last_manual_change_at > message.received_at:
        return False
    if app.status_effective_at and app.status_effective_at > message.received_at:
        return False
    if not _allowed_auto_transition(app.status, target):
        return False
    if app.status == target:
        app.status_effective_at = message.received_at
        classification.outcome = "NO_CHANGE"
        return True
    old_status = app.status
    revision = app.status_revision + 1
    transition = {"from": old_status, "to": target, "at": now.isoformat(),
                  "source": "email_classifier", "actor_user_id": None,
                  "email_id": str(message.id), "classification_id": str(classification.id),
                  "revision": revision}
    app.status = target
    app.status_revision = revision
    app.status_effective_at = message.received_at
    app.updated_at = now
    app.status_transitions = [*(app.status_transitions or []), transition]
    if old_status == "saved":
        app.applied_at = message.received_at
        # A machine classification does not claim that the BDE submitted the form.
    favorite = scoped(db, FavoriteJob, app.firm_id).filter_by(
        candidate_id=app.candidate_id, job_id=app.job_id).first()
    if favorite:
        db.delete(favorite)
    db.add(ApplicationStatusEvent(
        firm_id=app.firm_id, candidate_id=app.candidate_id, application_id=app.id,
        from_status=old_status, to_status=target, actor_user_id=None,
        source="email_classifier", occurred_at=now, revision=revision,
        original_payload=transition,
    ))
    from backend.auth.ledger import record_automated
    record_automated(db, actor_type="AGENT", actor_name="Email classifier", action="STATE_CHANGE",
        entity_type="application", entity_id=app.id, entity_label="Application",
        summary=f"Email classification changed application status: {old_status} → {target}.",
        firm_id=app.firm_id, candidate_id=app.candidate_id, at=now)
    classification.outcome = "AUTO_APPLIED"
    return True


def _classify_one(db, message_id) -> bool:
    message = db.query(InboxMessage).filter_by(id=message_id).with_for_update(skip_locked=True).first()
    if message is None:
        return False
    now = utcnow()
    stale_lease = now - timedelta(minutes=_LEASE_MINUTES)
    if message.classification_state == "PROCESSING" and message.classification_lease_at and message.classification_lease_at > stale_lease:
        return False
    if message.classification_state not in {"PENDING", "PROCESSING"}:
        return False
    mailbox = scoped(db, CandidateMailbox, message.firm_id).filter_by(
        id=message.mailbox_id, candidate_id=message.candidate_id).first()
    if mailbox is None:
        return False
    # Identity matching precedes and is independent of the status classifier.
    # Persist it with the result only after revalidation, without holding locks
    # during the provider request or overwriting a concurrent BDE link.
    matched_id = matching_application_id(db, mailbox, message) if not message.application_id else None
    message.classification_state = "PROCESSING"
    message.classification_lease_at = now
    message.classification_attempts += 1
    db.commit()  # Release the row lock while calling the model provider.
    message = db.query(InboxMessage).filter_by(id=message_id).first()
    try:
        result = classify(message.subject, message.body or message.snippet)
    except DeciderError as exc:
        message.classification_error = str(exc)
        message.classification_state = "PENDING" if exc.retryable and message.classification_attempts < _MAX_ATTEMPTS else "ERROR"
        message.classification_lease_at = None
        db.commit()
        return False
    except Exception:
        message.classification_error = "Email classification failed. Retry from the Inbox."
        message.classification_state = "ERROR"
        message.classification_lease_at = None
        db.commit()
        return False

    message = db.query(InboxMessage).filter_by(id=message_id).populate_existing().with_for_update().one()
    # The email might have been linked/edited while the provider call ran. Read
    # only the current persisted message/application association for the decision.
    app = None
    newly_matched = False
    if not message.application_id and matched_id:
        if matching_application_id(db, mailbox, message) == matched_id:
            message.application_id = matched_id
            newly_matched = True
    if message.application_id:
        app = scoped(db, Application, message.firm_id).filter_by(
            id=message.application_id, candidate_id=message.candidate_id).populate_existing().with_for_update().first()
    if newly_matched and (app is None or (app.submitted_by_user_id is None
                                         and (app.applied_at is None or app.status == "saved"))):
        # A submission may have been reverted while this worker waited for its lock.
        message.application_id = None
        app = None
    classification = EmailClassification(
        firm_id=message.firm_id, candidate_id=message.candidate_id,
        inbox_message_id=message.id, application_id=app.id if app else None,
        category=result.category, probabilities=result.probabilities, confidence=result.confidence,
        model=result.model or MODEL_ID, category_version=CATEGORY_VERSION,
        provider=result.provider, provider_request_id=result.request_id,
        outcome="UNMATCHED" if app is None else "NO_CHANGE",
    )
    db.add(classification)
    db.flush()
    if app is not None:
        if result.confidence < CONFIDENCE_THRESHOLD:
            classification.outcome = "REVIEW"
            request_review(db, app, message, reason="LOW_CONFIDENCE", classification_id=classification.id)
        elif not CANDIDATE_EMAIL_AUTO_STATUS_ENABLED:
            classification.outcome = "REVIEW"
            request_review(db, app, message, reason="AUTO_STATUS_DISABLED", classification_id=classification.id)
        elif not _apply_auto_status(db, app, CATEGORY_TO_STATUS[result.category], message, classification):
            classification.outcome = "REVIEW"
            request_review(db, app, message, reason="STATUS_REVIEW", classification_id=classification.id)
    message.classification_state = "DONE"
    message.classification_error = None
    message.classification_lease_at = None
    db.commit()
    return True


def _run_messages(ids) -> int:
    done = 0
    for message_id in ids:
        db = SessionLocal()
        try:
            done += int(_classify_one(db, message_id))
        except Exception:
            db.rollback()
        finally:
            db.close()
    return done


def classify_imported_messages(*, firm_id, candidate_id, mailbox_id, message_ids) -> int:
    """Start newly committed mail immediately; the scheduled sweep remains recovery.

    Call after the import transaction commits. IDs are scoped again here and the
    normal worker's leases, retry policy and immutable results prevent duplicate
    work if a scheduled run or another request reaches the same messages.
    """
    if not OPENROUTER_API_KEY or not CANDIDATE_EMAIL_CLASSIFICATION_ENABLED:
        return 0
    ids = list(dict.fromkeys(message_ids))
    done = 0
    for offset in range(0, len(ids), _BATCH):
        with SessionLocal() as db:
            eligible = [row[0] for row in scoped(db, InboxMessage, firm_id, InboxMessage.id).filter(
                InboxMessage.candidate_id == candidate_id,
                InboxMessage.mailbox_id == mailbox_id,
                InboxMessage.id.in_(ids[offset:offset + _BATCH]),
                InboxMessage.classification_state == 'PENDING',
            ).order_by(InboxMessage.received_at, InboxMessage.id).all()]
        done += _run_messages(eligible)
    return done


def classify_pending_messages(*, limit: int = _BATCH, created_before=None) -> int:
    """Run a bounded worker batch. No API key means raw Inbox sync/display stays operational."""
    if not OPENROUTER_API_KEY or not CANDIDATE_EMAIL_CLASSIFICATION_ENABLED:
        return 0
    db = SessionLocal()
    try:
        now = utcnow()
        stale_lease = now - timedelta(minutes=_LEASE_MINUTES)
        query = db.query(InboxMessage.id).filter(
            or_(InboxMessage.classification_state == "PENDING",
                (InboxMessage.classification_state == "PROCESSING") & (InboxMessage.classification_lease_at < stale_lease))
        )
        if created_before is not None:
            # Newly imported messages already got one immediate attempt. Leave
            # transient failures for the next tick instead of doubling retries.
            query = query.filter(InboxMessage.created_at < created_before)
        ids = [row[0] for row in query.order_by(InboxMessage.received_at.asc()).limit(limit).all()]
    finally:
        db.close()
    return _run_messages(ids)
