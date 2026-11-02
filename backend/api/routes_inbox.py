"""Candidate-owned Gmail inbox connection, sync and read routes (D8)."""
from __future__ import annotations

import uuid
from datetime import timedelta
from urllib.parse import urlencode, urlsplit, urlunsplit, parse_qsl

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.auth.policy import can
from backend.auth.scoping import reader_firm_id, scoped
from backend.auth.sessions import Principal
from backend.api.routes_auth import current_principal
from backend.api.routes_candidates import _candidate as visible_candidate
from backend.inbox.google_oauth import (build_authorization, encrypt_secret, exchange_code, state_digest,
                                        validate_return_to, decrypt_content, decrypt_secret, revoke_token)
from backend.inbox.sync_jobs import run_import
from backend.inbox.gmail_sync import ReconnectRequired, sync_mailbox, record_sync_error
from backend.models.candidates import Candidate, CandidateGoogleOAuthAttempt, CandidateMailbox, InboxMessage
from backend.models.db import get_db, utcnow

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
        "from_name": message.from_name, "from_email": message.from_email, "subject": message.subject,
        "snippet": "" if hide_body else decrypt_content(message.snippet),
        "body": "" if hide_body or not include_body else decrypt_content(message.body or message.snippet),
        "received_at": message.received_at.isoformat(), "is_read": message.is_read,
        "thread_id": message.thread_id, "source_address": message.source_address,

    }


def _inbox_json(db: Session, firm_id: uuid.UUID, candidate_id: uuid.UUID, mailbox: CandidateMailbox | None,
                messages: list[InboxMessage], *, hide_body: bool = False, body_message_id=None) -> dict:
    connection = None
    if mailbox:
        connection = {
            "firm_id": str(mailbox.firm_id), "candidate_id": str(mailbox.candidate_id),
            "provider": "GOOGLE", "address": mailbox.address,
            "connected_at": mailbox.connected_at.isoformat(),
            "last_synced_at": mailbox.last_synced_at.isoformat() if mailbox.last_synced_at else None,
            "status": mailbox.status, "last_sync_error": mailbox.last_sync_error,
            "sync_state": mailbox.sync_state,
        }
    return {"firm_id": str(firm_id), "candidate_id": str(candidate_id), "connection": connection,
            "messages": [_message_json(item, hide_body=hide_body, include_body=item.id == body_message_id) for item in messages]}


def _load_inbox(db: Session, firm_id: uuid.UUID, candidate_id: uuid.UUID, limit: int = 200,
                message_id: uuid.UUID | None = None, *, offset: int = 0, hide_body: bool = False) -> dict:
    mailbox = scoped(db, CandidateMailbox, firm_id).filter_by(candidate_id=candidate_id).first()
    messages = scoped(db, InboxMessage, firm_id).filter_by(candidate_id=candidate_id, deleted_at=None).order_by(
        InboxMessage.received_at.desc(), InboxMessage.id).offset(offset).limit(limit).all()
    # A review link must also open an older message outside the latest Inbox page.
    if message_id is not None and all(item.id != message_id for item in messages):
        message = scoped(db, InboxMessage, firm_id).filter_by(candidate_id=candidate_id, id=message_id, deleted_at=None).first()
        if message is None:
            raise HTTPException(status_code=404, detail="Email not found.")
        messages.append(message)
    return _inbox_json(db, firm_id, candidate_id, mailbox, messages, hide_body=hide_body, body_message_id=message_id)


@router.get("/firms/{firm_id}/candidates/{candidate_id}/inbox")
def candidate_inbox(candidate_id: uuid.UUID, principal: Principal = Depends(current_principal),
                    db: Session = Depends(get_db), firm_id: uuid.UUID = Depends(reader_firm_id),
                    limit: int = Query(default=200, ge=1, le=500), message_id: uuid.UUID | None = None, offset: int = Query(default=0, ge=0)):
    _candidate(db, firm_id, candidate_id, principal)
    return _load_inbox(db, firm_id, candidate_id, limit, message_id,
                       offset=offset, hide_body=principal.support_view_id is not None)


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
    attempt.consumed_at = utcnow()
    verifier_ciphertext = attempt.code_verifier_ciphertext
    attempt.code_verifier_ciphertext = b""
    scoped(db, CandidateGoogleOAuthAttempt, attempt.firm_id).filter(
        CandidateGoogleOAuthAttempt.expires_at <= utcnow()).delete(synchronize_session=False)
    db.commit()  # Consume state before the network call so the authorization code cannot be replayed.
    result = "failed"
    refresh_token = None
    if not error and code:
        try:
            from backend.inbox.google_oauth import decrypt_secret
            address, refresh_token = exchange_code(code, decrypt_secret(verifier_ciphertext))
            principal = _authorize_oauth_write(db, principal, attempt.firm_id, attempt.candidate_id)
            attempt.pending_address = address
            attempt.pending_token_ciphertext = encrypt_secret(refresh_token)
            db.commit()
            parsed = urlsplit(return_to)
            query = dict(parse_qsl(parsed.query, keep_blank_values=True))
            query['mailbox_confirmation'] = str(attempt.id)
            return RedirectResponse(urlunsplit(('', '', parsed.path, urlencode(query), '')), status_code=303)

        except HTTPException:
            db.rollback()
            if refresh_token:
                revoke_token(refresh_token)
            raise
        except Exception:
            db.rollback()
            if refresh_token:
                revoke_token(refresh_token)
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
    from sqlalchemy import text
    from backend.models.db import engine
    mailbox = scoped(db, CandidateMailbox, firm_id).filter_by(candidate_id=candidate_id).first()
    if not mailbox or mailbox.status == 'DISCONNECTED':
        return _load_inbox(db, firm_id, candidate_id)
    address = mailbox.address.strip().lower()
    db.rollback()  # No row lock or open transaction across the Google request.
    with engine.connect() as identity_lock:
        identity_lock.execute(text('SELECT pg_advisory_lock(hashtextextended(:address, 104))'), {'address': address})
        try:
            mailbox = scoped(db, CandidateMailbox, firm_id).filter_by(candidate_id=candidate_id).populate_existing().with_for_update().first()
            if not mailbox or mailbox.address.strip().lower() != address or mailbox.status == 'DISCONNECTED':
                db.rollback()
                return _load_inbox(db, firm_id, candidate_id)
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
                if mailbox and mailbox.status == 'DISCONNECTED':
                    mailbox.last_sync_error = 'Sync stopped. Remove BenchQ access at https://myaccount.google.com/permissions because Google revocation could not be confirmed.'
                    db.commit()
        finally:
            identity_lock.execute(text('SELECT pg_advisory_unlock(hashtextextended(:address, 104))'), {'address': address})
    return _load_inbox(db, firm_id, candidate_id)


