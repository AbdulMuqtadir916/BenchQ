"""The old shared job pool's write routes, retired (job search PR 2, decided 2026-11-10, Q15). Jobs now come from a
candidate's search or capture (`job_postings`), and what named an old job (`resumes`, `cover_letters`, `job_runs`,
`llm_call_log`) points at `job_postings`, so these routes would fail or write rows nothing reads. They answer 410
until the clean-up PR deletes them with the old pool; the old read routes still work."""
from fastapi import HTTPException

RETIRED = "This was the old job pool. Jobs now come from a candidate's search: POST …/candidates/{id}/job-searches."


def retired() -> None:
    raise HTTPException(status_code=410, detail=RETIRED)
