"""Gmail sync imports bounded message content and deduplicates provider IDs."""
from types import SimpleNamespace

import httpx
import pytest

from backend.tests.test_candidate_application_status import _saved_candidate_application


def test_message_body_prefers_plain_text_and_skips_attachments():
    import base64
    from backend.inbox.gmail_sync import _body

    def encoded(value):
        return base64.urlsafe_b64encode(value.encode()).decode().rstrip("=")

    payload = {"mimeType": "multipart/mixed", "parts": [
        {"mimeType": "text/plain", "body": {"data": encoded("Recruiter reply")}},
        {"mimeType": "text/plain", "filename": "private.pdf", "body": {"data": encoded("attachment")}},
    ]}
    assert _body(payload) == "Recruiter reply"


def test_initial_import_uses_3_day_query_and_deduplicates(test_db, accounts, jobs_in_default_firm, monkeypatch):
    from backend.inbox import google_oauth
    from backend.inbox import gmail_sync
    from backend.models.candidates import CandidateMailbox, InboxMessage

    candidate, _, app, _, _, _ = _saved_candidate_application(test_db, accounts, jobs_in_default_firm, "OWNER")
    mailbox = CandidateMailbox(firm_id=candidate.firm_id, candidate_id=candidate.id,
        address="candidate@example.test", connected_by_user_id=accounts.user_id, status="CONNECTED",
        refresh_token_ciphertext=b"cipher")
    test_db.add(mailbox)
    test_db.flush()
    monkeypatch.setattr(gmail_sync, "decrypt_secret", lambda value: "refresh")
    monkeypatch.setattr(gmail_sync, "_refresh_access_token", lambda refresh, client: "access")

    calls = []
    class Response:
        status_code = 200
        def __init__(self, payload): self.payload = payload
        def raise_for_status(self): return None
        def json(self): return self.payload

    class Client:
        def get(self, url, *, headers, params=None):
            calls.append((url, params))
            if url.endswith("/profile"):
                return Response({"historyId": "h1"})
            if url.endswith("/messages"):
                return Response({"messages": [{"id": "gmail-message-1"}]})
            if url.endswith("/messages/gmail-message-1"):
                return Response({"id": "gmail-message-1", "labelIds": ["INBOX"], "threadId": "thread-1", "internalDate": "1793400000000",
                    "snippet": "Assessment received", "payload": {"mimeType": "text/plain", "headers": [
                        {"name": "From", "value": "Recruiter <recruiter@example.test>"},
                        {"name": "Subject", "value": "Assessment received"}], "body": {"data": "QXNzZXNzbWVudCByZWNlaXZlZA"}}})
            if url.endswith("/history"):
                return Response({"historyId": "h2", "history": []})
            raise AssertionError(url)

    imported_ids = []
    imported = gmail_sync.sync_mailbox(test_db, mailbox, client=Client(), imported_message_ids=imported_ids)
    test_db.commit()
    assert imported == 1
    listing_call = next(params for url, params in calls if url.endswith("/messages"))
    assert listing_call["q"] == "newer_than:3d"
    assert listing_call["labelIds"] == "INBOX"
    row = test_db.query(InboxMessage).filter_by(mailbox_id=mailbox.id, provider_message_id="gmail-message-1").one()
    assert imported_ids == [row.id]
    assert row.application_id is None  # A new mail-to-application match requires human/application evidence.
    assert gmail_sync.encrypt_content("Assessment received") != "Assessment received"
    from backend.inbox.google_oauth import decrypt_content
    assert decrypt_content(row.body) == "Assessment received"
    assert row.is_read is False
    assert mailbox.initial_sync_complete is True
    assert mailbox.history_id == "h2"
    duplicate_ids = []
    assert gmail_sync.sync_mailbox(test_db, mailbox, client=Client(), imported_message_ids=duplicate_ids) == 0
    assert duplicate_ids == []
    assert test_db.query(InboxMessage).filter_by(mailbox_id=mailbox.id).count() == 1


