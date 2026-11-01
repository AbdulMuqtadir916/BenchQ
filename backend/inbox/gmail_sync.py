"""Bounded, deduplicating Gmail read/sync operations for one candidate mailbox."""
from __future__ import annotations

import base64
from email.header import decode_header, make_header
from email.utils import parseaddr
from datetime import datetime, timedelta, timezone
from uuid import UUID

import httpx
from bs4 import BeautifulSoup
from sqlalchemy.dialects.postgresql import insert

from backend.config import CANDIDATE_GMAIL_CLIENT_ID, CANDIDATE_GMAIL_CLIENT_SECRET
from backend.inbox.google_oauth import decrypt_secret, encrypt_secret
from backend.models.candidates import CandidateMailbox, InboxMessage
from backend.models.db import utcnow

GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me"
MAX_BODY_CHARS = 100_000


def _decode(value: str | None) -> str:
    if not value:
        return ""
    padded = value + "=" * (-len(value) % 4)
    try:
        return base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8", "replace")
    except (ValueError, UnicodeEncodeError):
        return ""


def _header(payload: dict, name: str) -> str:
    headers = payload.get("headers") or []
    value = next((h.get("value", "") for h in headers if h.get("name", "").lower() == name.lower()), "")
    try:
        return str(make_header(decode_header(value)))[:1000]
    except (ValueError, TypeError):
        return str(value)[:1000]


def _body(payload: dict) -> str:
    candidates: list[tuple[str, str]] = []
    stack = [payload]
    while stack:
        part = stack.pop()
        if part.get("filename"):
            continue  # Never download attachments.
        mime = part.get("mimeType", "")
        data = _decode((part.get("body") or {}).get("data"))
        if data and mime in {"text/plain", "text/html"}:
            candidates.append((mime, data))
        stack.extend(reversed(part.get("parts") or []))
    plain = next((body for mime, body in candidates if mime == "text/plain"), None)
    html = next((body for mime, body in candidates if mime == "text/html"), None)
    text = plain if plain is not None else BeautifulSoup(html or "", "html.parser").get_text("\n")
    return text[:MAX_BODY_CHARS].strip()


def _refresh_access_token(refresh_token: str, client: httpx.Client) -> str:
    response = client.post("https://oauth2.googleapis.com/token", data={
        "client_id": CANDIDATE_GMAIL_CLIENT_ID,
        "client_secret": CANDIDATE_GMAIL_CLIENT_SECRET,
        "refresh_token": refresh_token,
        "grant_type": "refresh_token",
    })
    if response.status_code >= 400:
        raise RuntimeError("Google could not refresh the candidate mailbox connection.")
    token = response.json().get("access_token")
    if not isinstance(token, str) or not token:
        raise RuntimeError("Google returned no access token for the candidate mailbox.")
    return token


def _api_get(client: httpx.Client, path: str, token: str, params: dict | None = None) -> dict:
    response = client.get(f"{GMAIL_API}/{path}", headers={"Authorization": f"Bearer {token}"}, params=params)
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict):
        raise RuntimeError("Google returned an invalid Gmail response.")
    return payload


def _matching_application_id(db, mailbox: CandidateMailbox, thread_id: str | None):
    """Reuse a unique scoped submitted-application link; new threads match in the worker."""
    from backend.inbox.application_matching import thread_application_id
    return thread_application_id(db, mailbox, thread_id)


def _store_message(db, mailbox: CandidateMailbox, token: str, message_id: str, client: httpx.Client,
                   *, imported_message_ids: list[UUID] | None = None) -> bool:
    from sqlalchemy import select

    existing = db.execute(select(InboxMessage.id).where(
        InboxMessage.mailbox_id == mailbox.id,
        InboxMessage.source_address.in_(["", mailbox.address.strip().lower()]),
        InboxMessage.provider_message_id == message_id)).first()
    if existing:
        return False
    data = _api_get(client, f"messages/{message_id}", token, {"format": "full"})
    payload = data.get("payload") if isinstance(data.get("payload"), dict) else {}
    from_name, from_email = parseaddr(_header(payload, "From"))
    raw_date = data.get("internalDate")
    try:
        received = datetime.fromtimestamp(int(raw_date) / 1000, tz=timezone.utc)
    except (TypeError, ValueError, OSError):
        received = utcnow()
    subject = _header(payload, "Subject") or "(no subject)"
    snippet = str(data.get("snippet") or "")[:2000]
    body = _body(payload) or snippet
    thread_id = data.get("threadId")
    imported_id = db.execute(insert(InboxMessage).values(
        firm_id=mailbox.firm_id,
        candidate_id=mailbox.candidate_id,
        mailbox_id=mailbox.id,
        application_id=_matching_application_id(db, mailbox, thread_id),
        provider_message_id=message_id,
        source_address=mailbox.address.strip().lower(),
        thread_id=thread_id,
        from_name=from_name[:320] or from_email[:320] or "Unknown sender",
        from_email=from_email[:320],
        subject=subject[:1000],
        snippet=snippet,
        body=body,
        received_at=received,
        is_read=False,
    ).on_conflict_do_nothing(constraint="uq_inbox_messages_mailbox_message")
      .returning(InboxMessage.id)).scalar_one_or_none()
    if imported_id is not None and imported_message_ids is not None:
        imported_message_ids.append(imported_id)
    return imported_id is not None


