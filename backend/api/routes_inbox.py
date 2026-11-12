"""Candidate-owned Gmail inbox connection, sync and read routes (D8)."""
from __future__ import annotations

import uuid
import base64
import logging
import json
from contextlib import contextmanager
from datetime import datetime
from datetime import timedelta
from urllib.parse import urlencode, urlsplit, urlunsplit, parse_qsl

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field, ConfigDict
from sqlalchemy import and_, or_, func
from sqlalchemy.orm import Session

from backend.auth.policy import can
from backend.auth.scoping import reader_firm_id, scoped
from backend.auth.sessions import Principal
from backend.api.routes_auth import current_principal
from backend.api.routes_candidates import _candidate as visible_candidate
from backend.inbox.google_oauth import (build_authorization, encrypt_secret, exchange_code, state_digest,
                                        validate_return_to, decrypt_content, decrypt_secret, revoke_token, OAuthGrantError, identify_refresh_token)
from backend.inbox.sync_jobs import run_import
from backend.inbox.import_progress import finish_import
from backend.inbox.grant_locks import account_lock, exchange_barrier, revoke_barrier
from backend.inbox.gmail_sync import ReconnectRequired, sync_mailbox, record_sync_error
from backend.models.candidates import Candidate, CandidateGoogleOAuthAttempt, CandidateMailbox, InboxMessage
from backend.models.db import get_db, utcnow, SessionLocal

from backend.inbox.retention import readable, clear_derived_results
from backend.models.db import ApplicationReview, EmailClassification, Application


router = APIRouter(tags=["candidate-inbox"])
logger = logging.getLogger("jobnavigator.inbox")


def _audit(db, principal, *, firm_id, candidate_id, entity_id, summary):
    from backend.auth.ledger import record
    from backend.models.tenancy import User
    actor = scoped(db, User, firm_id).filter_by(id=principal.user_id).one()
    record(db, actor=actor, action="UPDATE", entity_type="email", entity_id=entity_id,
           entity_label="Candidate inbox", summary=summary, firm_id=firm_id, candidate_id=candidate_id)


def _attribute_retained_messages(db, mailbox):
    scoped(db, InboxMessage, mailbox.firm_id).filter_by(mailbox_id=mailbox.id, source_address="").update(
        {InboxMessage.source_address: mailbox.address.strip().lower()}, synchronize_session=False)



class OAuthStartBody(BaseModel):
    return_to: str = Field(min_length=1, max_length=500)


def _candidate(db: Session, firm_id: uuid.UUID, candidate_id: uuid.UUID, principal: Principal) -> Candidate:
    return visible_candidate(db, firm_id, principal, candidate_id)


def _authorize_oauth_write(db: Session, principal: Principal, firm_id: uuid.UUID,
                           candidate_id: uuid.UUID) -> Principal:
    # The provider exchange can outlive a role/assignment change. Read current
    # authority again rather than relying on the OAuth-start or request snapshot.
    from backend.auth.sessions import principal_for
    from backend.models.tenancy import Session as AuthSession
    db.expire_all()
    session = db.get(AuthSession, principal.session_id)
    current = principal_for(db, session) if session and session.expires_at > utcnow() and session.absolute_expires_at > utcnow() else None
    if (current is None or current.firm_id != firm_id or current.firm_status == "SUSPENDED"
            or not can(current, "candidate.edit")):
        raise HTTPException(403, "You don't have permission to connect this inbox.")
    visible_candidate(db, firm_id, current, candidate_id, lock=True)
    return current


def _message_json(message: InboxMessage, *, hide_body: bool = False, include_body: bool = True, classification=None) -> dict:
    if message.deleted_at is not None or message.hidden_at is not None:
        raise HTTPException(404, "Email not found.")
    return {
        "id": str(message.id), "firm_id": str(message.firm_id), "candidate_id": str(message.candidate_id),
        "application_id": str(message.application_id) if message.application_id else None,
        "from_name": "" if hide_body else message.from_name, "from_email": "" if hide_body else message.from_email,
        "subject": "" if hide_body else message.subject,
        "snippet": "" if hide_body else decrypt_content(message.snippet),
        "body": "" if hide_body or not include_body else decrypt_content(message.body or message.snippet),
        "received_at": message.received_at.isoformat(), "is_read": message.is_read,
        "classification_state": message.classification_state,
        "classification_label": None if message.classification_state == 'NOT_QUEUED' else "Not classified" if message.classification_state != 'DONE' else "Classified",
        "classification_error": None if hide_body else message.classification_error,
        "classification_retry_exhausted": message.classification_state == 'ERROR' and message.classification_attempts >= 3,
        "classification_category": classification.category if classification and not hide_body else None,
        "classification_confidence": classification.confidence if classification and not hide_body else None,
        "thread_id": None if hide_body else message.thread_id, "source_address": "" if hide_body else message.source_address,
        # Revisions the review/retry commands must echo back (PR 4); not content.
        "content_revision": message.content_revision, "classification_version": message.classification_version,

    }


def _inbox_json(db: Session, firm_id: uuid.UUID, candidate_id: uuid.UUID, mailbox: CandidateMailbox | None,
                messages: list[InboxMessage], *, hide_body: bool = False, body_message_id=None) -> dict:
    connection = None
    if mailbox:
        connection = {
            "firm_id": str(mailbox.firm_id), "candidate_id": str(mailbox.candidate_id),
            "provider": "GOOGLE", "address": "" if hide_body else mailbox.address,
            "connected_at": mailbox.connected_at.isoformat(),
            "last_synced_at": mailbox.last_synced_at.isoformat() if mailbox.last_synced_at else None,
            "status": mailbox.status, "last_sync_error": ("Mailbox needs attention." if mailbox.last_sync_error else None) if hide_body else mailbox.last_sync_error,
            "sync_state": mailbox.sync_state,
        }
    results = {}
    if messages and not hide_body:
        for result in scoped(db, EmailClassification, firm_id).filter(
                EmailClassification.inbox_message_id.in_([m.id for m in messages])).order_by(EmailClassification.result_version).all():
            results[result.inbox_message_id] = result
    return {"firm_id": str(firm_id), "candidate_id": str(candidate_id), "connection": connection,
            "messages": [_message_json(item, hide_body=hide_body, include_body=item.id == body_message_id,
                                       classification=results.get(item.id)) for item in messages]}


