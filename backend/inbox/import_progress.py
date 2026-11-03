"""Durable import progress; business ledger results are appended exactly once.

Callers hold the mailbox row lock before finishing its current run. A JobRun
lock serializes terminal/recovery attempts; messages, counts and final result
always commit in the caller's transaction. No email content belongs in meta.
"""
from backend.auth.ledger import record_automated
from backend.auth.scoping import scoped
from backend.models.db import JobRun, SessionLocal, utcnow


JOB_TYPE = 'candidate_gmail_import'


def finish_import(db, firm_id, job_id, *, completed=False):
    if not job_id:
        return
    run = scoped(db, JobRun, firm_id).filter_by(id=job_id, job_type=JOB_TYPE).with_for_update().first()
    if not run or (run.meta or {}).get('finalized'):
        return
    meta = dict(run.meta or {})
    total = meta.get('imported', 0)
    summary = (f'Imported {total} candidate emails.' if completed else
               f'Partial import: saved {total} candidate emails; job not completed.')
    if total:
        record_automated(db, actor_type='SYSTEM', actor_name='Gmail sync', action='CREATE',
            entity_type='email', entity_id=run.id, entity_label='Candidate inbox', summary=summary,
            firm_id=firm_id, candidate_id=meta['candidate_id'])
    run.status = 'completed' if completed else 'failed'
    run.finished_at = utcnow()
    run.result_summary = summary
    run.error = None if completed else 'Import interrupted or failed.'
    run.meta = {**meta, 'finalized': True}


def recover_imports():
    """Finalize abandoned runs, including disabled/suspended/deleted mailboxes.

    This runs independently of mailbox import polling. Lock mailbox before run,
    as in save/disconnect; refresh after taking the lock so a renewed lease wins.
    """
    from backend.models.candidates import CandidateMailbox
    from backend.models.tenancy import Firm
    with SessionLocal() as db:
        runs = db.query(JobRun.firm_id, JobRun.id, JobRun.meta).filter(
            JobRun.job_type == JOB_TYPE,
            JobRun.meta['finalized'].as_boolean() == False).limit(100).all()  # noqa: E712
        for firm_id, job_id, meta in runs:
            if (meta or {}).get('finalized'):
                continue
            mailbox = scoped(db, CandidateMailbox, firm_id).filter_by(
                candidate_id=meta['candidate_id']).with_for_update().first()
            firm = db.get(Firm, firm_id)
            active = (mailbox and mailbox.sync_job_id == job_id and mailbox.status == 'CONNECTED'
                      and mailbox.sync_lease_until and mailbox.sync_lease_until > utcnow()
                      and firm and firm.status != 'SUSPENDED')
            if not active:
                finish_import(db, firm_id, job_id)
                if mailbox and mailbox.sync_job_id == job_id:
                    mailbox.sync_job_id = None
                    mailbox.sync_lease_until = None
                    mailbox.sync_state = 'FAILED'
                    mailbox.last_sync_error = 'Sync interrupted. Try again.'
            db.commit()
