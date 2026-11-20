"""Bringing earlier mail into the normal classification pipeline (PR 4, DEBUG D-23, D-27). Both switches ship OFF.

- Setup recovery: emails that failed only because the classifier was not set up (or its key was refused) go back to
  PENDING once the classifier is configured and not paused.
- Historical classification: retained NOT_QUEUED emails (imported while classification was off) are queued, oldest
  first. A historical email can only create a BDE review; it never changes an application status automatically.

Only the current connected mailbox of an active firm is ever touched, in bounded batches. Each email is handled at most
once per kind: a `job_runs` row with a fixed id is inserted first (the audit record and the once-only guard), so a
repeat sweep, a second worker or a repeated failure can never loop or write a second audit entry.

Read-only counts before a live run: `python -m backend.inbox.backfill`.
"""
from collections import Counter
import uuid

from sqlalchemy import String, cast, exists, func
from sqlalchemy.dialects.postgresql import insert

from backend import config
from backend.inbox.masking import masking_ready
from backend.models.candidates import CandidateMailbox, InboxMessage
from backend.models.db import JobRun, utcnow
from backend.models.tenancy import Firm

# MASKING_FAILED: the request could not be masked, so nothing was sent (the email is not at fault).
SETUP_ERRORS = ('CLASSIFIER_NOT_CONFIGURED', 'PROVIDER_AUTH_REJECTED', 'MASKING_FAILED')
RECOVERY = 'candidate_email_setup_recovery'
HISTORICAL = 'candidate_email_historical'
BATCH = 20


def marker_id(kind: str, message_id) -> uuid.UUID:
    return uuid.uuid5(uuid.NAMESPACE_URL, f'benchq:{kind}:{message_id}')


def is_historical(db, message_id) -> bool:
    """True when this email entered the pipeline through historical classification (review only)."""
    return db.get(JobRun, marker_id(HISTORICAL, message_id)) is not None


def _current_source(query):
    """Readable mail of the current connected mailbox of an active firm."""
    return (query.join(CandidateMailbox, InboxMessage.mailbox_id == CandidateMailbox.id)
            .join(Firm, Firm.id == InboxMessage.firm_id)
            .filter(CandidateMailbox.status == 'CONNECTED', Firm.status != 'SUSPENDED',
                    InboxMessage.deleted_at.is_(None), InboxMessage.hidden_at.is_(None),
                    func.lower(func.trim(InboxMessage.source_address)) == func.lower(func.trim(CandidateMailbox.address))))


def _not_marked(query, kind):
    """Exclude emails that already have this kind's marker (handled once; never again)."""
    marked = exists().where(JobRun.job_type == kind,
                            JobRun.meta['message_id'].as_string() == cast(InboxMessage.id, String))
    return query.filter(~marked)


def _recovery_query(db):
    return _not_marked(_current_source(db.query(InboxMessage)).filter(
        InboxMessage.classification_state == 'ERROR', InboxMessage.classification_error.in_(SETUP_ERRORS)), RECOVERY)


def _historical_query(db):
    return _not_marked(_current_source(db.query(InboxMessage)).filter(
        InboxMessage.classification_state == 'NOT_QUEUED'), HISTORICAL)


def _claim(db, kind, message, extra):
    """Insert the once-only marker; True when this call is the one that inserted it."""
    inserted = db.execute(insert(JobRun).values(
        id=marker_id(kind, message.id), firm_id=message.firm_id, job_type=kind, trigger='scheduler',
        status='completed', started_at=utcnow(), finished_at=utcnow(),
        meta={'message_id': str(message.id), 'candidate_id': str(message.candidate_id), **extra},
    ).on_conflict_do_nothing(index_elements=['id']).returning(JobRun.id)).first()
    return inserted is not None


def _requeue(message):
    message.classification_state = 'PENDING'
    message.classification_attempts = 0
    message.classification_error = None
    message.classification_next_retry_at = None
    message.classification_token = None
    message.classification_lease_until = None


