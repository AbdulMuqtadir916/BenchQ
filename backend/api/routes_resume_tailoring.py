"""Tailoring a candidate's résumé for one of their jobs (docs/team/tailoring.md §7, part 2; decided 2026-11-12).
Under the candidate's résumé URL, like its versions: another firm, a candidate outside the principal's scope, or a
posting or run that isn't the candidate's is the same 404 as a missing one.
- POST …/resumes/tailor                     start one: {job_posting_id, resume_id?} → 202 {run_id}; `resume_id` is a
                                             version of a visible base (default: the active base's v1)
- GET  …/resumes/tailorings                 the candidate's tailorings, newest first (`?running=true`: running only)
- GET  …/resumes/tailorings/{run_id}        one: {status: running|completed|failed, step?, resume_id?, error_code?, …}
- GET  /firms/{firm_id}/tailorings          the signed-in user's own, running or finished in the last 30 minutes (the
                                             BDE's panel, decided 2026-11-12, part 3 R2-Q2 and R3-Q2)
Who: starting, the candidate's BDE (`can_manage_resume`, 07 Q55); reading, anyone who can see the candidate, a support
view included (read only, backend/auth/access.py); the firm-level read, a firm member's own runs only.

Registered before the résumé routes (backend/main.py), so `…/resumes/tailorings` is never read as a résumé id.
"""
import asyncio
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session as DbSession

from backend.api.routes_auth import current_principal
from backend.api.routes_candidate_resumes import _writer
from backend.api.routes_candidates import _candidate, _member_of
from backend.auth.policy import can_manage_resume, require
from backend.auth.sessions import Principal
from backend.job_monitor import launch_background
from backend.models.db import get_db
from backend.resume_tailor import runs
from backend.resume_tailor.settings import TailorSetupError, read_setup

router = APIRouter(prefix="/firms/{firm_id}/candidates/{candidate_id}/resumes", tags=["résumé tailoring"])
firm_router = APIRouter(prefix="/firms/{firm_id}", tags=["résumé tailoring"])


class TailorIn(BaseModel):
    job_posting_id: uuid.UUID
    # A version of one of the candidate's visible bases; none: the active base's v1 (decided 2026-11-12, part 3 R3-Q1)
    resume_id: uuid.UUID | None = None


def _admit(db: DbSession, firm_id: uuid.UUID, principal: Principal, candidate_id: uuid.UUID, body: TailorIn) -> dict:
    """The checks, with the candidate row locked; the lock is left held for the launch (the caller commits)."""
    candidate, actor = _writer(db, firm_id, principal, candidate_id, can_manage_resume)
    try:
        read_setup(db)
    except TailorSetupError as e:
        raise HTTPException(status_code=500, detail=f"The résumé tailor isn't set up: {e}.")
    return runs.admit(db, candidate, actor, body.job_posting_id, body.resume_id)


@router.post("/tailor", status_code=202, summary="Tailor the candidate's résumé for one of their jobs")
async def start_tailoring(firm_id: uuid.UUID, candidate_id: uuid.UUID, body: TailorIn,
                          principal: Principal = Depends(require("resume.edit")), db: DbSession = Depends(get_db)):
    """Starts a background run (about a minute) and answers at once with its id; read its status from
    `…/tailorings/{run_id}`. 404 for a posting or version that isn't the candidate's; 409 when there's no usable
    version (a tailored one, a hidden base, no active base) or the same version and job is already being tailored; 422 when the job has no description; 429 when the BDE has
    `MOST_RUNNING_PER_BDE` tailorings running; 500 naming the setting when the tailor isn't set up."""
    meta = await asyncio.to_thread(_admit, db, firm_id, principal, candidate_id, body)
    try:
        # Launched with the candidate still locked, so no other request passes the checks before this run's row is
        # written. The row is the run's record (job_runs, firm_id and meta).
        run_id = launch_background(runs.JOB_TYPE, runs.run_tailoring, scope_key=str(uuid.uuid4()), meta=meta,
                                   target_job_id=uuid.UUID(meta["job_posting_id"]), firm_id=firm_id,
                                   func_kwargs={"firm_id": firm_id, "candidate_id": candidate_id,
                                                "source_resume_id": uuid.UUID(meta["source_resume_id"]),
                                                "job_posting_id": uuid.UUID(meta["job_posting_id"]),
                                                "user_id": uuid.UUID(meta["user_id"])})
    finally:
        await asyncio.to_thread(db.commit)
    return {"run_id": run_id}


def _reader(db: DbSession, firm_id: uuid.UUID, principal: Principal, candidate_id: uuid.UUID):
    _member_of(firm_id, principal)
    return _candidate(db, firm_id, principal, candidate_id)


@router.get("/tailorings", summary="The candidate's tailorings, newest first")
def list_tailorings(firm_id: uuid.UUID, candidate_id: uuid.UUID, running: bool = False,
                    principal: Principal = Depends(current_principal), db: DbSession = Depends(get_db)):
    candidate = _reader(db, firm_id, principal, candidate_id)
    rows = runs.candidate_runs(db, candidate, running_only=running)
    db.commit()                               # a lost run found on the way is marked
    return [runs.run_json(row) for row in rows]


@router.get("/tailorings/{run_id}", summary="One tailoring's status")
def get_tailoring(firm_id: uuid.UUID, candidate_id: uuid.UUID, run_id: uuid.UUID,
                  principal: Principal = Depends(current_principal), db: DbSession = Depends(get_db)):
    candidate = _reader(db, firm_id, principal, candidate_id)
    row = runs.candidate_run(db, candidate, run_id)
    db.commit()
    return runs.run_json(row)


@firm_router.get("/tailorings", summary="The signed-in user's tailorings: running, or finished in the last 30 minutes")
def my_tailorings(firm_id: uuid.UUID, principal: Principal = Depends(current_principal),
                  db: DbSession = Depends(get_db)):
    """The BDE's panel on every page. Only the caller's own runs, so nobody reads another person's; a platform
    admin (support view) has no runs of their own here: an empty list."""
    _member_of(firm_id, principal)
    if principal.kind != "firm":
        return []
    rows = runs.my_runs(db, firm_id, principal.user_id)
    db.commit()                               # a lost run found on the way is marked
    return [runs.run_json(row) for row in rows]
