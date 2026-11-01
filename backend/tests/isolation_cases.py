"""F7's case table (07-auth F7): how to call every route as another firm, run by backend/tests/test_isolation.py.

**A track adds its routes here, not a new test.** For a FIRM route, a `Case` says which of a firm's rows its path
names and what body it sends (backend/tests/isolation_support.py builds those rows for firms A and B). The test then
proves, for every case: firm A's OWNER with B's ids gets the same 404 as for ids that exist nowhere and changes
nothing of B's; B's own OWNER gets through; a support view reads (GETs) and writes nothing; signed out is 401; and a
GET answers firm A exactly the same before and after firm B's rows exist.

Every route must be here or in `backend/auth/access.py`'s PLATFORM class, or the test fails, and so does an entry
whose route no longer exists.
"""
from dataclasses import dataclass, field
from typing import Callable
import uuid


@dataclass(frozen=True)
class Case:
    # Path parameter -> the kind of row it names (keys of isolation_support.build_firm). Unset parameters use PARAM.
    path: dict = field(default_factory=dict)
    # The JSON body, from the target firm's ids (B's, or ones that exist nowhere).
    body: Callable[[dict], dict] | None = None
    # The body names rows (by id), so another firm's ids must get the same answer as missing ones.
    body_ids: bool = False
    # Answers another firm's ids in a `not_found` list (200) rather than with 404.
    bulk: bool = False
    # A GET whose answer lists the firm's own rows: firm B's own answer must carry its canary.
    shows_rows: bool = False
    # A multipart upload instead of a JSON body.
    upload: bool = False


PARAM = {"firm_id": "firm", "invite_id": "invite", "job_id": "job", "app_id": "app", "interview_id": "interview",
         "resume_id": "resume", "cl_id": "letter", "slug": "slug", "user_id": "bde_user", "candidate_id": "candidate", "message_id": "inbox_message"}


def _new(prefix: str) -> str:
    return f"https://jobs.example.test/{prefix}-{uuid.uuid4().hex[:8]}"