@pytest.mark.parametrize('labels', [[], ['SENT'], ['INBOX', 'DRAFT'], ['INBOX', 'SPAM'], ['INBOX', 'TRASH']])
def test_non_inbox_and_excluded_labels_are_not_stored(test_db, accounts, jobs_in_default_firm, monkeypatch, labels):
    from backend.inbox import gmail_sync
    from backend.models.candidates import CandidateMailbox, InboxMessage

    candidate, _, _, _, _, _ = _saved_candidate_application(test_db, accounts, jobs_in_default_firm, 'OWNER')
    mailbox = CandidateMailbox(firm_id=candidate.firm_id, candidate_id=candidate.id,
        address='candidate@example.test', connected_by_user_id=accounts.user_id, status='CONNECTED')
    test_db.add(mailbox)
    test_db.flush()
    monkeypatch.setattr(gmail_sync, '_api_get', lambda *args: {'labelIds': labels, 'payload': {}})
    assert not gmail_sync._store_message(test_db, mailbox, 'token', 'excluded', object())
    assert test_db.query(InboxMessage).filter_by(mailbox_id=mailbox.id).count() == 0


def test_missing_message_is_skipped_but_other_provider_errors_propagate(test_db, accounts, jobs_in_default_firm, monkeypatch):
    from backend.inbox import gmail_sync
    from backend.models.candidates import CandidateMailbox

    candidate, _, _, _, _, _ = _saved_candidate_application(test_db, accounts, jobs_in_default_firm, 'OWNER')
    mailbox = CandidateMailbox(firm_id=candidate.firm_id, candidate_id=candidate.id,
        address='candidate@example.test', connected_by_user_id=accounts.user_id, status='CONNECTED')
    test_db.add(mailbox)
    test_db.flush()
    def fail(status):
        request = httpx.Request('GET', 'https://gmail.example.test/message')
        raise httpx.HTTPStatusError('provider error', request=request, response=httpx.Response(status, request=request))
    monkeypatch.setattr(gmail_sync, '_api_get', lambda *args: fail(404))
    assert not gmail_sync._store_message(test_db, mailbox, 'token', 'deleted', object())
    monkeypatch.setattr(gmail_sync, '_api_get', lambda *args: fail(503))
    with pytest.raises(httpx.HTTPStatusError):
        gmail_sync._store_message(test_db, mailbox, 'token', 'unavailable', object())


def test_invalid_text_is_skipped_before_database_insert(test_db, accounts, jobs_in_default_firm, monkeypatch):
    from backend.inbox import gmail_sync
    from backend.models.candidates import CandidateMailbox

    candidate, _, _, _, _, _ = _saved_candidate_application(test_db, accounts, jobs_in_default_firm, 'OWNER')
    mailbox = CandidateMailbox(firm_id=candidate.firm_id, candidate_id=candidate.id,
        address='candidate@example.test', connected_by_user_id=accounts.user_id, status='CONNECTED')
    test_db.add(mailbox)
    test_db.flush()
    monkeypatch.setattr(gmail_sync, '_api_get', lambda *args: {'labelIds': ['INBOX'], 'snippet': 'bad\x00text', 'payload': {}})
    assert not gmail_sync._store_message(test_db, mailbox, 'token', 'invalid', object())


def test_invalid_grant_is_distinguished_from_temporary_provider_failure():
    from backend.inbox.gmail_sync import ReconnectRequired, _refresh_access_token

    class Client:
        def __init__(self, error): self.error = error
        def post(self, *args, **kwargs):
            return SimpleNamespace(status_code=400, json=lambda: {'error': self.error})

    with pytest.raises(ReconnectRequired):
        _refresh_access_token('synthetic', Client('invalid_grant'))
    with pytest.raises(RuntimeError) as exc:
        _refresh_access_token('synthetic', Client('temporarily_unavailable'))
    assert not isinstance(exc.value, ReconnectRequired)
