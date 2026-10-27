"""A firm's candidates (docs/candidate-onboarding/06-backend.md; 07 Q40–Q51). Firm-scoped: every path names the firm,
and another firm is the same 404 as a missing one (principle 4).

- POST /candidates/parse-resume: read a résumé into a draft for the new-candidate flow. Saves nothing about a
  candidate (07 Q49); the file and the answer wait 60 minutes for a create to keep them (`resume_parses`).
"""
import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session as DbSession

from backend.auth.policy import require
from backend.auth.scoping import scoped
from backend.auth.sessions import Principal
from backend.candidates.parse import DOCX_MIME, MAX_BYTES, PDF_MIME, extract_text, file_kind, read_resume
from backend.models.candidates import ResumeParse
from backend.models.db import get_db, utcnow

router = APIRouter(prefix="/firms/{firm_id}/candidates", tags=["candidates"])

PARSE_LIFETIME = timedelta(minutes=60)


def _member_of(firm_id: uuid.UUID, principal: Principal) -> None:
    """The principal must belong to the firm the path names (writes: a support view is refused before this)."""
    if (principal.firm_id or principal.support_firm_id) != firm_id:
        raise HTTPException(status_code=404, detail="Not found.")


@router.post("/parse-resume", summary="Read a résumé into a draft (saves nothing about a candidate)")
async def parse_resume(firm_id: uuid.UUID, file: UploadFile = File(...),
                       principal: Principal = Depends(require("candidate.create")), db: DbSession = Depends(get_db)):
    """PDF or Word, up to 10 MB. Returns `{parse_id, file_name, parse}` with `parse` in Zuhair's format; the create
    sends `resume_parse_id` back to keep the file (06 §4)."""
    _member_of(firm_id, principal)
    content = await file.read(MAX_BYTES + 1)
    kind = file_kind(file.filename or "", content)
    parse = await read_resume(extract_text(kind, content), db)
    now = utcnow()
    # Parses nobody created a candidate from are deleted once they expire; this firm's, on each new read.
    scoped(db, ResumeParse, firm_id).filter(ResumeParse.candidate_id.is_(None), ResumeParse.expires_at < now) \
        .delete(synchronize_session=False)
    row = ResumeParse(firm_id=firm_id, uploaded_by_user_id=principal.user_id, file_name=(file.filename or "")[:255],
                      mime_type=PDF_MIME if kind == "pdf" else DOCX_MIME, size_bytes=len(content), content=content,
                      parse=parse, expires_at=now + PARSE_LIFETIME)
    db.add(row)
    db.commit()
    return {"parse_id": str(row.id), "file_name": row.file_name, "parse": parse}
