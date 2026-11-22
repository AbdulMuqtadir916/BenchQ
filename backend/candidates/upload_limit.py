"""At most five later résumé uploads per candidate per firm work day (decided by Zuhair 2026-11-22). Only an upload that
was saved counts: a duplicate, a wrong name or email, or a failed parse doesn't, and neither does the résumé the
candidate was added with. The count is the candidate's, whoever uploaded. The caller holds the candidate's lock."""
from datetime import datetime

from fastapi import HTTPException

from backend.auth.scoping import scoped
from backend.job_search import limits, workday
from backend.models.candidates import ResumeParse
from backend.models.db import utcnow

MOST_UPLOADS_PER_WORK_DAY = 5


def uploads_today(db, candidate, now: datetime | None = None) -> int:
    now = now or utcnow()
    start = workday.day_start(now, workday.for_firm(db, candidate.firm_id))
    query = scoped(db, ResumeParse, candidate.firm_id, ResumeParse.id).filter(ResumeParse.candidate_id == candidate.id)
    first = query.order_by(ResumeParse.created_at, ResumeParse.id).first()
    if first is None:
        return 0
    return query.filter(ResumeParse.created_at >= start, ResumeParse.id != first[0]).count()


def refuse_past_limit(db, candidate, now: datetime | None = None) -> None:
    if uploads_today(db, candidate, now) >= MOST_UPLOADS_PER_WORK_DAY:
        raise HTTPException(status_code=429, detail=f"Upload limit reached. Next upload at "
                                                    f"{limits.resets_at_text(db, candidate.firm_id, now)}.")