CASES: dict[str, Case] = {
    # ── Session ──────────────────────────────────────────────────────────────
    "POST /api/auth/first-run-done": Case(),

    # ── Team (Phase M): the firm is in the path ──────────────────────────────
    "GET /api/firms/{firm_id}/members": Case(shows_rows=True),
    "GET /api/firms/{firm_id}/invites": Case(shows_rows=True),
    "POST /api/firms/{firm_id}/invites": Case(body=lambda i: {"email": f"new-{uuid.uuid4().hex[:6]}@example.test",
                                                              "role": "BDE", "manager_id": str(i["manager"])},
                                              body_ids=True),
    # The hierarchy (onboarding 06 PR 2): a BDE's manager, the firm's BDE capacity.
    "PATCH /api/firms/{firm_id}/members/{user_id}/manager": Case(body=lambda i: {"manager_id": str(i["manager"])},
                                                                 body_ids=True),
    "PATCH /api/firms/{firm_id}/settings": Case(body=lambda i: {"bde_capacity": 7}),

    # ── Candidates (onboarding 06): the firm is in the path ──────────────────
    "POST /api/firms/{firm_id}/candidates/parse-resume": Case(upload=True),
    "GET /api/firms/{firm_id}/candidates": Case(shows_rows=True),
    "POST /api/firms/{firm_id}/candidates": Case(body=lambda i: {
        "full_name": "New candidate", "primary_role": "Data Engineer", "email": "new@example.test", "work_auth": "GC",
        "manager_id": str(i["manager"]), "bde_id": str(i["bde_user"])}, body_ids=True),
    "GET /api/firms/{firm_id}/candidates/{candidate_id}": Case(),
    "PATCH /api/firms/{firm_id}/candidates/{candidate_id}": Case(body=lambda i: {"rate_target": 90}),
    "POST /api/firms/{firm_id}/candidates/{candidate_id}/assign": Case(
        body=lambda i: {"manager_id": str(i["manager"]), "bde_id": str(i["bde_user"])}, body_ids=True),
    "POST /api/firms/{firm_id}/invites/{invite_id}/resend": Case(),
    "POST /api/firms/{firm_id}/invites/{invite_id}/revoke": Case(),

    # ── Ledger (track 01) ────────────────────────────────────────────────────
    "GET /api/firms/{firm_id}/ledger": Case(shows_rows=True),

    # ── Jobs (track 02): the firm's links in firm_jobs ───────────────────────
    "GET /api/jobs": Case(shows_rows=True),
    "GET /api/jobs/feed-stats": Case(),
    "GET /api/jobs/unscored-ids": Case(),
    "GET /api/jobs/companies/list": Case(shows_rows=True),
    "GET /api/jobs/sources/list": Case(),
    "GET /api/jobs/verdicts/list": Case(),
    "GET /api/jobs/facets": Case(),
    "GET /api/jobs/{job_id}": Case(),
    "PATCH /api/jobs/{job_id}": Case(body=lambda i: {"status": "saved"}),
    "GET /api/jobs/{job_id}/cached-page": Case(),
    "GET /api/jobs/{job_id}/frame-check": Case(),
    "GET /api/jobs/{job_id}/live-page": Case(),
    "POST /api/jobs/bulk-update": Case(body=lambda i: {"job_ids": [str(i["job"])], "updates": {"status": "saved"}},
                                       body_ids=True, bulk=True),
    "POST /api/jobs/manual": Case(body=lambda i: {"title": "Manual role", "company": "Manual Co", "url": _new("manual")}),
    "POST /api/jobs/save-from-extension": Case(body=lambda i: {"title": "Captured role", "company": "Captured Co",
                                                                "url": _new("captured")}),
    "POST /api/jobs/cache-applied": Case(),
    "POST /api/analyze/{job_id}": Case(body=lambda i: {}),

    # ── Applications (track 03) ──────────────────────────────────────────────
    "GET /api/firms/{firm_id}/candidates/{candidate_id}/inbox": Case(shows_rows=True),
    "POST /api/firms/{firm_id}/candidates/{candidate_id}/mailbox/oauth": Case(body=lambda i: {"return_to": f"/acme/candidates/{i['candidate']}?tab=inbox"}),
    "POST /api/firms/{firm_id}/candidates/{candidate_id}/mailbox/sync": Case(),
    "DELETE /api/firms/{firm_id}/candidates/{candidate_id}/mailbox": Case(),
    "PATCH /api/firms/{firm_id}/candidates/{candidate_id}/inbox-messages/{message_id}/read": Case(),
    "GET /api/applications": Case(shows_rows=True),
    "GET /api/applications/{app_id}": Case(),
    "PATCH /api/applications/{app_id}/review": Case(path={"app_id": "review_app"}, body=lambda i: {"review_id": str(i["review"]), "status": "assessment", "expected_revision": 0, "expected_review_revision": 0}),
    "POST /api/applications": Case(body=lambda i: {"title": "Logged role", "company": "Logged Co", "url": _new("logged")}),
    "POST /api/applications/extract": Case(body=lambda i: {"url": _new("posting")}),
    "PATCH /api/applications/{app_id}/candidate-status": Case(body=lambda i: {"status": "saved", "expected_revision": 0}),
    "PATCH /api/applications/{app_id}": Case(body=lambda i: {"notes": "Edited"}),
    "DELETE /api/applications/{app_id}": Case(path={"app_id": "legacy_app"}),
    "POST /api/applications/bulk-update": Case(body=lambda i: {"ids": [str(i["app"])], "status": "interview_scheduled", "expected_revisions": {str(i["app"]): 0}},
                                               body_ids=True, bulk=True),
    "POST /api/applications/bulk-delete": Case(body=lambda i: {"ids": [str(i["legacy_app"])]}, body_ids=True, bulk=True),
    "GET /api/applications/{app_id}/prep": Case(),
    "POST /api/applications/{app_id}/interviews": Case(body=lambda i: {"what": "Panel"}),
    "PATCH /api/applications/interviews/{interview_id}": Case(body=lambda i: {"what": "Panel two"}),
    "DELETE /api/applications/interviews/{interview_id}": Case(),

    # ── Résumés (track 04) ───────────────────────────────────────────────────
    "GET /api/resumes": Case(shows_rows=True),
    "GET /api/resumes/shelf": Case(shows_rows=True),
    "POST /api/resumes": Case(body=lambda i: {"name": "New résumé", "parent_id": str(i["resume"]),
                                              "job_id": str(i["job"])}, body_ids=True),
    "POST /api/resumes/copy": Case(body=lambda i: {"base_resume_id": str(i["resume"]), "job_id": str(i["job"])},
                                   body_ids=True),
    "POST /api/resumes/tailor": Case(body=lambda i: {"base_resume_id": str(i["resume"]), "job_id": str(i["job"])},
                                     body_ids=True),
    "POST /api/resumes/import-pdf": Case(upload=True),
    "GET /api/resumes/{resume_id}": Case(),
    "PATCH /api/resumes/{resume_id}": Case(path={"resume_id": "tailored"},
                                           body=lambda i: {"name": "Renamed", "parent_id": str(i["resume"]),
                                                           "job_id": str(i["job"])}, body_ids=True),
    "DELETE /api/resumes/{resume_id}": Case(path={"resume_id": "tailored"}),
    "GET /api/resumes/{resume_id}/preview": Case(),
    "GET /api/resumes/{resume_id}/pdf": Case(),
    "POST /api/resumes/{resume_id}/score-check": Case(path={"resume_id": "tailored"}, body=lambda i: {"depth": "light"}),
    "GET /api/resumes/{resume_id}/tracer-stats": Case(),

    # ── Cover letters (track 04) ─────────────────────────────────────────────
    "GET /api/cover-letters": Case(shows_rows=True),
    "POST /api/cover-letters": Case(body=lambda i: {"name": "New letter", "job_id": str(i["job"]),
                                                    "resume_id": str(i["resume"])}, body_ids=True),
    "POST /api/cover-letters/generate": Case(body=lambda i: {"resume_id": str(i["resume"]), "job_id": str(i["job"])},
                                             body_ids=True),
    "GET /api/cover-letters/{cl_id}": Case(),
    "PATCH /api/cover-letters/{cl_id}": Case(body=lambda i: {"name": "Renamed letter", "job_id": str(i["job"]),
                                                             "resume_id": str(i["resume"])}, body_ids=True),
    "DELETE /api/cover-letters/{cl_id}": Case(),
    "GET /api/cover-letters/{cl_id}/pdf": Case(),
    "GET /api/cover-letters/{cl_id}/tracer-stats": Case(),

    # ── Analytics (track 05) ─────────────────────────────────────────────────
    "GET /api/stats": Case(),
    "GET /api/stats/sankey": Case(),
    "GET /api/stats/timeline": Case(),
    "GET /api/stats/score-distribution": Case(),
}