def _cursor(message):
    return base64.urlsafe_b64encode(json.dumps([message.received_at.isoformat(), str(message.id)]).encode()).decode()


def _load_inbox(db: Session, firm_id: uuid.UUID, candidate_id: uuid.UUID, limit: int = 200,
                message_id: uuid.UUID | None = None, *, cursor: str | None = None, hide_body: bool = False) -> dict:
    mailbox = scoped(db, CandidateMailbox, firm_id).filter_by(candidate_id=candidate_id).first()
    query = readable(scoped(db, InboxMessage, firm_id).filter_by(candidate_id=candidate_id))
    total = query.count() if cursor is None and message_id is None else None
    if cursor:
        try:
            values = json.loads(base64.b64decode(cursor.encode(), altchars=b'-_', validate=True))
            if not isinstance(values, list) or len(values) != 2 or not all(isinstance(value, str) for value in values):
                raise ValueError('Invalid cursor fields')
            timestamp, identity = values
            timestamp = datetime.fromisoformat(timestamp)
            if timestamp.tzinfo is None:
                raise ValueError('Missing timezone')
            identity = uuid.UUID(identity)
        except (ValueError, TypeError, UnicodeError):
            raise HTTPException(400, 'Invalid email cursor.')
        query = query.filter(or_(InboxMessage.received_at < timestamp,
            and_(InboxMessage.received_at == timestamp, InboxMessage.id > identity)))
    rows = query.order_by(InboxMessage.received_at.desc(), InboxMessage.id).limit(limit + 1).all()
    messages = rows[:limit]
    next_cursor = _cursor(messages[-1]) if len(rows) > limit else None
    # Selected email lookup is scoped independently of pagination.
    if message_id is not None:
        selected = scoped(db, InboxMessage, firm_id).filter_by(candidate_id=candidate_id, id=message_id, deleted_at=None, hidden_at=None).first()
        if selected is None:
            raise HTTPException(404, 'Email not found.')
        messages = [selected]
    result = _inbox_json(db, firm_id, candidate_id, mailbox, [] if hide_body else messages, hide_body=hide_body, body_message_id=message_id)
    result.update(next_cursor=next_cursor)
    if total is not None:
        result['total_count'] = total
        # Count only, never content: emails hidden as not about a job (encrypted, kept 30 days) — PR 4.
        result['hidden_count'] = scoped(db, InboxMessage, firm_id).filter(
            InboxMessage.candidate_id == candidate_id, InboxMessage.deleted_at.is_(None),
            InboxMessage.hidden_at.isnot(None)).count()
    return result


@router.get("/firms/{firm_id}/candidates/{candidate_id}/inbox")
def candidate_inbox(candidate_id: uuid.UUID, principal: Principal = Depends(current_principal),
                    db: Session = Depends(get_db), firm_id: uuid.UUID = Depends(reader_firm_id),
                    limit: int = Query(default=200, ge=1, le=500), message_id: uuid.UUID | None = None,
                    cursor: str | None = Query(default=None, max_length=500)):
    _candidate(db, firm_id, candidate_id, principal)
    return _load_inbox(db, firm_id, candidate_id, limit, message_id,
                       cursor=cursor, hide_body=principal.support_view_id is not None)


@contextmanager
def _attempt_lock(db, firm_id, candidate_id, attempt_id, user_id):
    with account_lock('candidate:' + str(candidate_id)):
        attempt = scoped(db, CandidateGoogleOAuthAttempt, firm_id).filter_by(
            id=attempt_id, candidate_id=candidate_id, initiated_by_user_id=user_id).first()
        address = attempt.pending_address if attempt else None
        db.commit()
        with account_lock(address or str(attempt_id)):
            yield


@contextmanager
def _mailbox_lock(db, firm_id, candidate_id):
    with account_lock('candidate:' + str(candidate_id)):
        mailbox = scoped(db, CandidateMailbox, firm_id).filter_by(candidate_id=candidate_id).first()
        address = mailbox.address if mailbox else str(candidate_id)
        db.commit()
        with account_lock(address):
            yield


