"""Transactional status and review commands. Callers commit only after the whole command succeeds."""
import uuid
from fastapi import HTTPException
from backend.auth.ledger import record
from backend.auth.policy import can
from backend.auth.scoping import scoped
from backend.models.db import Application, ApplicationStatusEvent, ApplicationReview, utcnow
from backend.models.candidates import FavoriteJob, InboxMessage
from backend.models.tenancy import User

STATUSES = frozenset({
    'saved', 'applied', 'screening_call', 'interview_schedule_request', 'interview_scheduled',
    'offer', 'shortlisted', 'move_on', 'incomplete_application', 'assessment', 'other',
})


def accessible_application(db, firm_id, principal, app_id, *, lock=False):
    from backend.api.routes_candidates import _candidate
    try:
        app_id = uuid.UUID(str(app_id))
    except (ValueError, TypeError):
        raise HTTPException(404, 'Application not found') from None
    query = scoped(db, Application, firm_id).filter(Application.id == app_id)
    app = (query.with_for_update() if lock else query).populate_existing().first()
    if app is None or app.candidate_id is None:
        raise HTTPException(404, 'Application not found')
    _candidate(db, firm_id, principal, app.candidate_id)
    return app


def move(db, app, principal, *, status, expected_revision, note=None, command_id=None, review=None):
    if not can(principal, 'application.move'):
        raise HTTPException(403, "You don't have permission to move applications.")
    if not isinstance(status, str) or status not in STATUSES:
        raise HTTPException(400, 'Unsupported candidate application status.')
    if note is not None and (not isinstance(note, str) or len(note) > 2000):
        raise HTTPException(400, 'Status note must be at most 2000 characters.')
    if command_id is not None:
        try:
            command_id = uuid.UUID(str(command_id))
        except (ValueError, TypeError):
            raise HTTPException(400, 'Invalid command ID.') from None
        previous = scoped(db, ApplicationStatusEvent, app.firm_id).filter_by(
            application_id=app.id, command_id=command_id).first()
        if previous is not None:
            if (previous.to_status != status or previous.note != note
                    or previous.actor_user_id != principal.user_id
                    or previous.review_id != (review.id if review else None)):
                raise HTTPException(409, 'Command ID was already used for another decision.')
            return app
    if type(expected_revision) is not int or expected_revision != app.status_revision:
        raise HTTPException(409, 'Application changed. Reload before changing its status.')
    pending = scoped(db, ApplicationReview, app.firm_id).filter_by(application_id=app.id, state='PENDING')
    if review is None and pending.first() is not None:
        raise HTTPException(409, 'Read the email in Inbox and confirm the pending review first.')
    actor = db.get(User, principal.user_id)
    if actor is None or actor.firm_id != app.firm_id:
        raise HTTPException(403, 'Signed-in user is unavailable.')
    now = utcnow()
    old_status = app.status
    # A review can confirm the existing status. That still records a human decision.
    if old_status == status and review is None:
        return app
    app.status = status
    app.status_revision += 1
    app.status_effective_at = now
    app.last_manual_change_at = now
    app.updated_at = now
    source = 'bde_review' if review else 'ui'
    transition = {
        'from': old_status, 'to': status, 'at': now.isoformat(), 'source': source,
        'actor_user_id': str(actor.id), 'note': note,
        'revision': app.status_revision, 'command_id': str(command_id) if command_id else None,
    }
    if review:
        transition['review_id'] = str(review.id)
        transition['email_id'] = str(review.inbox_message_id)
    app.status_transitions = [*(app.status_transitions or []), transition]
    db.add(ApplicationStatusEvent(
        firm_id=app.firm_id, candidate_id=app.candidate_id, application_id=app.id,
        from_status=old_status, to_status=status, actor_user_id=actor.id, source=source,
        note=note, command_id=command_id, review_id=review.id if review else None,
        occurred_at=now, revision=app.status_revision, original_payload=transition,
    ))
    favorite = scoped(db, FavoriteJob, app.firm_id).filter_by(
        candidate_id=app.candidate_id, job_id=app.job_id).first()
    if status == 'saved':
        app.applied_at = None
        app.submitted_by_user_id = None
        if favorite is None:
            db.add(FavoriteJob(firm_id=app.firm_id, candidate_id=app.candidate_id,
                              job_id=app.job_id, marked_by_user_id=actor.id))
    else:
        if status == 'applied' and old_status == 'saved':
            app.applied_at = now
            app.submitted_by_user_id = actor.id
        if favorite:
            db.delete(favorite)
    if review:
        review.state = 'RESOLVED'
        review.revision += 1
        review.resolved_at = now
        review.resolved_by_user_id = actor.id
        review.resolved_status = status
        review.note = note
    record(db, actor=actor, action='UPDATE', entity_type='application', entity_id=app.id,
           entity_label=app.job.title or 'Application',
           summary=f"{'Reviewed' if review else 'Moved'} {app.job.title or 'application'}: {old_status} → {status}.",
           firm_id=app.firm_id, candidate_id=app.candidate_id, at=now)
    db.flush()
    return app


def request_review(db, app, message, *, reason, classification_id=None):
    """Internal worker seam. No public endpoint can fabricate an email or a model decision."""
    app = db.query(Application).filter_by(id=app.id).with_for_update().populate_existing().one()
    if (message.firm_id != app.firm_id or message.candidate_id != app.candidate_id
            or message.application_id != app.id):
        raise ValueError('Review email must belong to the same firm, candidate and application.')
    mailbox = message.mailbox_id
    from backend.models.candidates import CandidateMailbox
    connection = db.get(CandidateMailbox, mailbox)
    if connection is None or (connection.firm_id, connection.candidate_id) != (app.firm_id, app.candidate_id):
        raise ValueError('Mailbox is outside the application scope.')
    existing = scoped(db, ApplicationReview, app.firm_id).filter_by(
        application_id=app.id, inbox_message_id=message.id).first()
    if existing:
        return existing
    review = ApplicationReview(firm_id=app.firm_id, candidate_id=app.candidate_id,
                               application_id=app.id, inbox_message_id=message.id,
                               reason=reason, application_revision=app.status_revision,
                               classification_id=classification_id)
    db.add(review)
    db.flush()
    return review
