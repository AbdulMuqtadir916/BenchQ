"""Transactional status and review commands. Callers commit only after the whole command succeeds."""
import uuid
from fastapi import HTTPException
from backend.auth.ledger import record
from backend.auth.policy import can
from backend.auth.scoping import scoped
from backend.models.db import Application, ApplicationStatusEvent, ApplicationReview, utcnow
from backend.models.candidates import FavoriteJob
from backend.models.tenancy import User

STATUSES = frozenset({
    'saved', 'applied', 'screening_call', 'interview_schedule_request', 'interview_scheduled',
    'offer', 'shortlisted', 'move_on', 'incomplete_application', 'assessment',
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
    if not isinstance(status, str) or status not in STATUSES:
        raise HTTPException(400, 'Unsupported candidate application status.')
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
        # Saved changes the queue, not the historical fact of a submission.
        if favorite is None:
            db.add(FavoriteJob(firm_id=app.firm_id, candidate_id=app.candidate_id,
                              job_id=app.job_id, marked_by_user_id=actor.id))
    else:
        if status == 'applied' and old_status == 'saved' and app.applied_at is None:
            app.applied_at = now
            if app.submitted_by_user_id is None:
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


def request_review(db, app, message, *, reason):
    """Internal worker seam. No public endpoint can fabricate an email or a model decision."""
    app = scoped(db, Application, app.firm_id).filter_by(id=app.id).with_for_update().populate_existing().one()
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
                               reason=reason, application_revision=app.status_revision)
    db.add(review)
    db.flush()
    return review


# ── PR 4: automatic status updates from email, and their Undo (DEBUG D-11, D-12, D-13) ──────────────────────────

def automation_ready(message) -> bool:
    """Automatic writes need both switches, the approval and a start time; mail received before the start time is
    never executed, so switching on cannot replay earlier mail."""
    from datetime import datetime
    from backend import config
    if not (config.CANDIDATE_EMAIL_AUTO_STATUS_ENABLED and config.CANDIDATE_EMAIL_AUTOMATION_APPROVED):
        return False
    try:
        start = datetime.fromisoformat(config.CANDIDATE_EMAIL_AUTOMATION_START_AT.replace('Z', '+00:00'))
    except (AttributeError, ValueError, TypeError):
        return False
    return bool(start.tzinfo and message.received_at and message.received_at >= start)


def email_command_id(app_id, message_id) -> uuid.UUID:
    """One automatic decision per (application, email): the database's unique (application, command) pair."""
    return uuid.uuid5(uuid.NAMESPACE_URL, f'benchq:email:{app_id}:{message_id}')


def email_history(db, app, message) -> str | None:
    """'UNDONE' if a person undid this email's automatic change, 'APPLIED' if it changed the application, else None."""
    events = scoped(db, ApplicationStatusEvent, app.firm_id).filter(
        ApplicationStatusEvent.application_id == app.id,
        ApplicationStatusEvent.source.in_(('email_classifier', 'email_undo'))).all()
    mine = [e for e in events if (e.original_payload or {}).get('email_id') == str(message.id)]
    if any(e.source == 'email_undo' for e in mine):
        return 'UNDONE'
    return 'APPLIED' if mine else None


def apply_email_decision(db, app, message, classification_id, *, target: str) -> bool:
    """Internal worker seam: write one automatic status change, or nothing. Caller holds the application row lock and
    has already decided the email passes every policy check. Status, event and ledger are written together in a
    savepoint; a concurrent duplicate rolls back only the savepoint and the existing decision is returned.
    Classification rows are immutable (database trigger), so the caller passes the id of the row it will insert
    with the final outcome."""
    from sqlalchemy.exc import IntegrityError
    from backend.auth.ledger import record_automated
    command_id = email_command_id(app.id, message.id)
    existing = scoped(db, ApplicationStatusEvent, app.firm_id).filter_by(application_id=app.id, command_id=command_id).first()
    if existing is not None:
        return True
    if target not in STATUSES or target == 'saved':
        raise ValueError('Automatic target must be a selectable stage.')
    try:
        with db.begin_nested():
            now = utcnow()
            old_status = app.status
            app.status = target
            app.status_revision += 1
            app.status_effective_at = message.received_at
            app.updated_at = now
            event_id = uuid.uuid4()
            payload = {'from': old_status, 'to': target, 'at': now.isoformat(), 'source': 'email_classifier',
                       'actor_user_id': None, 'note': None, 'revision': app.status_revision,
                       'command_id': str(command_id), 'email_id': str(message.id), 'event_id': str(event_id),
                       'classification_id': str(classification_id), 'automatic': True}
            app.status_transitions = [*(app.status_transitions or []), payload]
            event = ApplicationStatusEvent(
                id=event_id, firm_id=app.firm_id, candidate_id=app.candidate_id, application_id=app.id, from_status=old_status,
                to_status=target, actor_user_id=None, source='email_classifier', occurred_at=now,
                revision=app.status_revision, command_id=command_id, note=None, original_payload=payload)
            db.add(event)
            db.flush()
            favorite = scoped(db, FavoriteJob, app.firm_id).filter_by(candidate_id=app.candidate_id, job_id=app.job_id).first()
            if favorite:
                db.delete(favorite)
            record_automated(db, actor_type='AGENT', actor_name='Email classifier', action='STATE_CHANGE',
                             entity_type='application', entity_id=app.id, entity_label=app.job.title or 'Application',
                             summary=f'Automatic status change from email: {old_status} → {target}. Source email {message.id}.',
                             firm_id=app.firm_id, candidate_id=app.candidate_id, at=now)
            db.flush()
    except IntegrityError:
        db.refresh(app)
        return scoped(db, ApplicationStatusEvent, app.firm_id).filter_by(
            application_id=app.id, command_id=command_id).first() is not None
    return True


def undo_email_decision(db, app, principal, *, event_id, expected_revision, command_id):
    """Compensating human decision for the latest automatic change. Never edits or deletes the original event."""
    if not can(principal, 'application.move'):
        raise HTTPException(403, "You don't have permission to undo application changes.")
    try:
        event_id, command_id = uuid.UUID(str(event_id)), uuid.UUID(str(command_id))
    except (ValueError, TypeError):
        raise HTTPException(400, 'Invalid event or command ID.') from None
    previous = scoped(db, ApplicationStatusEvent, app.firm_id).filter_by(application_id=app.id, command_id=command_id).first()
    if previous is not None:
        if (previous.source != 'email_undo' or previous.actor_user_id != principal.user_id
                or (previous.original_payload or {}).get('undo_event_id') != str(event_id)):
            raise HTTPException(409, 'Command ID was already used for another decision.')
        return app
    original = scoped(db, ApplicationStatusEvent, app.firm_id).filter_by(
        application_id=app.id, id=event_id, source='email_classifier').first()
    if original is None:
        raise HTTPException(404, 'Automatic change not found.')
    if type(expected_revision) is not int or expected_revision != app.status_revision or original.revision != app.status_revision:
        raise HTTPException(409, 'A later decision exists. Reload before changing the status.')
    if original.from_status not in STATUSES:
        raise HTTPException(409, 'The earlier status is an older one; choose the current stage by hand.')
    actor = db.get(User, principal.user_id)
    if actor is None or actor.firm_id != app.firm_id:
        raise HTTPException(403, 'Signed-in user is unavailable.')
    now = utcnow()
    payload = {'from': app.status, 'to': original.from_status, 'at': now.isoformat(), 'source': 'email_undo',
               'actor_user_id': str(actor.id), 'note': None, 'revision': app.status_revision + 1,
               'command_id': str(command_id), 'undo_event_id': str(original.id),
               'email_id': (original.original_payload or {}).get('email_id'),
               'classification_id': (original.original_payload or {}).get('classification_id')}
    old_status = app.status
    undo_id = uuid.uuid4()
    payload['event_id'] = str(undo_id)
    app.status = original.from_status
    app.status_revision += 1
    app.status_effective_at = now
    app.last_manual_change_at = now
    app.updated_at = now
    app.status_transitions = [*(app.status_transitions or []), payload]
    db.add(ApplicationStatusEvent(
        id=undo_id, firm_id=app.firm_id, candidate_id=app.candidate_id, application_id=app.id, from_status=old_status,
        to_status=original.from_status, actor_user_id=actor.id, source='email_undo', occurred_at=now,
        revision=app.status_revision, command_id=command_id, note=None, original_payload=payload))
    record(db, actor=actor, action='UPDATE', entity_type='application', entity_id=app.id,
           entity_label=app.job.title or 'Application',
           summary=f'Undid automatic change {original.id}: {old_status} → {original.from_status}.',
           firm_id=app.firm_id, candidate_id=app.candidate_id, at=now)
    db.flush()
    return app