def _retire_attempt(db, attempt, *, invalidate_pending=False):
    """Retire under account/phase locks; preserve failed cleanup encrypted for retry."""
    token = attempt.pending_token_ciphertext
    address = (attempt.pending_address or '').strip().lower()
    attempt.expires_at = utcnow()
    attempt.code_verifier_ciphertext = b''
    if not token:
        db.commit()
        return True
    if not address:
        db.commit()
        try:
            address = identify_refresh_token(decrypt_secret(token))
        except ReconnectRequired:
            attempt.pending_token_ciphertext = None
            db.commit()
            return True  # Google already invalidated this grant.
        except Exception as exc:
            logger.warning("Mailbox attempt %s: Google identity lookup failed (%s); kept for retry", attempt.id,
                           type(exc).__name__)
            return False  # Identity/provider outage: keep encrypted for scheduled retry.
        attempt.pending_address = address
    with account_lock(address), revoke_barrier():
        # Cross-firm existence probe is internal only: never revoke another live grant.
        live = db.query(CandidateMailbox.id).filter(func.lower(func.trim(CandidateMailbox.address)) == address,
            CandidateMailbox.status.in_(['CONNECTED', 'ERROR'])).first()
        pending_query = db.query(CandidateGoogleOAuthAttempt).filter(
            func.lower(CandidateGoogleOAuthAttempt.pending_address) == address,
            CandidateGoogleOAuthAttempt.id != attempt.id,
            CandidateGoogleOAuthAttempt.expires_at > utcnow(),
            CandidateGoogleOAuthAttempt.pending_token_ciphertext.isnot(None))
        newer_pending = pending_query.first()
        if invalidate_pending and not live:
            pending_query.update({CandidateGoogleOAuthAttempt.expires_at: utcnow()}, synchronize_session=False)
            newer_pending = None
        db.commit()  # Never hold row locks while calling Google.
        try:
            done = bool(live or newer_pending) or revoke_token(decrypt_secret(token))
        except (RuntimeError, HTTPException) as exc:
            logger.warning("Mailbox attempt %s: revoking the Google grant failed (%s); it stays live until the retry",
                           attempt.id, type(exc).__name__)
            done = False
        attempt = db.get(CandidateGoogleOAuthAttempt, attempt.id)
        if done:
            attempt.pending_token_ciphertext = None
            db.flush()  # SessionLocal disables autoflush; exclude this completed token from the probe.
            outstanding = scoped(db, CandidateGoogleOAuthAttempt, attempt.firm_id).filter(
                CandidateGoogleOAuthAttempt.candidate_id == attempt.candidate_id,
                CandidateGoogleOAuthAttempt.pending_token_ciphertext.isnot(None),
                CandidateGoogleOAuthAttempt.expires_at <= utcnow()).first()
            if not outstanding:
                mailbox = scoped(db, CandidateMailbox, attempt.firm_id).filter_by(candidate_id=attempt.candidate_id).first()
                if (mailbox and mailbox.status == 'DISCONNECTED'
                        and (mailbox.last_sync_error or '').startswith('Google revocation pending;')):
                    mailbox.last_sync_error = None
        db.commit()
        return done


def cleanup_expired_grants():
    """Scheduled cleanup does not depend on the next callback in a firm's browser."""
    with SessionLocal() as db:
        db.query(CandidateGoogleOAuthAttempt).filter(
            CandidateGoogleOAuthAttempt.expires_at <= utcnow(),
            CandidateGoogleOAuthAttempt.pending_token_ciphertext.is_(None)).update(
                {CandidateGoogleOAuthAttempt.code_verifier_ciphertext: b''}, synchronize_session=False)
        db.commit()
        ids = [row.id for row in db.query(CandidateGoogleOAuthAttempt).filter(
            CandidateGoogleOAuthAttempt.expires_at <= utcnow(),
            CandidateGoogleOAuthAttempt.pending_token_ciphertext.isnot(None)).order_by(
                CandidateGoogleOAuthAttempt.expires_at, CandidateGoogleOAuthAttempt.id).limit(10).all()]
    count = 0
    for identity in ids:
        try:
            with SessionLocal() as db:
                attempt = db.get(CandidateGoogleOAuthAttempt, identity)
                if attempt and attempt.expires_at <= utcnow() and attempt.pending_token_ciphertext:
                    count += int(_retire_attempt(db, attempt))
        except HTTPException:
            break  # A live operation has priority; retry on the next scheduled pass.
    return count


