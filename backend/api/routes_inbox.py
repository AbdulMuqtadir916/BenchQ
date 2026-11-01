"""Candidate-owned Gmail inbox connection, sync and read routes (D8)."""
from __future__ import annotations

import uuid
from datetime import timedelta
from urllib.parse import urlencode, urlsplit, urlunsplit, parse_qsl

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.auth.policy import can
from backend.auth.scoping import reader_firm_id, scoped
from backend.auth.sessions import Principal
from backend.api.routes_auth import current_principal
from backend.api.routes_candidates import _candidate as visible_candidate
from backend.inbox.google_oauth import (build_authorization, encrypt_secret, exchange_code, state_digest,
                                        validate_return_to)
from backend.inbox.gmail_sync import sync_mailbox, record_sync_error
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


def _message_json(message: InboxMessage) -> dict:
    return {
        "id": str(message.id), "firm_id": str(message.firm_id), "candidate_id": str(message.candidate_id),
        "application_id": str(message.application_id) if message.application_id else None,
        "from_name": message.from_name, "from_email": message.from_email, "subject": message.subject,
        "snippet": message.snippet, "body": message.body or message.snippet,
        "received_at": message.received_at.isoformat(), "is_read": message.is_read,
        "thread_id": message.thread_id, "source_address": message.source_address,

    }


def _inbox_json(db: Session, firm_id: uuid.UUID, candidate_id: uuid.UUID, mailbox: CandidateMailbox | None,
                messages: list[InboxMessage]) -> dict:
    connection = None
    if mailbox:
        connection = {
            "firm_id": str(mailbox.firm_id), "candidate_id": str(mailbox.candidate_id),
            "provider": "GOOGLE", "address": mailbox.address,
            "connected_at": mailbox.connected_at.isoformat(),
            "last_synced_at": mailbox.last_synced_at.isoformat() if mailbox.last_synced_at else None,
            "status": mailbox.status, "last_sync_error": mailbox.last_sync_error,
        }
    return {"firm_id": str(firm_id), "candidate_id": str(candidate_id), "connection": connection,
            "messages": [_message_json(item) for item in messages]}


def _load_inbox(db: Session, firm_id: uuid.UUID, candidate_id: uuid.UUID, limit: int = 200,
                message_id: uuid.UUID | None = None) -> dict:
    mailbox = scoped(db, CandidateMailbox, firm_id).filter_by(candidate_id=candidate_id).first()
    messages = scoped(db, InboxMessage, firm_id).filter_by(candidate_id=candidate_id).order_by(
        InboxMessage.received_at.desc()).limit(limit).all()
    # A review link must also open an older message outside the latest Inbox page.
    if message_id is not None and all(item.id != message_id for item in messages):
        message = scoped(db, InboxMessage, firm_id).filter_by(candidate_id=candidate_id, id=message_id).first()
        if message is None:
            raise HTTPException(status_code=404, detail="Email not found.")
        messages.append(message)
    return _inbox_json(db, firm_id, candidate_id, mailbox, messages)


