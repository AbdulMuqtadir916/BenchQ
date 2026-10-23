"""Which firm a request acts for, and the one way to read a firm's rows (docs/integration/07-auth-and-tenancy.md
F2b, F4).

- `writer_firm_id`: every row a request creates on a firm-owned table takes its `firm_id` from the signed-in firm
  user (F2b).
- `reader_firm_id` + `scoped()`: every query a route makes on a firm-owned model adds `firm_id = :firm`, so a row
  of another firm is never found, and a route answers 404 for it, the same as for a missing row (07 F4,
  principle 4). `backend/tests/test_firm_scoping_lint.py` fails when a route queries a firm-owned model any other
  way.
- `scoped_jobs()`: the same for the shared job pool, through the firm's links in `firm_jobs`.

A Super Admin's read-only support view (07 F3) will resolve `reader_firm_id` to the viewed firm when the
support-view endpoints are built; until then FIRM routes refuse a Super Admin (backend/auth/access.py).
"""
import uuid

from fastapi import Depends, HTTPException

from backend.api.routes_auth import current_principal
from backend.auth.sessions import Principal

PLATFORM_ADMIN_REFUSED = "A platform admin can't act inside a firm."


def writer_firm_id(principal: Principal = Depends(current_principal)) -> uuid.UUID:
    """The firm a new row belongs to. FIRM routes already refuse a Super Admin (backend/auth/access.py); this is
    the same answer for any other route that writes firm data. A support view is read-only, so it never writes."""
    if principal.firm_id is None:
        raise HTTPException(status_code=403, detail=PLATFORM_ADMIN_REFUSED)
    return principal.firm_id


def reader_firm_id(principal: Principal = Depends(current_principal)) -> uuid.UUID:
    """The firm whose rows a request may read: the signed-in firm user's own."""
    if principal.firm_id is None:
        raise HTTPException(status_code=403, detail=PLATFORM_ADMIN_REFUSED)
    return principal.firm_id


def firm_job_ids(firm_id: uuid.UUID):
    """The ids of the jobs a firm sees: the ones `firm_jobs` links it to (07 Q37)."""
    from sqlalchemy import select

    from backend.models.tenancy import FirmJob
    return select(FirmJob.job_id).where(FirmJob.firm_id == firm_id)


def scoped_jobs(db, firm_id: uuid.UUID, *entities):
    """`db.query(Job)` limited to the jobs a firm sees. Jobs are one shared pool (07 Q37), so the limit is the
    firm's links in `firm_jobs`, not a column on the job. Pass `entities` to select columns: works for any query
    whose rows come from `jobs`, `scoped_jobs(db, firm_id, Job.company, func.count(Job.id))`."""
    from backend.models.db import Job
    return db.query(*(entities or (Job,))).filter(Job.id.in_(firm_job_ids(firm_id)))


def scoped(db, model, firm_id: uuid.UUID, *entities):
    """`db.query(model)` limited to one firm's rows. Pass `entities` to select columns instead of the model:
    `scoped(db, Resume, firm_id, Resume.id)`."""
    return db.query(*(entities or (model,))).filter(model.firm_id == firm_id)