@router.post("/firms/{firm_id}/candidates/{candidate_id}/mailbox/oauth")
def start_candidate_google_oauth(candidate_id: uuid.UUID, body: OAuthStartBody,
                                 principal: Principal = Depends(current_principal),
                                 db: Session = Depends(get_db), firm_id: uuid.UUID = Depends(reader_firm_id)):
    if not can(principal, "candidate.edit"):
        raise HTTPException(status_code=403, detail="You don't have permission to connect this inbox.")
    _candidate(db, firm_id, candidate_id, principal)
    try:
        return_to = validate_return_to(body.return_to)
        auth = build_authorization()
        attempt = CandidateGoogleOAuthAttempt(
            state_hash=state_digest(auth.state), firm_id=firm_id, candidate_id=candidate_id,
            initiated_by_user_id=principal.user_id, code_verifier_ciphertext=encrypt_secret(auth.verifier),
            return_to=return_to, expires_at=utcnow() + timedelta(minutes=10),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    db.add(attempt)
    db.commit()
    return {"authorization_url": auth.url}


@router.get("/oauth/google/callback", name="candidate_google_oauth_callback")
def candidate_google_oauth_callback(request: Request,
                                    state: str = Query(min_length=16, max_length=200),
                                    code: str | None = Query(default=None, max_length=4000),
                                    error: str | None = Query(default=None, max_length=200),
                                    principal: Principal = Depends(current_principal),
                                    db: Session = Depends(get_db)):
    attempt = db.query(CandidateGoogleOAuthAttempt).filter_by(state_hash=state_digest(state)).with_for_update().first()
    if (attempt is None or attempt.consumed_at is not None or attempt.expires_at <= utcnow()
            or attempt.initiated_by_user_id != principal.user_id or attempt.firm_id != principal.firm_id):
        raise HTTPException(status_code=400, detail="Google authorization expired. Start the connection again.")
    try:
        return_to = validate_return_to(attempt.return_to)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid return path.") from exc
    principal = _authorize_oauth_write(db, principal, attempt.firm_id, attempt.candidate_id)
    request.state.oauth_return_to = return_to
    attempt.consumed_at = utcnow()
    verifier_ciphertext = attempt.code_verifier_ciphertext
    attempt.code_verifier_ciphertext = b""
    db.commit()  # Consume state before the network call so the authorization code cannot be replayed.
    result = "failed"
    refresh_token = None
    if not error and code:
        try:
            from backend.inbox.google_oauth import decrypt_secret
            with exchange_barrier():
                # Admission may have waited: access or cancellation/expiry can
                # change meanwhile. Recheck before contacting Google, then
                # release all row locks before the provider call.
                principal = _authorize_oauth_write(db, principal, attempt.firm_id, attempt.candidate_id)
                db.refresh(attempt)
                if attempt.expires_at <= utcnow():
                    raise HTTPException(400, 'Google authorization expired. Start the connection again.')
                db.commit()
                address, refresh_token = exchange_code(code, decrypt_secret(verifier_ciphertext))
                attempt.pending_address = address
                attempt.pending_token_ciphertext = encrypt_secret(refresh_token)
                db.commit()
            principal = _authorize_oauth_write(db, principal, attempt.firm_id, attempt.candidate_id)
            parsed = urlsplit(return_to)
            query = dict(parse_qsl(parsed.query, keep_blank_values=True))
            query['mailbox_confirmation'] = str(attempt.id)
            return RedirectResponse(urlunsplit(('', '', parsed.path, urlencode(query), '')), status_code=303)

        except OAuthGrantError as exc:
            db.rollback()
            attempt.pending_token_ciphertext = encrypt_secret(exc.token)
            attempt.expires_at = utcnow()
            db.commit()
            _retire_attempt(db, attempt)
            result = "failed"
        except HTTPException:
            request.state.oauth_return_to = '/'
            db.rollback()
            if refresh_token and attempt.pending_token_ciphertext:
                _retire_attempt(db, attempt)
            raise
        except Exception as exc:
            logger.warning("Mailbox attempt %s: connecting Gmail failed (%s)", attempt.id, type(exc).__name__)
            db.rollback()
            if refresh_token and attempt.pending_token_ciphertext:
                _retire_attempt(db, attempt)
            result = "failed"
    parsed = urlsplit(return_to)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query["mailbox"] = result if not error else "cancelled"
    return RedirectResponse(urlunsplit(("", "", parsed.path, urlencode(query), "")), status_code=303)


@router.post("/firms/{firm_id}/candidates/{candidate_id}/mailbox/sync")
def sync_candidate_inbox(candidate_id: uuid.UUID, background_tasks: BackgroundTasks,
                         principal: Principal = Depends(current_principal),
                         db: Session = Depends(get_db), firm_id: uuid.UUID = Depends(reader_firm_id)):
    if not can(principal, "candidate.edit"):
        raise HTTPException(status_code=403, detail="You don't have permission to sync this inbox.")
    _candidate(db, firm_id, candidate_id, principal)
    mailbox = scoped(db, CandidateMailbox, firm_id).filter_by(candidate_id=candidate_id).with_for_update().first()
    if mailbox is None or mailbox.status != "CONNECTED":
        raise HTTPException(status_code=409, detail="Connect the candidate's Google account first.")
    generation = mailbox.connected_at
    mailbox.sync_state = 'QUEUED'
    db.commit()
    background_tasks.add_task(run_import, firm_id, candidate_id, generation)
    return {'imported': 0, 'inbox': _load_inbox(db, firm_id, candidate_id)}


@router.delete("/firms/{firm_id}/candidates/{candidate_id}/mailbox")
def disconnect_candidate_inbox(candidate_id: uuid.UUID, principal: Principal = Depends(current_principal),
                               db: Session = Depends(get_db), firm_id: uuid.UUID = Depends(reader_firm_id)):
    if not can(principal, "candidate.edit"):
        raise HTTPException(status_code=403, detail="You don't have permission to disconnect this inbox.")
    _candidate(db, firm_id, candidate_id, principal)
    with _mailbox_lock(db, firm_id, candidate_id):
        principal = _authorize_oauth_write(db, principal, firm_id, candidate_id)
        _disconnect_locked(db, principal, firm_id, candidate_id)
    return _load_inbox(db, firm_id, candidate_id)


def _disconnect_locked(db, principal, firm_id, candidate_id):
    mailbox = scoped(db, CandidateMailbox, firm_id).filter_by(candidate_id=candidate_id).with_for_update().first()
    if not mailbox or mailbox.status == 'DISCONNECTED':
        db.rollback()
        return
    _attribute_retained_messages(db, mailbox)
    ciphertext = mailbox.refresh_token_ciphertext
    cleanup = None
    if ciphertext:
        cleanup = CandidateGoogleOAuthAttempt(firm_id=firm_id, candidate_id=candidate_id,
            initiated_by_user_id=principal.user_id, state_hash=state_digest(uuid.uuid4().hex),
            code_verifier_ciphertext=b'', pending_address=mailbox.address.strip().lower(),
            pending_token_ciphertext=ciphertext, return_to='/', consumed_at=utcnow(), expires_at=utcnow())
        db.add(cleanup)
    mailbox.status = 'DISCONNECTED'
    mailbox.refresh_token_ciphertext = None
    mailbox.history_id = None
    finish_import(db, firm_id, mailbox.sync_job_id)
    mailbox.sync_job_id = None
    mailbox.sync_lease_until = None
    mailbox.sync_state = 'IDLE'
    mailbox.last_sync_error = None
    _audit(db, principal, firm_id=firm_id, candidate_id=candidate_id, entity_id=mailbox.id,
           summary='Disconnected candidate Google inbox; retained imported email.')
    db.commit()
    if cleanup is not None:
        try:
            done = _retire_attempt(db, cleanup, invalidate_pending=True)
        except (RuntimeError, HTTPException):
            done = False
        if not done:
            mailbox = scoped(db, CandidateMailbox, firm_id).filter_by(candidate_id=candidate_id).with_for_update().first()
            mailbox.last_sync_error = 'Google revocation pending; BenchQ will retry automatically. Sync is stopped. You can also remove access at https://myaccount.google.com/permissions.'
            db.commit()


@router.patch("/firms/{firm_id}/candidates/{candidate_id}/inbox-messages/{message_id}/read")
def mark_candidate_message_read(candidate_id: uuid.UUID, message_id: uuid.UUID,
                                principal: Principal = Depends(current_principal), db: Session = Depends(get_db),
                                firm_id: uuid.UUID = Depends(reader_firm_id)):
    if not can(principal, "candidate.edit"):
        raise HTTPException(status_code=403, detail="You don't have permission to mark this email read.")
    _candidate(db, firm_id, candidate_id, principal)
    message = scoped(db, InboxMessage, firm_id).filter_by(
        id=message_id, candidate_id=candidate_id, deleted_at=None, hidden_at=None).with_for_update().first()
    if message is None:
        raise HTTPException(status_code=404, detail="Inbox message not found.")
    if not message.is_read:
        message.is_read = True  # Local state only; Gmail read status is never changed.
    db.commit()
    return _message_json(message)


@router.get('/firms/{firm_id}/candidates/{candidate_id}/mailbox/confirm/{attempt_id}')
def mailbox_confirmation(candidate_id: uuid.UUID, attempt_id: uuid.UUID,
                         principal: Principal = Depends(current_principal), db: Session = Depends(get_db),
                         firm_id: uuid.UUID = Depends(reader_firm_id)):
    _candidate(db, firm_id, candidate_id, principal)
    attempt = scoped(db, CandidateGoogleOAuthAttempt, firm_id).filter_by(
        id=attempt_id, candidate_id=candidate_id, initiated_by_user_id=principal.user_id).first()
    if not attempt or attempt.expires_at <= utcnow() or not attempt.pending_token_ciphertext:
        raise HTTPException(404, 'Mailbox confirmation expired. Connect again.')
    return {'address': attempt.pending_address}


@router.post('/firms/{firm_id}/candidates/{candidate_id}/mailbox/confirm/{attempt_id}')
def confirm_mailbox(candidate_id: uuid.UUID, attempt_id: uuid.UUID, background_tasks: BackgroundTasks,
                    principal: Principal = Depends(current_principal), db: Session = Depends(get_db),
                    firm_id: uuid.UUID = Depends(reader_firm_id)):
    with _attempt_lock(db, firm_id, candidate_id, attempt_id, principal.user_id):
        from backend.config import CANDIDATE_GMAIL_ENABLED
        if not CANDIDATE_GMAIL_ENABLED:
            raise HTTPException(503, "Candidate Gmail is disabled pending rollout approval.")
        principal = _authorize_oauth_write(db, principal, firm_id, candidate_id)
        attempt = scoped(db, CandidateGoogleOAuthAttempt, firm_id).filter_by(
            id=attempt_id, candidate_id=candidate_id, initiated_by_user_id=principal.user_id).with_for_update().first()
        if not attempt or attempt.expires_at <= utcnow() or not attempt.pending_token_ciphertext:
            if attempt:
                _retire_attempt(db, attempt)
            raise HTTPException(409, 'Mailbox confirmation expired. Connect again.')
        address = attempt.pending_address.strip().lower()
        # Uniqueness is firm-local; account lifecycle locks remain global only
        # to protect Google's shared grant, never to reveal another firm.
        existing = scoped(db, CandidateMailbox, firm_id, CandidateMailbox.id).filter(
            func.lower(func.trim(CandidateMailbox.address)) == address,
            CandidateMailbox.status.in_(['CONNECTED', 'ERROR']), CandidateMailbox.candidate_id != candidate_id).first()
        if existing:
            _retire_attempt(db, attempt)
            raise HTTPException(409, 'This email is already connected to another candidate.')
        mailbox = scoped(db, CandidateMailbox, firm_id).filter_by(candidate_id=candidate_id).with_for_update().first()
        if mailbox and mailbox.status != 'DISCONNECTED' and mailbox.address.strip().lower() != address:
            _retire_attempt(db, attempt)
            raise HTTPException(409, 'Disconnect the current mailbox before selecting another account.')
        if mailbox:
            _attribute_retained_messages(db, mailbox)
        else:
            mailbox = CandidateMailbox(firm_id=firm_id, candidate_id=candidate_id,
                address=address, connected_by_user_id=principal.user_id)
            db.add(mailbox)
        mailbox.address = address
        mailbox.status = 'CONNECTED'
        mailbox.refresh_token_ciphertext = attempt.pending_token_ciphertext
        mailbox.connected_by_user_id = principal.user_id
        mailbox.connected_at = utcnow()
        mailbox.history_id = None
        mailbox.initial_sync_complete = False
        mailbox.sync_state = 'QUEUED'
        finish_import(db, firm_id, mailbox.sync_job_id)
        mailbox.sync_job_id = None
        mailbox.sync_lease_until = None
        mailbox.last_sync_error = None
        attempt.pending_token_ciphertext = None
        attempt.confirmed_at = utcnow()
        db.flush()
        generation = mailbox.connected_at
        _audit(db, principal, firm_id=firm_id, candidate_id=candidate_id, entity_id=mailbox.id,
               summary=f'Confirmed candidate Google mailbox {address}; read-only consent notice v1.')
        db.commit()
        background_tasks.add_task(run_import, firm_id, candidate_id, generation)
        return _load_inbox(db, firm_id, candidate_id)


@router.delete('/firms/{firm_id}/candidates/{candidate_id}/mailbox/confirm/{attempt_id}')
def cancel_mailbox(candidate_id: uuid.UUID, attempt_id: uuid.UUID,
                   principal: Principal = Depends(current_principal), db: Session = Depends(get_db),
                   firm_id: uuid.UUID = Depends(reader_firm_id)):
    with _attempt_lock(db, firm_id, candidate_id, attempt_id, principal.user_id):
        principal = _authorize_oauth_write(db, principal, firm_id, candidate_id)
        attempt = scoped(db, CandidateGoogleOAuthAttempt, firm_id).filter_by(id=attempt_id,
            candidate_id=candidate_id, initiated_by_user_id=principal.user_id).first()
        if not attempt:
            raise HTTPException(404, 'Not found.')
        cleaned = _retire_attempt(db, attempt)
        return {'cleanup_pending': not cleaned}


@router.delete('/firms/{firm_id}/candidates/{candidate_id}/inbox-content')
def delete_retained_content(candidate_id: uuid.UUID, message_id: uuid.UUID | None = None, disconnect: bool = False,
                            principal: Principal = Depends(current_principal), db: Session = Depends(get_db),
                            firm_id: uuid.UUID = Depends(reader_firm_id)):
    if not can(principal, 'candidate.assign'):
        raise HTTPException(403, 'Only an Owner or Manager can delete retained email.')
    _candidate(db, firm_id, candidate_id, principal)
    if disconnect:
        with _mailbox_lock(db, firm_id, candidate_id):
            principal = _authorize_oauth_write(db, principal, firm_id, candidate_id)
            _disconnect_locked(db, principal, firm_id, candidate_id)
            return _erase_content(db, principal, firm_id, candidate_id, message_id)
    return _erase_content(db, principal, firm_id, candidate_id, message_id)


def _erase_content(db, principal, firm_id, candidate_id, message_id):
    principal = _authorize_oauth_write(db, principal, firm_id, candidate_id)
    if not can(principal, 'candidate.assign'):
        raise HTTPException(403, 'Only an Owner or Manager can delete retained email.')
    mailbox = scoped(db, CandidateMailbox, firm_id).filter_by(candidate_id=candidate_id).with_for_update().first()
    if mailbox:
        finish_import(db, firm_id, mailbox.sync_job_id)
        mailbox.sync_job_id = None
        mailbox.sync_lease_until = None
        mailbox.sync_state = 'IDLE'
    cutoff = utcnow()
    query = scoped(db, InboxMessage, firm_id).filter_by(candidate_id=candidate_id, deleted_at=None).filter(InboxMessage.created_at <= cutoff)
    if message_id:
        query = query.filter_by(id=message_id)
    message_ids = [row[0] for row in query.with_entities(InboxMessage.id).all()]
    # Erase in PostgreSQL: never materialize every retained full body in API memory.
    count = query.update({InboxMessage.body: None, InboxMessage.snippet: '',
        InboxMessage.subject: '[Email content deleted]', InboxMessage.from_name: '',
        InboxMessage.from_email: '', InboxMessage.thread_id: None,
        InboxMessage.deleted_at: cutoff, InboxMessage.content_revision: InboxMessage.content_revision + 1,
        InboxMessage.classification_token: None, InboxMessage.classification_state: 'EXCLUDED',
        InboxMessage.classification_lease_until: None, InboxMessage.classification_error: None,
        InboxMessage.sender_auth_result: 'UNKNOWN'}, synchronize_session=False)
    if message_ids:
        # Explicit erasure cancels pending review work; it is not acceptance of an AI status.
        scoped(db, ApplicationReview, firm_id).filter(
            ApplicationReview.inbox_message_id.in_(message_ids), ApplicationReview.state == 'PENDING').update({
                ApplicationReview.state: 'RESOLVED', ApplicationReview.revision: ApplicationReview.revision + 1,
                ApplicationReview.resolved_at: cutoff, ApplicationReview.resolved_by_user_id: principal.user_id,
                ApplicationReview.note: func.concat(func.coalesce(ApplicationReview.note, ''),
                    '\nClosed because email content was deleted; no status decision.')}, synchronize_session=False)
    clear_derived_results(db, firm_id, message_ids)
    if count:
        _audit(db, principal, firm_id=firm_id, candidate_id=candidate_id, entity_id=candidate_id,
               summary=f'Deleted retained email content ({count} messages); preserved application history references.')
    db.commit()
    return _load_inbox(db, firm_id, candidate_id)


def _command_seen(db, firm_id, candidate_id, message_id, principal, body, operation):
    import hashlib
    from backend.models.db import JobRun
    digest = hashlib.sha256(body.model_dump_json().encode()).hexdigest()
    journal_id = uuid.uuid5(uuid.NAMESPACE_URL, 'candidate-email-command:' + str(firm_id) + ':' + str(body.command_id))
    existing = scoped(db, JobRun, firm_id).filter_by(id=journal_id).first()
    identity = {'candidate_id': str(candidate_id), 'message_id': str(message_id),
                'actor_id': str(principal.user_id), 'operation': operation, 'payload_digest': digest}
    if existing:
        if existing.job_type != 'candidate_email_command' or existing.meta != identity:
            raise HTTPException(409, 'Command ID was used for another action.')
        return True
    db.add(JobRun(id=journal_id, firm_id=firm_id, job_type='candidate_email_command',
                  trigger='manual', status='completed', finished_at=utcnow(), meta=identity))
    return False


# The stages a BDE may confirm from an email review (PR 4, DEBUG D-10): every selectable stage except Saved.
REVIEW_STATUSES = frozenset({'applied', 'screening_call', 'shortlisted', 'interview_schedule_request',
                             'interview_scheduled', 'assessment', 'offer', 'move_on', 'incomplete_application'})


class EmailReviewBody(BaseModel):
    model_config = ConfigDict(extra='forbid')
    review_id: uuid.UUID
    command_id: uuid.UUID
    expected_review_revision: int = Field(ge=0)
    expected_content_revision: int = Field(ge=0)
    application_id: uuid.UUID | None = None
    expected_application_revision: int | None = Field(default=None, ge=0)
    action: str = Field(pattern='^(LINK_ONLY|KEEP_CURRENT|SET_STATUS|DISMISS_NON_APPLICATION)$')
    status: str | None = None
    note: str | None = Field(default=None, max_length=2000)


@router.get('/firms/{firm_id}/candidates/{candidate_id}/email-reviews')
def candidate_email_reviews(candidate_id: uuid.UUID, principal: Principal = Depends(current_principal),
                            db: Session = Depends(get_db), firm_id=Depends(reader_firm_id),
                            limit: int = Query(default=100, ge=1, le=200), after: str | None = None):
    """Pending reviews, newest first, with the email's subject and sender so a card is readable on its own
    (PR 4, DEBUG D-09). Cursor `after` = "<created_at ISO>|<review id>" of the last row of the previous page."""
    from datetime import datetime
    from sqlalchemy import and_, or_
    _candidate(db, firm_id, candidate_id, principal)
    query = scoped(db, ApplicationReview, firm_id).join(InboxMessage,
        ApplicationReview.inbox_message_id == InboxMessage.id).filter(
            ApplicationReview.candidate_id == candidate_id, ApplicationReview.state == 'PENDING',
            InboxMessage.candidate_id == candidate_id, InboxMessage.firm_id == firm_id,
            InboxMessage.deleted_at.is_(None), InboxMessage.hidden_at.is_(None))
    total = query.count()
    if principal.support_view_id is not None:
        return {'total_count': total, 'reviews': []}
    if after:
        try:
            stamp, last_id = after.split('|', 1)
            stamp, last_id = datetime.fromisoformat(stamp), uuid.UUID(last_id)
        except ValueError:
            raise HTTPException(400, 'Invalid review cursor.') from None
        query = query.filter(or_(ApplicationReview.created_at < stamp,
                                 and_(ApplicationReview.created_at == stamp, ApplicationReview.id < last_id)))
    rows = (query.add_entity(InboxMessage)
            .order_by(ApplicationReview.created_at.desc(), ApplicationReview.id.desc()).limit(limit + 1).all())
    page = rows[:limit]
    last = page[-1][0] if page else None
    return {'total_count': total, 'reviews': [{'id': str(r.id), 'message_id': str(r.inbox_message_id),
            'application_id': str(r.application_id) if r.application_id else None,
            'revision': r.revision, 'application_revision': r.application_revision,
            'reason': r.reason, 'classification_id': str(r.classification_id) if r.classification_id else None,
            'created_at': r.created_at.isoformat(), 'subject': m.subject or '', 'from_name': m.from_name or '',
            'received_at': m.received_at.isoformat() if m.received_at else None}
            for r, m in page],
            'next_cursor': f'{last.created_at.isoformat()}|{last.id}' if len(rows) > limit and last else None}


@router.patch('/firms/{firm_id}/candidates/{candidate_id}/inbox-messages/{message_id}/review')
def review_candidate_email(candidate_id: uuid.UUID, message_id: uuid.UUID, body: EmailReviewBody,
                            principal: Principal = Depends(current_principal), db: Session = Depends(get_db),
                            firm_id=Depends(reader_firm_id)):
    from backend.applications.tracking import move
    from backend.inbox.application_matching import submitted_applications
    if not can(principal, 'application.move'):
        raise HTTPException(403, "You don't have permission to review this email.")
    _candidate(db, firm_id, candidate_id, principal)
    try:
        message = readable(scoped(db, InboxMessage, firm_id).filter_by(
            id=message_id, candidate_id=candidate_id)).with_for_update().first()
        if not message:
            raise HTTPException(404, 'Email not found.')
        if _command_seen(db, firm_id, candidate_id, message_id, principal, body, 'review'):
            return _load_inbox(db, firm_id, candidate_id, message_id=message_id)
        review = scoped(db, ApplicationReview, firm_id).filter_by(
            id=body.review_id, candidate_id=candidate_id, inbox_message_id=message.id).with_for_update().first()
        if not review:
            raise HTTPException(404, 'Review not found.')
        if message.content_revision != body.expected_content_revision:
            raise HTTPException(409, 'Email changed. Reload before reviewing.')
        if review.state != 'PENDING' or review.revision != body.expected_review_revision:
            raise HTTPException(409, 'Review changed. Reload before reviewing.')
        if body.action == 'DISMISS_NON_APPLICATION':
            # Dismissing is about the email, never an application: no link, no application revision (D-08).
            review.state = 'RESOLVED'
            review.resolved_at = utcnow()
            review.resolved_by_user_id = principal.user_id
            review.note = body.note
            review.revision += 1
            _audit(db, principal, firm_id=firm_id, candidate_id=candidate_id, entity_id=review.id,
                   summary='Dismissed candidate email as not about an application; no status change.')
            db.commit()
            return _load_inbox(db, firm_id, candidate_id, message_id=message.id)
        if body.action == 'SET_STATUS' and body.status not in REVIEW_STATUSES:
            raise HTTPException(400, 'A review can set any stage except Saved.')
        target_id = body.application_id or review.application_id
        if message.application_id and target_id != message.application_id:
            raise HTTPException(409, 'Email is already linked to another application.')
        app = submitted_applications(db, firm_id, candidate_id).filter_by(id=target_id).with_for_update().first() if target_id else None
        if target_id and app is None:
            raise HTTPException(404, 'Submitted application not found.')
        if app and body.expected_application_revision != app.status_revision:
            raise HTTPException(409, 'Application changed. Reload before reviewing.')
        if body.action in {'LINK_ONLY', 'SET_STATUS', 'KEEP_CURRENT'} and app is None:
            raise HTTPException(400, 'Link a submitted application first.')
        if review.application_id is None and app:
            duplicate = scoped(db, ApplicationReview, firm_id).filter_by(
                application_id=app.id, inbox_message_id=message.id, state='PENDING').first()
            if duplicate:
                raise HTTPException(409, 'This email already has an application review.')
            message.application_id = app.id
            review.application_id = app.id
            review.application_revision = app.status_revision
        if body.action in {'SET_STATUS', 'KEEP_CURRENT'}:
            status = body.status if body.action == 'SET_STATUS' else app.status
            move(db, app, principal, status=status, expected_revision=body.expected_application_revision,
                 command_id=body.command_id, note=body.note, review=review)
        else:
            # Link only: the email is about this application and its status stays as it is. Resolved like Dismiss.
            review.state = 'RESOLVED'
            review.resolved_at = utcnow()
            review.resolved_by_user_id = principal.user_id
            review.note = body.note
            review.revision += 1
            _audit(db, principal, firm_id=firm_id, candidate_id=candidate_id, entity_id=review.id,
                   summary='Reviewed candidate email linkage/disposition; no automatic status change.')
        db.commit()
        logger.info("Review %s on email %s: %s by user %s", review.id, message.id, body.action, principal.user_id)
        return _load_inbox(db, firm_id, candidate_id, message_id=message.id)
    except Exception:
        db.rollback()
        raise


class ClassificationCommand(BaseModel):
    model_config = ConfigDict(extra='forbid')
    command_id: uuid.UUID
    expected_content_revision: int = Field(ge=0)
    expected_result_version: int = Field(ge=0)


def _queue_classification(db, firm_id, candidate_id, message_id, principal, body, *, rerun):
    permission = 'email.reclassify' if rerun else 'email.retry'
    if not can(principal, permission):
        raise HTTPException(403, "You don't have permission for this classification action.")
    _candidate(db, firm_id, candidate_id, principal)
    from backend.inbox.classification_worker import _current, enabled
    if _command_seen(db, firm_id, candidate_id, message_id, principal, body, 'reclassify' if rerun else 'retry'):
        return
    if not enabled():
        raise HTTPException(409, 'Classification is disabled or not authorized for real mail.')
    from backend.inbox import classification_worker, classifier_pause
    if classifier_pause.active_pause(db, classification_worker.ai_config('email_classification', db=db)) is not None:
        raise HTTPException(409, 'Classifier paused: credentials rejected.')
    row = readable(scoped(db, InboxMessage, firm_id).filter_by(
        id=message_id, candidate_id=candidate_id)).with_for_update().first()
    if not row:
        raise HTTPException(404, 'Email not found.')
    if (row.content_revision, row.classification_version) != (body.expected_content_revision, body.expected_result_version):
        raise HTTPException(409, 'Email classification changed. Reload before retrying.')
    if not _current(db, row):
        raise HTTPException(409, 'Only the current connected source can be classified.')
    expected_state = 'DONE' if rerun else 'ERROR'
    if row.classification_state != expected_state:
        raise HTTPException(409, 'Email is not eligible for this classification action.')
    row.classification_state = 'PENDING'
    row.classification_attempts = 0
    row.classification_token = None
    row.classification_lease_until = row.classification_next_retry_at = None
    row.classification_error = None
    _audit(db, principal, firm_id=firm_id, candidate_id=candidate_id, entity_id=row.id,
           summary='Requested versioned email reclassification.' if rerun else 'Requested failed email classification retry.')
    db.commit()
    logger.info("Email %s queued for %s by user %s", row.id, 'reclassification' if rerun else 'retry', principal.user_id)


@router.post('/firms/{firm_id}/candidates/{candidate_id}/inbox-messages/{message_id}/review/open')
def open_candidate_email_review(candidate_id: uuid.UUID, message_id: uuid.UUID,
                                principal: Principal = Depends(current_principal), db: Session = Depends(get_db),
                                firm_id=Depends(reader_firm_id)):
    """A BDE opens a review for an email the classifier put aside as Other (shown as Irrelevant), so the usual review
    panel (link, set a status, dismiss) works on it. Only emails a person chooses join the queue (2026-11-09)."""
    if not can(principal, 'application.move'):
        raise HTTPException(403, "You don't have permission to review this email.")
    _candidate(db, firm_id, candidate_id, principal)
    message = readable(scoped(db, InboxMessage, firm_id).filter_by(
        id=message_id, candidate_id=candidate_id)).with_for_update().first()
    if not message:
        raise HTTPException(404, 'Email not found.')
    pending = scoped(db, ApplicationReview, firm_id).filter_by(inbox_message_id=message.id, state='PENDING').first()
    if pending:
        return {'review_id': str(pending.id)}
    record = scoped(db, EmailClassification, firm_id).filter_by(
        inbox_message_id=message.id, result_version=message.classification_version,
        content_revision=message.content_revision).first()
    if message.classification_state != 'DONE' or record is None or record.outcome != 'OTHER':
        raise HTTPException(409, 'Only an email marked Irrelevant can be opened for review.')
    if scoped(db, ApplicationReview, firm_id).filter_by(
            inbox_message_id=message.id, classification_version=record.result_version).first():
        raise HTTPException(409, 'This email was already reviewed. Reclassify it to review it again.')
    app = (scoped(db, Application, firm_id).filter_by(id=message.application_id, candidate_id=candidate_id).first()
           if message.application_id else None)
    review = ApplicationReview(firm_id=firm_id, candidate_id=candidate_id, inbox_message_id=message.id,
                               application_id=app.id if app else None,
                               application_revision=app.status_revision if app else None,
                               classification_id=record.id, classification_version=record.result_version,
                               reason='MANUAL_REVIEW')
    db.add(review)
    db.flush()
    _audit(db, principal, firm_id=firm_id, candidate_id=candidate_id, entity_id=review.id,
           summary='Opened an email marked Irrelevant for review')
    db.commit()
    return {'review_id': str(review.id)}


@router.post('/firms/{firm_id}/candidates/{candidate_id}/inbox-messages/{message_id}/classification/retry')
def retry_candidate_classification(candidate_id: uuid.UUID, message_id: uuid.UUID, body: ClassificationCommand,
                                    background_tasks: BackgroundTasks, principal: Principal = Depends(current_principal),
                                    db: Session = Depends(get_db), firm_id=Depends(reader_firm_id)):
    _queue_classification(db, firm_id, candidate_id, message_id, principal, body, rerun=False)
    from backend.inbox.classification_worker import wake_worker
    background_tasks.add_task(wake_worker)
    return {'state': 'PENDING'}


@router.post('/firms/{firm_id}/candidates/{candidate_id}/inbox-messages/{message_id}/classification/reclassify')
def reclassify_candidate_email(candidate_id: uuid.UUID, message_id: uuid.UUID, body: ClassificationCommand,
                                background_tasks: BackgroundTasks, principal: Principal = Depends(current_principal),
                                db: Session = Depends(get_db), firm_id=Depends(reader_firm_id)):
    _queue_classification(db, firm_id, candidate_id, message_id, principal, body, rerun=True)
    from backend.inbox.classification_worker import wake_worker
    background_tasks.add_task(wake_worker)
    return {'state': 'PENDING'}