@dataclass(frozen=True)
class Gap:
    """A FIRM route that isn't isolated yet, on purpose until a track lands (07-auth F4 "Known gaps")."""
    reason: str
    removed_by: str


_PERSONA = Gap("The Persona is one global row: every firm reads and writes the same one (07-auth F4)",
               "Candidates track (D1): the Persona becomes per-candidate data")
_SHARED_JOB = Gap("A job's status and scores sit on the shared pool's row, so one firm's change shows in the other's "
                  "(07-auth F4)", "Jobs track: JobMark (Q36)")

# Routes skipped by the matrix: they don't read or write by firm at all.
KNOWN_GAPS: dict[str, Gap] = {
    "GET /api/persona": _PERSONA,
    "PATCH /api/persona": _PERSONA,
    "POST /api/persona/import": _PERSONA,
    "POST /api/persona/qa-bank": _PERSONA,
    "GET /api/autofill/config": _PERSONA,
    "POST /api/autofill/answer": _PERSONA,
    "POST /api/autofill/answer/stream": _PERSONA,
}

# Routes that are isolated (they're in CASES), except on a job both firms link to. test_isolation checks the gap is
# still there, so the entry fails once the Jobs track closes it.
SHARED_JOB_GAPS: dict[str, Gap] = {
    "PATCH /api/jobs/{job_id}": _SHARED_JOB,
    "POST /api/jobs/bulk-update": _SHARED_JOB,
}

# ── The other classes: why each is open to more than one firm ─────────────────
SIGNED_IN_CASES: dict[str, Case] = {
    # A firm user gets only their own firm; another firm's slug is the same 404 as an unknown one.
    "GET /api/firms/by-slug/{slug}": Case(),
    # Global reference data, but its application and job counts are the caller's firm's.
    "GET /api/companies": Case(),
}
SIGNED_IN_REASONS: dict[str, str] = {
    "GET /api/oauth/google/callback": "one-use state bound to initiating firm/user and current candidate scope",
    "GET /api/auth/me": "the caller's own session",
    "GET /api/searches/countries": "global reference data",
    "GET /api/llm/models": "global reference data",
    "GET /api/llm/efforts": "global reference data",
    "GET /api/resumes/templates": "global reference data: the template files",
    "GET /api/cover-letters/templates": "global reference data: the template files",
}
PUBLIC_REASONS: dict[str, str] = {
    "GET /health": "health check, no data",
    "GET /": "tracer links (?cv=): found by the link's own token, the click logged on the link's firm",
    "GET /cv/{token}": "tracer links: found by the link's own token, the click logged on the link's firm",
    "POST /api/telegram/webhook": "Telegram, with its own secret header; a platform integration",
    "POST /api/auth/sign-in": "signing in",
    "POST /api/auth/sign-out": "signing out ends the caller's own session only",
    "GET /api/invites/{token}": "an invite link: its 256-bit token is the secret",
    "POST /api/invites/{token}/accept": "an invite link: its 256-bit token is the secret",
}
DEV_ONLY_REASONS: dict[str, str] = {
    "GET /docs": "API docs, absent in production",
    "GET /docs/oauth2-redirect": "API docs, absent in production",
    "GET /redoc": "API docs, absent in production",
    "GET /openapi.json": "API docs, absent in production",
}