def _summarize(db, per_candidate: Counter, firms: dict, text: str):
    from backend.auth.ledger import record_automated
    for candidate_id, count in per_candidate.items():
        record_automated(db, actor_type='SYSTEM', actor_name='Email classifier', action='UPDATE',
                         entity_type='candidate', entity_id=candidate_id, entity_label='Candidate inbox',
                         summary=text.format(count=count), firm_id=firms[candidate_id], candidate_id=candidate_id)


def _run(db, query, kind, extra, text, limit):
    rows = query.order_by(InboxMessage.received_at, InboxMessage.id).with_for_update(of=InboxMessage, skip_locked=True).limit(limit).all()
    per_candidate, firms = Counter(), {}
    for message in rows:
        if _claim(db, kind, message, extra(message)):
            _requeue(message)
            per_candidate[message.candidate_id] += 1
            firms[message.candidate_id] = message.firm_id
    _summarize(db, per_candidate, firms, text)
    db.commit()
    return sum(per_candidate.values())


def recover_setup_failures(db, *, limit=BATCH) -> int:
    """Return setup-only failures to PENDING, once each. Caller has checked the classifier is configured and unpaused."""
    if not getattr(config, 'CANDIDATE_EMAIL_SETUP_RECOVERY_ENABLED', False):
        return 0
    query = _recovery_query(db)
    # Masking must work first: an email recovered while it cannot would spend its one recovery and fail again.
    if query.first() is None or not masking_ready():
        return 0
    return _run(db, query, RECOVERY, lambda m: {'previous_error': m.classification_error},
                'Requeued {count} emails that failed only because the classifier was not set up.', limit)


def queue_historical(db, *, limit=BATCH) -> int:
    """Queue retained NOT_QUEUED mail, oldest first, once each. Results can only create BDE reviews."""
    if not getattr(config, 'CANDIDATE_EMAIL_HISTORICAL_ENABLED', False):
        return 0
    return _run(db, _historical_query(db), HISTORICAL, lambda m: {'received_at': m.received_at.isoformat() if m.received_at else None},
                'Queued {count} earlier emails for classification (review only, no automatic status change).', limit)


def eligible_counts(db) -> dict:
    """Read-only: what a live run would touch, and what stays excluded."""
    def by_candidate(query):
        return dict(query.with_entities(InboxMessage.candidate_id, func.count()).group_by(InboxMessage.candidate_id).all())
    excluded = (db.query(InboxMessage).join(CandidateMailbox, InboxMessage.mailbox_id == CandidateMailbox.id)
                .filter(CandidateMailbox.status != 'CONNECTED',
                        InboxMessage.classification_state.in_(['NOT_QUEUED', 'ERROR'])))
    return {'setup_recovery': by_candidate(_recovery_query(db)), 'historical': by_candidate(_historical_query(db)),
            'excluded_disconnected': by_candidate(excluded), 'batch_per_sweep': BATCH}


def report(db) -> list[str]:
    """The counts command's lines, per candidate by name."""
    from backend.models.candidates import Candidate
    counts = eligible_counts(db)
    keys = ('setup_recovery', 'historical', 'excluded_disconnected')
    ids = {candidate_id for key in keys for candidate_id in counts[key]}
    # `full_name` is read off the résumé (a property, not a column), so the candidates themselves are loaded.
    names = {c.id: c.full_name for c in db.query(Candidate).filter(Candidate.id.in_(ids))} if ids else {}
    lines = [f'{key}: {sum(counts[key].values())} {({names.get(c) or str(c): n for c, n in counts[key].items()})}'
             for key in keys]
    return [*lines, f"batch per sweep: {counts['batch_per_sweep']}"]


if __name__ == '__main__':
    from backend.models.db import SessionLocal
    with SessionLocal() as session:
        for line in report(session):
            print(line)