def sync_mailbox(db, mailbox: CandidateMailbox, *, client: httpx.Client | None = None,
                 _checkpoint_retry: bool = False, imported_message_ids: list[UUID] | None = None) -> int:
    """Sync mail; collect inserted IDs so callers can dispatch only after commit."""
    if mailbox.status != "CONNECTED" or not mailbox.refresh_token_ciphertext:
        raise RuntimeError("Candidate mailbox is not connected.")
    owns_client = client is None
    http = client or httpx.Client(timeout=25.0, follow_redirects=False)
    try:
        refresh = decrypt_secret(mailbox.refresh_token_ciphertext)
        token = _refresh_access_token(refresh, http)
        imported = 0
        if not mailbox.history_id:
            profile = _api_get(http, "profile", token)
            start_history = str(profile.get("historyId") or "")
            if not start_history:
                raise RuntimeError("Google returned no Gmail history checkpoint.")
            page_token = None
            while True:
                params = {"q": "newer_than:3d", "maxResults": 500}
                if page_token:
                    params["pageToken"] = page_token
                page = _api_get(http, "messages", token, params)
                for item in page.get("messages", []):
                    message_id = item.get("id") if isinstance(item, dict) else None
                    if message_id:
                        imported += int(_store_message(db, mailbox, token, str(message_id), http,
                                                       imported_message_ids=imported_message_ids))
                page_token = page.get("nextPageToken")
                if not page_token:
                    break
            mailbox.history_id = start_history
            mailbox.initial_sync_complete = True
        # Catch mail received during initial listing and subsequent arrivals.
        params = {"startHistoryId": mailbox.history_id, "historyTypes": "messageAdded", "maxResults": 500}
        while True:
            try:
                page = _api_get(http, "history", token, params)
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code == 404:
                    if _checkpoint_retry:
                        raise RuntimeError("Google rejected a newly-created Gmail history checkpoint.") from exc
                    mailbox.history_id = None  # Expired Gmail checkpoint: rebuild the recent window, deduplicated.
                    db.flush()
                    return sync_mailbox(db, mailbox, client=http, _checkpoint_retry=True,
                                        imported_message_ids=imported_message_ids)
                raise
            for event in page.get("history", []):
                for wrapper in event.get("messagesAdded", []):
                    item = wrapper.get("message") or {}
                    message_id = item.get("id")
                    if message_id:
                        imported += int(_store_message(db, mailbox, token, str(message_id), http,
                                                       imported_message_ids=imported_message_ids))
            params["pageToken"] = page.get("nextPageToken")
            if not params["pageToken"]:
                mailbox.history_id = str(page.get("historyId") or mailbox.history_id)
                break
        mailbox.last_synced_at = utcnow()
        mailbox.last_sync_error = None
        db.flush()
        return imported
    except Exception:
        mailbox.last_sync_error = "Gmail sync failed. Retry or reconnect the candidate account."
        db.flush()
        raise
    finally:
        if owns_client:
            http.close()


def record_sync_error(db, firm_id, candidate_id, connected_at):
    """After rollback, record failure only on the connection that actually failed.

    A newer reconnect/disconnect must not inherit the old account's diagnostics.
    The caller commits, releasing the account lock in the same transaction.
    """
    from backend.auth.scoping import scoped
    mailbox = scoped(db, CandidateMailbox, firm_id).filter_by(
        candidate_id=candidate_id).populate_existing().with_for_update().first()
    if mailbox and mailbox.status == "CONNECTED" and mailbox.connected_at == connected_at:
        mailbox.last_sync_error = "Gmail sync failed. Retry or reconnect the candidate account."