@router.patch("/firms/{firm_id}/candidates/{candidate_id}/inbox-messages/{message_id}/read")
def mark_candidate_message_read(candidate_id: uuid.UUID, message_id: uuid.UUID,
                                principal: Principal = Depends(current_principal), db: Session = Depends(get_db),
                                firm_id: uuid.UUID = Depends(reader_firm_id)):
    if not can(principal, "candidate.edit"):
        raise HTTPException(status_code=403, detail="You don't have permission to mark this email read.")
    _candidate(db, firm_id, candidate_id, principal)
    message = scoped(db, InboxMessage, firm_id).filter_by(
        id=message_id, candidate_id=candidate_id).with_for_update().first()
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
    from sqlalchemy import text, func
    from backend.config import CANDIDATE_GMAIL_ENABLED
    if not CANDIDATE_GMAIL_ENABLED:
        raise HTTPException(503, "Candidate Gmail is disabled pending rollout approval.")
    principal = _authorize_oauth_write(db, principal, firm_id, candidate_id)
    attempt = scoped(db, CandidateGoogleOAuthAttempt, firm_id).filter_by(
        id=attempt_id, candidate_id=candidate_id, initiated_by_user_id=principal.user_id).with_for_update().first()
    if not attempt or attempt.expires_at <= utcnow() or not attempt.pending_token_ciphertext:
        raise HTTPException(409, 'Mailbox confirmation expired. Connect again.')
    address = attempt.pending_address.strip().lower()
    # Serialize this identity across firms without revealing another firm's data.
    db.execute(text('SELECT pg_advisory_xact_lock(hashtextextended(:address, 104))'), {'address': address})
    existing = db.query(CandidateMailbox.id).filter(
        func.lower(func.trim(CandidateMailbox.address)) == address,
        CandidateMailbox.status.in_(['CONNECTED', 'ERROR']), CandidateMailbox.candidate_id != candidate_id).first()
    if existing:
        raise HTTPException(409, 'This Google mailbox is already connected. Disconnect it before connecting here.')
    mailbox = scoped(db, CandidateMailbox, firm_id).filter_by(candidate_id=candidate_id).with_for_update().first()
    if mailbox and mailbox.status != 'DISCONNECTED' and mailbox.address.strip().lower() != address:
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
           summary='Confirmed candidate Google mailbox and read-only consent notice.')
    db.commit()
    background_tasks.add_task(run_import, firm_id, candidate_id, generation)
    return _load_inbox(db, firm_id, candidate_id)


@router.delete('/firms/{firm_id}/candidates/{candidate_id}/inbox-content')
def delete_retained_content(candidate_id: uuid.UUID, message_id: uuid.UUID | None = None,
                            principal: Principal = Depends(current_principal), db: Session = Depends(get_db),
                            firm_id: uuid.UUID = Depends(reader_firm_id)):
    if not can(principal, 'candidate.assign'):
        raise HTTPException(403, 'Only an Owner or Manager can delete retained email.')
    _candidate(db, firm_id, candidate_id, principal)
    query = scoped(db, InboxMessage, firm_id).filter_by(candidate_id=candidate_id, deleted_at=None)
    if message_id:
        query = query.filter_by(id=message_id)
    rows = query.with_for_update().all()
    for row in rows:
        row.body = None
        row.snippet = ''
        row.subject = '[Email content deleted]'
        row.from_name = ''
        row.from_email = ''
        row.thread_id = None
        row.deleted_at = utcnow()
    if rows:
        _audit(db, principal, firm_id=firm_id, candidate_id=candidate_id, entity_id=candidate_id,
               summary=f'Deleted retained email content ({len(rows)} messages); preserved application history references.')
    db.commit()
    return _load_inbox(db, firm_id, candidate_id)
