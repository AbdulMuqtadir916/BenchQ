"""Generation-fenced import jobs. Google requests never hold a database row lock."""
from datetime import timedelta
from types import SimpleNamespace
import uuid

import httpx

from backend.auth.scoping import scoped
from backend.inbox.import_progress import JOB_TYPE, finish_import
from backend.inbox import gmail_sync as gmail
from backend.inbox.google_oauth import decrypt_secret
from backend.models.candidates import CandidateMailbox
from backend.models.db import JobRun, SessionLocal, utcnow
from backend.models.tenancy import Firm


class ConnectionChanged(Exception):
    pass


def run_import(firm_id, candidate_id, generation):
    from backend.config import CANDIDATE_GMAIL_ENABLED
    if not CANDIDATE_GMAIL_ENABLED:
        return -1
    job_id = uuid.uuid4()
    with SessionLocal() as db:
        mailbox = scoped(db, CandidateMailbox, firm_id).filter_by(candidate_id=candidate_id).with_for_update().first()
        firm = db.get(Firm, firm_id)
        if (not mailbox or mailbox.status != 'CONNECTED' or mailbox.connected_at != generation
                or not firm or firm.status == 'SUSPENDED'
                or (mailbox.sync_lease_until and mailbox.sync_lease_until > utcnow())):
            return -1
        finish_import(db, firm_id, mailbox.sync_job_id)
        db.add(JobRun(id=job_id, firm_id=firm_id, job_type=JOB_TYPE, trigger='scheduler',
            status='running', meta={'candidate_id': str(candidate_id), 'mailbox_id': str(mailbox.id),
                'generation': generation.isoformat() if generation else None, 'imported': 0, 'finalized': False}))
        mailbox.sync_job_id = job_id
        mailbox.sync_lease_until = utcnow() + timedelta(minutes=10)
        mailbox.sync_state = 'IMPORTING'
        mailbox.last_sync_error = None
        snapshot = SimpleNamespace(id=mailbox.id, firm_id=firm_id, candidate_id=candidate_id,
            address=mailbox.address, history_id=mailbox.history_id, token=mailbox.refresh_token_ciphertext)
        db.commit()

    def save(batch, *, checkpoint=None, complete=False):
        with SessionLocal() as db:
            current = scoped(db, CandidateMailbox, firm_id).filter_by(id=snapshot.id).with_for_update().first()
            firm = db.get(Firm, firm_id)
            if (not current or current.status != 'CONNECTED' or current.connected_at != generation
                    or current.sync_job_id != job_id or not firm or firm.status == 'SUSPENDED'):
                raise ConnectionChanged()
            inserted = 0
            for key, data in batch:
                inserted += int(gmail._store_message(db, current, '', key, None, message_data=data))
            current.sync_lease_until = utcnow() + timedelta(minutes=10)
            run = scoped(db, JobRun, firm_id).filter_by(id=job_id, job_type=JOB_TYPE).with_for_update().one()
            run.meta = {**run.meta, 'imported': run.meta['imported'] + inserted}
            if complete:
                finish_import(db, firm_id, job_id, completed=True)
                current.history_id = checkpoint
                current.initial_sync_complete = True
                current.last_synced_at = utcnow()
                current.last_sync_error = None
                current.sync_state = 'IDLE'
                current.sync_job_id = None
                current.sync_lease_until = None
            db.commit()
            from backend.inbox.classification_worker import wake_worker
            wake_worker()  # durable PENDING rows are recovery even if this notification is lost.
            return inserted

    count = 0
    try:
        with httpx.Client(timeout=25, follow_redirects=False) as http:
            token = gmail._refresh_access_token(decrypt_secret(snapshot.token), http)
            def import_ids(keys):
                batch = []
                total = 0
                for key in dict.fromkeys(keys):
                    try:
                        data = gmail._api_get(http, f'messages/{key}', token, {'format': 'full'})
                    except httpx.HTTPStatusError as exc:
                        if exc.response.status_code == 404:
                            continue
                        raise
                    batch.append((key, data))
                    if len(batch) == 10:
                        total += save(batch)
                        batch = []
                if batch:
                    total += save(batch)
                return total

            # A checkpoint can expire normally. At most one recent-window recovery.
            for attempt in range(2):
                checkpoint = snapshot.history_id
                if not checkpoint:
                    checkpoint = str(gmail._api_get(http, 'profile', token).get('historyId') or '')
                    if not checkpoint:
                        raise RuntimeError('Missing Gmail checkpoint')
                    page_token = None
                    while True:
                        params = {'q': 'newer_than:3d', 'labelIds': 'INBOX', 'maxResults': 100}
                        if page_token:
                            params['pageToken'] = page_token
                        page = gmail._api_get(http, 'messages', token, params)
                        count += import_ids([m['id'] for m in page.get('messages', []) if m.get('id')])
                        page_token = page.get('nextPageToken')
                        if not page_token:
                            break
                params = {'startHistoryId': checkpoint, 'historyTypes': 'messageAdded', 'maxResults': 100}
                try:
                    while True:
                        page = gmail._api_get(http, 'history', token, params)
                        count += import_ids([w['message']['id'] for e in page.get('history', [])
                            for w in e.get('messagesAdded', []) if w.get('message', {}).get('id')])
                        if not page.get('nextPageToken'):
                            checkpoint = str(page.get('historyId') or checkpoint)
                            break
                        params['pageToken'] = page['nextPageToken']
                except httpx.HTTPStatusError as exc:
                    if exc.response.status_code != 404 or attempt:
                        raise
                    snapshot.history_id = None
                    continue
                save([], checkpoint=checkpoint, complete=True)
                return count
    except ConnectionChanged:
        with SessionLocal() as db:
            finish_import(db, firm_id, job_id)
            db.commit()
        return -1
    except Exception as exc:
        with SessionLocal() as db:
            current = scoped(db, CandidateMailbox, firm_id).filter_by(id=snapshot.id).with_for_update().first()
            finish_import(db, firm_id, job_id)
            if current and current.connected_at == generation and current.sync_job_id == job_id:
                current.sync_state = 'FAILED'
                current.sync_job_id = None
                current.sync_lease_until = None
                current.last_sync_error = 'Sync failed. Try again.'
                if isinstance(exc, gmail.ReconnectRequired):
                    current.status = 'ERROR'
                    current.last_sync_error = 'Google access expired. Reconnect the candidate inbox.'
            db.commit()
        return -1