@router.get("/firms/{firm_id}/candidates/{candidate_id}/inbox")
def candidate_inbox(candidate_id: uuid.UUID, principal: Principal = Depends(current_principal),
                    db: Session = Depends(get_db), firm_id: uuid.UUID = Depends(reader_firm_id),
                    limit: int = Query(default=200, ge=1, le=500), message_id: uuid.UUID | None = None):
    _candidate(db, firm_id, candidate_id, principal)
    return _load_inbox(db, firm_id, candidate_id, limit, message_id)


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
    if not error and code:
        try:
            from backend.inbox.google_oauth import decrypt_secret
            address, refresh_token = exchange_code(code, decrypt_secret(verifier_ciphertext))
            principal = _authorize_oauth_write(db, principal, attempt.firm_id, attempt.candidate_id)
            mailbox = scoped(db, CandidateMailbox, attempt.firm_id).filter_by(
                candidate_id=attempt.candidate_id).with_for_update().first()
            if (mailbox is not None and mailbox.status != "DISCONNECTED"
                    and mailbox.address.strip().casefold() != address.strip().casefold()):
                raise HTTPException(409, "Disconnect the current mailbox before connecting a different Google account.")
            if mailbox is not None:
                _attribute_retained_messages(db, mailbox)
            if mailbox is None:
                mailbox = CandidateMailbox(
                    firm_id=attempt.firm_id, candidate_id=attempt.candidate_id,
                    address=address, connected_by_user_id=principal.user_id,
                )
                db.add(mailbox)
            mailbox.address = address
            mailbox.status = "CONNECTED"
            mailbox.connected_by_user_id = principal.user_id
            mailbox.refresh_token_ciphertext = encrypt_secret(refresh_token)
            mailbox.history_id = None
            mailbox.initial_sync_complete = False
            mailbox.connected_at = utcnow()
            connection_started_at = mailbox.connected_at
            mailbox.last_sync_error = None
            db.flush()
            _audit(db, principal, firm_id=attempt.firm_id, candidate_id=attempt.candidate_id,
                   entity_id=mailbox.id, summary="Connected candidate Google inbox.")
            db.commit()
            try:
                mailbox = scoped(db, CandidateMailbox, attempt.firm_id).filter_by(
                    candidate_id=attempt.candidate_id).populate_existing().with_for_update().first()
                if (mailbox is None or mailbox.status != "CONNECTED"
                        or mailbox.connected_at != connection_started_at):
                    raise HTTPException(409, "Mailbox connection changed. Reload the candidate Inbox.")
                imported_message_ids = []
                imported = sync_mailbox(db, mailbox, imported_message_ids=imported_message_ids)
                if imported:
                    from backend.auth.ledger import record_automated
                    record_automated(db, actor_type="SYSTEM", actor_name="Gmail sync", action="CREATE",
                        entity_type="email", entity_id=mailbox.id, entity_label="Candidate inbox",
                        summary=f"Imported {imported} candidate emails.", firm_id=attempt.firm_id,
                        candidate_id=attempt.candidate_id)
                db.commit()
            except HTTPException:
                db.rollback()
                raise
            except Exception:
                db.rollback()
                record_sync_error(db, attempt.firm_id, attempt.candidate_id, connection_started_at)
                db.commit()
            result = "connected"
        except HTTPException:
            db.rollback()
            raise
        except Exception:
            db.rollback()
            result = "failed"
    parsed = urlsplit(return_to)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query["mailbox"] = result if not error else "cancelled"
    return RedirectResponse(urlunsplit(("", "", parsed.path, urlencode(query), "")), status_code=303)


@router.post("/firms/{firm_id}/candidates/{candidate_id}/mailbox/sync")
def sync_candidate_inbox(candidate_id: uuid.UUID,
                         principal: Principal = Depends(current_principal),
                         db: Session = Depends(get_db), firm_id: uuid.UUID = Depends(reader_firm_id)):
    if not can(principal, "candidate.edit"):
        raise HTTPException(status_code=403, detail="You don't have permission to sync this inbox.")
    _candidate(db, firm_id, candidate_id, principal)
    mailbox = scoped(db, CandidateMailbox, firm_id).filter_by(candidate_id=candidate_id).with_for_update().first()
    if mailbox is None or mailbox.status != "CONNECTED":
        raise HTTPException(status_code=409, detail="Connect the candidate's Google account first.")
    connection_started_at = mailbox.connected_at
    try:
        imported_message_ids = []
        imported = sync_mailbox(db, mailbox, imported_message_ids=imported_message_ids)
        _audit(db, principal, firm_id=firm_id, candidate_id=candidate_id, entity_id=mailbox.id,
               summary="Synced candidate Google inbox.")
        db.commit()
    except Exception as exc:
        db.rollback()
        record_sync_error(db, firm_id, candidate_id, connection_started_at)
        db.commit()
        raise HTTPException(status_code=502, detail="Google inbox sync failed. The connection can be retried.") from exc
    return {"imported": imported, "inbox": _inbox_json(db, firm_id, candidate_id, mailbox,
            scoped(db, InboxMessage, firm_id).filter_by(candidate_id=candidate_id).order_by(
                InboxMessage.received_at.desc()).limit(500).all())}


@router.delete("/firms/{firm_id}/candidates/{candidate_id}/mailbox")
def disconnect_candidate_inbox(candidate_id: uuid.UUID, principal: Principal = Depends(current_principal),
                               db: Session = Depends(get_db), firm_id: uuid.UUID = Depends(reader_firm_id)):
    if not can(principal, "candidate.edit"):
        raise HTTPException(status_code=403, detail="You don't have permission to disconnect this inbox.")
    _candidate(db, firm_id, candidate_id, principal)
    mailbox = scoped(db, CandidateMailbox, firm_id).filter_by(candidate_id=candidate_id).with_for_update().first()
    if mailbox and mailbox.status != "DISCONNECTED":
        _attribute_retained_messages(db, mailbox)
        mailbox.status = "DISCONNECTED"
        mailbox.refresh_token_ciphertext = None
        mailbox.history_id = None
        mailbox.last_sync_error = None
        _audit(db, principal, firm_id=firm_id, candidate_id=candidate_id, entity_id=mailbox.id,
               summary="Disconnected candidate Google inbox; retained imported email.")
        db.commit()  # Imported messages intentionally remain.
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
