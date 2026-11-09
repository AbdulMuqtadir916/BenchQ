"""The firm's résumés across candidates, read-only (docs/team/resume-versioning.md §5; résumé versioning PR 7). For the
Resume Builder library and for opening a version from a link that names only the version (an application's "résumé
sent", the studio's URL).

- GET /firms/{firm_id}/resumes               every candidate in the principal's scope: their bases with versions and
                                             their tailored résumés (no content)
- GET /firms/{firm_id}/resumes/{resume_id}   one version with its content, and the candidate it belongs to

Scope is the candidates list's (07 Q47): the OWNER, a VIEWER and a support view see the firm, a MANAGER their team, a
BDE their own candidates. A version of a candidate outside that scope, of another firm, or deleted is the same 404 as a
missing one. Writes stay under the candidate's URL (routes_candidate_resumes.py).
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session as DbSession

from backend.api.routes_auth import current_principal
from backend.api.routes_candidates import _candidate, _member_of, _visible
from backend.auth.scoping import scoped
from backend.auth.sessions import Principal
from backend.candidates import versions
from backend.models.candidates import Candidate
from backend.models.db import Resume, get_db

router = APIRouter(prefix="/firms/{firm_id}/resumes", tags=["firm résumés"])


@router.get("", summary="Every résumé of the candidates in the principal's scope (no content)")
def list_firm_resumes(firm_id: uuid.UUID, principal: Principal = Depends(current_principal),
                      db: DbSession = Depends(get_db)):
    _member_of(firm_id, principal)
    ids = [row.id for row in _visible(db, firm_id, principal).with_entities(Candidate.id)]
    shelves = versions.listing_many(db, firm_id, ids) if ids else {}
    return {"bases": [base for cid in ids for base in shelves[cid]["bases"]],
            "tailored": [t for cid in ids for t in shelves[cid]["tailored"]]}


@router.get("/{resume_id}", summary="One version with its content, by its id alone")
def get_firm_resume(firm_id: uuid.UUID, resume_id: uuid.UUID, principal: Principal = Depends(current_principal),
                    db: DbSession = Depends(get_db)):
    _member_of(firm_id, principal)
    row = scoped(db, Resume, firm_id).filter(Resume.id == resume_id, Resume.base_resume_id.isnot(None),
                                             Resume.deleted_at.is_(None)).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Not found.")
    _candidate(db, firm_id, principal, row.candidate_id)  # outside the principal's scope: the same 404
    return versions.version_json(row, with_content=True)
