"""Configuration-scoped pause after the provider rejects the classifier's credentials (DEBUG D-03).

A 401/403 means every further call with the same provider/model/key will be refused too, so the worker stops
dispatching instead of failing each email. The pause is one platform-level `job_runs` row whose id is derived from
a hash of the configuration (never the key itself): concurrent workers create the same row, and a new key or model
has a different id, so it is not paused.

Recovery without a configuration change is a single probe: one worker at a time takes a short lease on the pause
row (row lock, SKIP LOCKED) and sends exactly one email.
"""
from datetime import datetime, timedelta
import hashlib
import uuid

from sqlalchemy.dialects.postgresql import insert

from backend.models.db import JobRun, utcnow

PAUSE_JOB_TYPE = 'candidate_email_classifier_pause'
PROBE_LEASE = timedelta(minutes=2)
FIRST_PROBE_AFTER = timedelta(minutes=15)
AUTH_PROBE_AFTER = timedelta(hours=1)
INCONCLUSIVE_PROBE_AFTER = timedelta(minutes=15)


def pause_id(cfg) -> uuid.UUID:
    digest = hashlib.sha256('\x1f'.join((cfg.provider or '', cfg.model or '', cfg.api_key or '')).encode()).hexdigest()
    return uuid.uuid5(uuid.NAMESPACE_URL, 'benchq:candidate-email-classifier-pause:' + digest)


def _when(value):
    return datetime.fromisoformat(value) if value else None


def active_pause(db, cfg):
    """The open pause for this configuration, or None."""
    row = db.get(JobRun, pause_id(cfg))
    return row if row is not None and row.job_type == PAUSE_JOB_TYPE and row.status == 'running' else None


def record_pause(db, cfg, reason: str) -> None:
    """Open the pause (idempotent across workers) and commit."""
    now = utcnow()
    meta = {'reason': reason, 'paused_at': now.isoformat(), 'next_probe_at': (now + FIRST_PROBE_AFTER).isoformat(),
            'probe_lease_until': None, 'probe_failures': 0}
    statement = insert(JobRun).values(id=pause_id(cfg), firm_id=None, job_type=PAUSE_JOB_TYPE, trigger='scheduler',
                                      status='running', started_at=now, meta=meta)
    # An open pause is kept as it is; a cleared one for the same configuration is reopened.
    db.execute(statement.on_conflict_do_update(
        index_elements=['id'], set_={'status': 'running', 'started_at': now, 'finished_at': None, 'meta': meta},
        where=JobRun.status != 'running'))
    db.commit()


def claim_probe(db, cfg) -> bool:
    """True when this caller now holds the probe lease (and must send exactly one email). Commits."""
    row = (db.query(JobRun).filter_by(id=pause_id(cfg), job_type=PAUSE_JOB_TYPE, status='running')
           .with_for_update(skip_locked=True).first())
    if row is None:
        db.rollback()
        return False
    now = utcnow()
    meta = dict(row.meta or {})
    lease = _when(meta.get('probe_lease_until'))
    due = _when(meta.get('next_probe_at'))
    if (due and due > now) or (lease and lease > now):
        db.rollback()
        return False
    meta['probe_lease_until'] = (now + PROBE_LEASE).isoformat()
    row.meta = meta
    db.commit()
    return True


def finish_probe(db, cfg, outcome: str) -> None:
    """outcome: 'cleared' (the key works), 'auth' (still rejected) or 'inconclusive' (429/5xx/timeout). Commits."""
    row = db.query(JobRun).filter_by(id=pause_id(cfg), job_type=PAUSE_JOB_TYPE).with_for_update().first()
    if row is None:
        return
    now = utcnow()
    meta = dict(row.meta or {}, probe_lease_until=None)
    if outcome == 'cleared':
        row.status = 'completed'
        row.finished_at = now
        meta['cleared_at'] = now.isoformat()
    else:
        wait = AUTH_PROBE_AFTER if outcome == 'auth' else INCONCLUSIVE_PROBE_AFTER
        meta['next_probe_at'] = (now + wait).isoformat()
        meta['probe_failures'] = int(meta.get('probe_failures') or 0) + (outcome == 'auth')
    row.meta = meta
    db.commit()


def release_probe(db, cfg) -> None:
    """Give an unused probe lease back (no email could be claimed): the next sweep may probe at once. Commits."""
    row = db.query(JobRun).filter_by(id=pause_id(cfg), job_type=PAUSE_JOB_TYPE, status='running').with_for_update().first()
    if row is not None:
        row.meta = dict(row.meta or {}, probe_lease_until=None)
    db.commit()
