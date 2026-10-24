"""Which firm a request acts for, and the one way to read a firm's rows (docs/integration/07-auth-and-tenancy.md
F2b, F4).

- `writer_firm_id`: every row a request creates on a firm-owned table takes its `firm_id` from the signed-in firm
  user (F2b).
- `reader_firm_id` + `scoped()`: every query a route makes on a firm-owned model adds `firm_id = :firm`, so a row
  of another firm is never found, and a route answers 404 for it, the same as for a missing row (07 F4,
  principle 4). `backend/tests/test_firm_scoping_lint.py` fails when a route queries a firm-owned model any other
  way.
- `scoped_jobs()`: the same for the shared job pool, through the firm's links in `firm_jobs`.
- `own_scope()`: the `own` scope of 07 §2.2 (src/lib/auth/policy.ts `isOwnScope`): a BDE reads only their own
  work, so a route adds `<model>.<owner column> == own_scope(principal)` when it isn't None.

A Super Admin inside a read-only support view (07 §4, backend/auth/support.py) reads the viewed firm, the whole of
it, and writes nothing. backend/auth/access.py already refuses every non-GET FIRM route inside a view;
`reader_firm_id` refuses them again, because many write routes take it rather than `writer_firm_id`, so a write
needs two mistakes to get through.
"""
import uuid

from fastapi import Depends, HTTPException, Request

from backend.api.routes_auth import current_principal
from backend.auth.access import SUPPORT_VIEW_READ_ONLY
from backend.auth.sessions import Principal

PLATFORM_ADMIN_REFUSED = "A platform admin can't act inside a firm."


def writer_firm_id(principal: Principal = Depends(current_principal)) -> uuid.UUID:
    """The firm a new row belongs to. FIRM routes already refuse a Super Admin (backend/auth/access.py); this is
    the same answer for any other route that writes firm data. A support view is read-only, so it never writes."""
    if principal.firm_id is None:
        raise HTTPException(status_code=403, detail=PLATFORM_ADMIN_REFUSED)
    return principal.firm_id


def reader_firm_id(request: Request, principal: Principal = Depends(current_principal)) -> uuid.UUID:
    """The firm whose rows a request may read: the signed-in firm user's own, or the firm a support view is of,
    on GET only."""
    if principal.firm_id is not None:
        return principal.firm_id
    if principal.support_firm_id is not None:
        if request.method != "GET":
            raise HTTPException(status_code=403, detail=SUPPORT_VIEW_READ_ONLY)
        return principal.support_firm_id
    raise HTTPException(status_code=403, detail=PLATFORM_ADMIN_REFUSED)


def viewed_firm_id(principal: Principal) -> uuid.UUID | None:
    """The firm a principal's reads are limited to on a route open to every signed-in account: a firm user's own,
    a support view's, or None for a Super Admin with no view (global reference data counted over every firm)."""
    return principal.firm_id or principal.support_firm_id


def own_scope(principal: Principal) -> uuid.UUID | None:
    """The user whose rows alone a principal may read, or None for the whole firm: a BDE's own id, as the
    frontend's `scopeLedger` / `scopeApplications`. A support view sees the whole firm, as the OWNER does. Pair it
    with `scoped()`, never instead of it."""
    if principal.kind == "firm" and principal.role == "BDE":
        return principal.user_id
    return None


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
