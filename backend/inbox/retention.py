"""Central readable-mail policy and independently gated hidden-Other erasure."""
from backend.inbox.decider_categories import CONFIDENCE_THRESHOLD

from backend.auth.scoping import scoped
from backend.models.candidates import InboxMessage
from backend.models.db import ApplicationReview, EmailClassification, SessionLocal, utcnow


def readable(query):
    return query.filter(InboxMessage.deleted_at.is_(None), InboxMessage.hidden_at.is_(None))


def clear_derived_results(db, firm_id, message_ids):
    if not message_ids:
        return
    scoped(db, EmailClassification, firm_id).filter(
        EmailClassification.inbox_message_id.in_(message_ids)).delete(synchronize_session=False)


def purge_due(*, limit=100):
    from backend import config
    if not (config.CANDIDATE_EMAIL_PURGE_ENABLED and config.CANDIDATE_EMAIL_PURGE_EVALUATED
            and config.CANDIDATE_EMAIL_PURGE_EVALUATION_CONFIG_ID):
        return 0
    now = utcnow()
    with SessionLocal() as db:
        rows = db.query(InboxMessage).filter(
            InboxMessage.deleted_at.is_(None), InboxMessage.hidden_at.isnot(None),
            InboxMessage.other_purge_after <= now, InboxMessage.classification_state == 'DONE',
        ).order_by(InboxMessage.other_purge_after).with_for_update(skip_locked=True).limit(min(limit, 500)).all()
        count = 0
        for message in rows:
            latest = scoped(db, EmailClassification, message.firm_id).filter_by(
                inbox_message_id=message.id, result_version=message.classification_version,
                content_revision=message.content_revision).first()
            review = scoped(db, ApplicationReview, message.firm_id).filter_by(inbox_message_id=message.id).first()
            known_job = scoped(db, EmailClassification, message.firm_id).filter(
                EmailClassification.inbox_message_id == message.id, EmailClassification.category != 'other').first()
            if (not latest or latest.category != 'other' or latest.confidence < CONFIDENCE_THRESHOLD or review or known_job
                    or latest.prompt_version != config.CANDIDATE_EMAIL_PURGE_EVALUATION_CONFIG_ID):
                continue
            message.body = None
            message.snippet = message.subject = message.from_name = message.from_email = ''
            message.thread_id = None
            message.application_id = None
            message.deleted_at = now
            message.content_revision += 1
            message.classification_token = None
            message.classification_state = 'EXCLUDED'
            message.sender_auth_result = 'UNKNOWN'
            message.classification_error = None
            db.flush()  # SessionLocal disables autoflush; tombstone authorizes derivative erasure.
            clear_derived_results(db, message.firm_id, [message.id])
            count += 1
        db.commit()
        return count
