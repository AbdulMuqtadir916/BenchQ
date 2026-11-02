"""Candidate-owned Gmail inbox connection, sync and read routes (D8)."""
from __future__ import annotations

import uuid
import base64
import json
from contextlib import contextmanager
from datetime import datetime
from datetime import timedelta
from urllib.parse import urlencode, urlsplit, urlunsplit, parse_qsl

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy import and_, or_, func, text
from sqlalchemy.orm import Session

from backend.auth.policy import can
from backend.auth.scoping import reader_firm_id, scoped
from backend.auth.sessions import Principal
from backend.api.routes_auth import current_principal
from backend.api.routes_candidates import _candidate as visible_candidate
from backend.inbox.google_oauth import (build_authorization, encrypt_secret, exchange_code, state_digest,
                                        validate_return_to, decrypt_content, decrypt_secret, revoke_token, OAuthGrantError, identify_refresh_token)
from backend.inbox.sync_jobs import run_import
from backend.inbox.gmail_sync import ReconnectRequired, sync_mailbox, record_sync_error
from backend.models.candidates import Candidate, CandidateGoogleOAuthAttempt, CandidateMailbox, InboxMessage
from backend.models.db import get_db, utcnow, SessionLocal, engine

router = APIRouter(tags=["candidate-inbox"])


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


def _message_json(message: InboxMessage, *, hide_body: bool = False, include_body: bool = True) -> dict:
    return {
        "id": str(message.id), "firm_id": str(message.firm_id), "candidate_id": str(message.candidate_id),
        "application_id": str(message.application_id) if message.application_id else None,
        "from_name": "" if hide_body else message.from_name, "from_email": "" if hide_body else message.from_email,
        "subject": "" if hide_body else message.subject,
        "snippet": "" if hide_body else decrypt_content(message.snippet),
        "body": "" if hide_body or not include_body else decrypt_content(message.body or message.snippet),
        "received_at": message.received_at.isoformat(), "is_read": message.is_read,
        "thread_id": None if hide_body else message.thread_id, "source_address": "" if hide_body else message.source_address,

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
    return {"firm_id": str(firm_id), "candidate_id": str(candidate_id), "connection": connection,
            "messages": [_message_json(item, hide_body=hide_body, include_body=item.id == body_message_id) for item in messages]}


def _cursor(message):
    return base64.urlsafe_b64encode(json.dumps([message.received_at.isoformat(), str(message.id)]).encode()).decode()


def _load_inbox(db: Session, firm_id: uuid.UUID, candidate_id: uuid.UUID, limit: int = 200,
                message_id: uuid.UUID | None = None, *, cursor: str | None = None, hide_body: bool = False) -> dict:
    mailbox = scoped(db, CandidateMailbox, firm_id).filter_by(candidate_id=candidate_id).first()
    query = scoped(db, InboxMessage, firm_id).filter_by(candidate_id=candidate_id, deleted_at=None)
    total = query.count()
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
        selected = scoped(db, InboxMessage, firm_id).filter_by(candidate_id=candidate_id, id=message_id, deleted_at=None).first()
        if selected is None:
            raise HTTPException(404, 'Email not found.')
        messages = [selected]
    result = _inbox_json(db, firm_id, candidate_id, mailbox, [] if hide_body else messages, hide_body=hide_body, body_message_id=message_id)
    result.update(next_cursor=next_cursor, total_count=total)
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
def _grant_guard():
    """Serialize grant activation/exchange/revoke without row locks over Google I/O.

    Google revokes every client token for an account/project. The account is not
    known before exchange, so the short provider lifecycle uses a global try-lock.
    Busy callers can retry; cleanup waits for the next scheduled pass.
    """
    with engine.connect() as conn:
        acquired = conn.execute(text('SELECT pg_try_advisory_lock(104, 104)')).scalar()
        if not acquired:
            raise HTTPException(503, 'Another Google connection is being processed. Try again shortly.')
        try:
            yield
        finally:
            conn.execute(text('SELECT pg_advisory_unlock(104, 104)'))


def _retire_attempt(db, attempt):
    """Called under the grant guard. Retain failed cleanup encrypted for retry."""
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
        except Exception:
            return False  # Identity/provider outage: keep encrypted for scheduled retry.
        attempt.pending_address = address
    # Cross-firm existence probe is internal only: never revoke another live grant.
    live = db.query(CandidateMailbox.id).filter(func.lower(func.trim(CandidateMailbox.address)) == address,
        CandidateMailbox.status.in_(['CONNECTED', 'ERROR'])).first()
    newer_pending = db.query(CandidateGoogleOAuthAttempt.id).filter(
        func.lower(CandidateGoogleOAuthAttempt.pending_address) == address,
        CandidateGoogleOAuthAttempt.id != attempt.id,
        CandidateGoogleOAuthAttempt.expires_at > utcnow(),
        CandidateGoogleOAuthAttempt.pending_token_ciphertext.isnot(None)).first()
    db.commit()  # Never hold row locks while calling Google.
    try:
        done = bool(live or newer_pending) or revoke_token(decrypt_secret(token))
    except RuntimeError:
        done = False
    attempt = db.get(CandidateGoogleOAuthAttempt, attempt.id)
    if done:
        attempt.pending_token_ciphertext = None
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
            with _grant_guard(), SessionLocal() as db:
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
    with _grant_guard():
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
            except Exception:
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
    _audit(db, principal, firm_id=firm_id, candidate_id=candidate_id, entity_id=mailbox.id,
           summary='Requested candidate Google inbox sync.')
    db.commit()
    background_tasks.add_task(run_import, firm_id, candidate_id, generation)
    return {'imported': 0, 'inbox': _load_inbox(db, firm_id, candidate_id)}


@router.delete("/firms/{firm_id}/candidates/{candidate_id}/mailbox")
def disconnect_candidate_inbox(candidate_id: uuid.UUID, principal: Principal = Depends(current_principal),
                               db: Session = Depends(get_db), firm_id: uuid.UUID = Depends(reader_firm_id)):
    if not can(principal, "candidate.edit"):
        raise HTTPException(status_code=403, detail="You don't have permission to disconnect this inbox.")
    _candidate(db, firm_id, candidate_id, principal)
    with _grant_guard():
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
    mailbox.status = 'DISCONNECTED'
    mailbox.refresh_token_ciphertext = None
    mailbox.history_id = None
    mailbox.sync_job_id = None
    mailbox.sync_lease_until = None
    mailbox.sync_state = 'IDLE'
    mailbox.last_sync_error = None
    _audit(db, principal, firm_id=firm_id, candidate_id=candidate_id, entity_id=mailbox.id,
           summary='Disconnected candidate Google inbox; retained imported email.')
    db.commit()
    revoked = True
    if ciphertext:
        try:
            revoked = revoke_token(decrypt_secret(ciphertext))
        except RuntimeError:
            revoked = False
    if not revoked:
        mailbox = scoped(db, CandidateMailbox, firm_id).filter_by(candidate_id=candidate_id).with_for_update().first()
        mailbox.last_sync_error = 'Sync stopped. Remove BenchQ access at https://myaccount.google.com/permissions because Google revocation could not be confirmed.'
        db.commit()


@router.patch("/firms/{firm_id}/candidates/{candidate_id}/inbox-messages/{message_id}/read")
def mark_candidate_message_read(candidate_id: uuid.UUID, message_id: uuid.UUID,
                                principal: Principal = Depends(current_principal), db: Session = Depends(get_db),
                                firm_id: uuid.UUID = Depends(reader_firm_id)):
    if not can(principal, "candidate.edit"):
        raise HTTPException(status_code=403, detail="You don't have permission to mark this email read.")
    _candidate(db, firm_id, candidate_id, principal)
    message = scoped(db, InboxMessage, firm_id).filter_by(
        id=message_id, candidate_id=candidate_id, deleted_at=None).with_for_update().first()
    if message is None:
        raise HTTPException(status_code=404, detail="Inbox message not found.")
    if not message.is_read:
        message.is_read = True  # Local state only; Gmail read status is never changed.
        _audit(db, principal, firm_id=firm_id, candidate_id=candidate_id, entity_id=message.id,
               summary="Marked candidate email read in BenchQ.")
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
    with _grant_guard():
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
        # Serialize this identity across firms without revealing another firm's data.
        existing = db.query(CandidateMailbox.id).filter(
            func.lower(func.trim(CandidateMailbox.address)) == address,
            CandidateMailbox.status.in_(['CONNECTED', 'ERROR']), CandidateMailbox.candidate_id != candidate_id).first()
        if existing:
            _retire_attempt(db, attempt)
            raise HTTPException(409, 'This mailbox cannot be connected. Contact your manager.')
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
    with _grant_guard():
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
        with _grant_guard():
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
        mailbox.sync_job_id = None
        mailbox.sync_lease_until = None
        mailbox.sync_state = 'IDLE'
    cutoff = utcnow()
    query = scoped(db, InboxMessage, firm_id).filter_by(candidate_id=candidate_id, deleted_at=None).filter(InboxMessage.created_at <= cutoff)
    if message_id:
        query = query.filter_by(id=message_id)
    # Erase in PostgreSQL: never materialize every retained full body in API memory.
    count = query.update({InboxMessage.body: None, InboxMessage.snippet: '',
        InboxMessage.subject: '[Email content deleted]', InboxMessage.from_name: '',
        InboxMessage.from_email: '', InboxMessage.thread_id: None,
        InboxMessage.deleted_at: cutoff}, synchronize_session=False)
    if count:
        _audit(db, principal, firm_id=firm_id, candidate_id=candidate_id, entity_id=candidate_id,
               summary=f'Deleted retained email content ({count} messages); preserved application history references.')
    db.commit()
    return _load_inbox(db, firm_id, candidate_id)
