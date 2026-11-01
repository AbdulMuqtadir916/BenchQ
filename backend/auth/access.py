"""Who may call each endpoint (07 Q38): every route is classified here, and anything unclassified is refused.

  PUBLIC     no session: sign-in, invite links, health, tracer links, the Telegram webhook (its own secret)
  SIGNED_IN  any signed-in account
  FIRM       a signed-in firm user whose firm is not SUSPENDED; and a Super Admin inside an open support view
             (07 §4), for GET only: every other method is 403, and so are the GETs in SUPPORT_VIEW_REFUSED.
             Which firm a view reads is backend/auth/scoping.py's `reader_firm_id`, so any other firm is 404.
             A Super Admin with no view is refused
  PLATFORM   a Super Admin: scraping, backups, database cleanup, monitoring, global settings, Telegram
  DEV_ONLY   API docs: open outside production, absent (404) in production

`test_access.py` fails when a route is missing from this table, so a new endpoint is covered by default.
Firm scoping inside an endpoint (which rows a firm may see) is the endpoint's job, not this table's.
"""
import logging
from enum import Enum

from fastapi import FastAPI
from sqlalchemy.exc import OperationalError, TimeoutError as PoolTimeout
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Match

from backend.auth.sessions import COOKIE_NAME, clear_cookie_kwargs, cookie_kwargs, resolve
from backend.config import ALLOWED_ORIGINS, IS_PRODUCTION
from backend.models.db import SessionLocal
from backend.statement_timeout import busy_response, is_statement_timeout

logger = logging.getLogger("jobnavigator")


class Access(str, Enum):
    PUBLIC = "public"
    SIGNED_IN = "signed_in"
    FIRM = "firm"
    PLATFORM = "platform"
    DEV_ONLY = "dev_only"


P, S, F, A, D = Access.PUBLIC, Access.SIGNED_IN, Access.FIRM, Access.PLATFORM, Access.DEV_ONLY

ROUTE_ACCESS: dict[str, Access] = {
    # ── Public ────────────────────────────────────────────────────────────────
    "GET /health": P,
    "GET /": P,                                    # ?cv=<token> tracer links on the root
    "GET /cv/{token}": P,
    "POST /api/telegram/webhook": P,               # checks its own secret header
    "POST /api/auth/sign-in": P,
    "POST /api/auth/sign-out": P,                  # clears the cookie even when the session is already gone
    "GET /api/invites/{token}": P,                 # /invite/[token]: the link's 256-bit token is the secret
    "POST /api/invites/{token}/accept": P,
    "GET /docs": D, "GET /docs/oauth2-redirect": D, "GET /redoc": D, "GET /openapi.json": D,

    # ── Any signed-in account ─────────────────────────────────────────────────
    "GET /api/auth/me": S,
    "GET /api/firms/by-slug/{slug}": S,            # a firm user's own firm only; 404 otherwise
    "GET /api/companies": S,                       # global reference data
    "GET /api/searches/countries": S,
    "GET /api/llm/models": S,
    "GET /api/llm/efforts": S,
    "GET /api/resumes/templates": S,
    "GET /api/cover-letters/templates": S,

    # ── Firm users ────────────────────────────────────────────────────────────
    "POST /api/auth/first-run-done": F,
    # The firm's team (Phase M): each also checks the path's firm is the caller's, and its action.
    "GET /api/firms/{firm_id}/members": F,
    "GET /api/firms/{firm_id}/invites": F,
    "POST /api/firms/{firm_id}/invites": F,
    "POST /api/firms/{firm_id}/invites/{invite_id}/resend": F,
    "POST /api/firms/{firm_id}/invites/{invite_id}/revoke": F,
    "PATCH /api/firms/{firm_id}/members/{user_id}/manager": F,   # OWNER only: member.changeManager (07 Q40)
    "PATCH /api/firms/{firm_id}/settings": F,                    # OWNER only: firmSettings.edit (07 Q46)
    "POST /api/firms/{firm_id}/candidates/parse-resume": F,      # OWNER, MANAGER: candidate.create (07 Q41, Q49)
    "GET /api/firms/{firm_id}/candidates": F,                    # in the principal's scope (07 Q47)
    "POST /api/firms/{firm_id}/candidates": F,                   # OWNER, MANAGER: candidate.create + can_assign_to
    "GET /api/firms/{firm_id}/candidates/{candidate_id}": F,
    "PATCH /api/firms/{firm_id}/candidates/{candidate_id}": F,   # candidate.edit, in scope
    "POST /api/firms/{firm_id}/candidates/{candidate_id}/assign": F,   # candidate.assign + can_assign_to (Q43)
    "GET /api/firms/{firm_id}/ledger": F,          # a BDE gets their own entries only (routes_ledger)
    "POST /api/analyze/{job_id}": F,
    "GET /api/firms/{firm_id}/candidates/{candidate_id}/inbox": F,
    "POST /api/firms/{firm_id}/candidates/{candidate_id}/mailbox/oauth": F,
    "POST /api/firms/{firm_id}/candidates/{candidate_id}/mailbox/sync": F,
    "DELETE /api/firms/{firm_id}/candidates/{candidate_id}/mailbox": F,
    "PATCH /api/firms/{firm_id}/candidates/{candidate_id}/inbox-messages/{message_id}/read": F,
    "GET /api/oauth/google/callback": S,
    "GET /api/applications": F,
    "GET /api/applications/{app_id}": F,
    "PATCH /api/applications/{app_id}/candidate-status": F,
    "PATCH /api/applications/{app_id}/review": F,
    "POST /api/applications": F,
    "POST /api/applications/bulk-delete": F,
    "POST /api/applications/bulk-update": F,
    "POST /api/applications/extract": F,
    "DELETE /api/applications/interviews/{interview_id}": F,
    "PATCH /api/applications/interviews/{interview_id}": F,
    "DELETE /api/applications/{app_id}": F,
    "PATCH /api/applications/{app_id}": F,
    "POST /api/applications/{app_id}/interviews": F,
    "GET /api/applications/{app_id}/prep": F,
    "POST /api/autofill/answer": F,
    "POST /api/autofill/answer/stream": F,
    "GET /api/autofill/config": F,
    "GET /api/cover-letters": F,
    "POST /api/cover-letters": F,
    "POST /api/cover-letters/generate": F,
    "DELETE /api/cover-letters/{cl_id}": F,
    "GET /api/cover-letters/{cl_id}": F,
    "PATCH /api/cover-letters/{cl_id}": F,
    "GET /api/cover-letters/{cl_id}/pdf": F,
    "GET /api/cover-letters/{cl_id}/tracer-stats": F,
    "GET /api/jobs": F,
    "POST /api/jobs/bulk-update": F,
    "POST /api/jobs/cache-applied": F,
    "GET /api/jobs/companies/list": F,
    "GET /api/jobs/facets": F,
    "GET /api/jobs/feed-stats": F,
    "POST /api/jobs/manual": F,
    "POST /api/jobs/save-from-extension": F,
    "GET /api/jobs/sources/list": F,
    "GET /api/jobs/unscored-ids": F,
    "GET /api/jobs/verdicts/list": F,
    "GET /api/jobs/{job_id}": F,
    "PATCH /api/jobs/{job_id}": F,
    "GET /api/jobs/{job_id}/cached-page": F,
    "GET /api/jobs/{job_id}/frame-check": F,
    "GET /api/jobs/{job_id}/live-page": F,
    "GET /api/persona": F,
    "PATCH /api/persona": F,
    "POST /api/persona/import": F,
    "POST /api/persona/qa-bank": F,
    "GET /api/resumes": F,
    "POST /api/resumes": F,
    "POST /api/resumes/copy": F,
    "POST /api/resumes/import-pdf": F,
    "GET /api/resumes/shelf": F,
    "POST /api/resumes/tailor": F,
    "DELETE /api/resumes/{resume_id}": F,
    "GET /api/resumes/{resume_id}": F,
    "PATCH /api/resumes/{resume_id}": F,
    "GET /api/resumes/{resume_id}/pdf": F,
    "GET /api/resumes/{resume_id}/preview": F,
    "POST /api/resumes/{resume_id}/score-check": F,
    "GET /api/resumes/{resume_id}/tracer-stats": F,
    "GET /api/stats": F,
    "GET /api/stats/sankey": F,
    "GET /api/stats/score-distribution": F,
    "GET /api/stats/timeline": F,

    # ── Super Admin ───────────────────────────────────────────────────────────
    # The platform tier (docs/04 §14). Each write also needs its platform action (backend/auth/policy.py).
    "POST /api/support-views": A,                  # open a read-only support view of a firm (07 §4)
    "DELETE /api/support-views/current": A,
    "GET /api/admin/plans": A,
    "GET /api/admin/firms": A,
    "POST /api/admin/firms": A,
    "GET /api/admin/firms/{firm_id}": A,
    "GET /api/admin/invites": A,
    "POST /api/admin/invites/{invite_id}/resend": A,
    "POST /api/admin/invites/{invite_id}/revoke": A,
    "GET /api/admin/users": A,
    "GET /api/admin/team": A,
    "GET /api/admin/audit": A,
    "GET /api/activity-log": A,                    # the system log, not the business ledger (07-auth §6.6)
    "POST /api/auto-reject/run": A,
    "POST /api/companies": A,                      # companies are global reference data
    "POST /api/companies/auto-create-from-jobs": A,
    "POST /api/companies/backfill-h1b-jobs": A,
    "POST /api/companies/bulk-activate": A,
    "POST /api/companies/refresh-h1b": A,
    "DELETE /api/companies/{company_id}": A,
    "PATCH /api/companies/{company_id}": A,
    "POST /api/companies/{company_id}/acknowledge": A,
    "POST /api/companies/{company_id}/test-scrape": A,
    "POST /api/db/backup": A,
    "POST /api/db/cleanup": A,
    "POST /api/email/check-now": A,
    "POST /api/h1b/refresh": A,
    "GET /api/health/entities": A,
    "POST /api/jobs/backfill-descriptions": A,
    "POST /api/jobs/linkedin-import": A,           # imports into the shared pool with the platform's account
    "GET /api/jobs/linkedin-import/progress": A,
    "GET /api/linkedin/session": A,
    "POST /api/linkedin/session/pin": A,
    "POST /api/linkedin/session/refresh": A,
    "GET /api/monitor/active": A,
    "GET /api/monitor/finished": A,
    "GET /api/monitor/history": A,
    "GET /api/monitor/in-flight": A,
    "GET /api/monitor/run/{run_id}": A,
    "GET /api/scheduler/jobs": A,
    "GET /api/scrape-log": A,
    "POST /api/scrape/company/{company_id}": A,
    "POST /api/scrape/run-all": A,
    # Searches drive the shared scraper until F2b makes them firm-owned (Q37).
    "GET /api/searches": A,
    "POST /api/searches": A,
    "GET /api/searches/test-result/{run_id}": A,
    "DELETE /api/searches/{search_id}": A,
    "PATCH /api/searches/{search_id}": A,
    "POST /api/searches/{search_id}/acknowledge": A,
    "POST /api/searches/{search_id}/run": A,
    "POST /api/searches/{search_id}/test": A,
    # One global settings table (LLM keys, schedules) until F2c splits out the firm-owned ones.
    "GET /api/settings": A,
    "PATCH /api/settings": A,
    "GET /api/settings/defaults": A,
    "GET /api/stats/llm-costs": A,                 # AI spend is Super Admin only (Q34)
    "POST /api/telegram/digest": A,                # Telegram is not a focus (Q38): locked, otherwise as is
    "POST /api/telegram/register-webhook": A,
    "POST /api/telegram/rotate-webhook-secret": A,
    "POST /api/telegram/test": A,
}


# FIRM GETs a support view may not use: they act rather than read. A view never exports a resume (07 §4).
SUPPORT_VIEW_REFUSED: frozenset[str] = frozenset({
    "GET /api/resumes/{resume_id}/pdf",
    "GET /api/cover-letters/{cl_id}/pdf",
})
SUPPORT_VIEW_READ_ONLY = "A support view is read-only."


def route_key(app: FastAPI, request: Request) -> str | None:
    """'METHOD /path/template' of the route this request will reach, or None when no route matches fully
    (the router then answers 404 or 405 itself)."""
    for route in app.router.routes:
        match, _ = route.matches(request.scope)
        if match == Match.FULL:
            return f"{request.method} {route.path}"
    return None


# ── The middleware ────────────────────────────────────────────────────────────
UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def _refuse(status: int, detail: str, clear_cookie: bool = False) -> JSONResponse:
    response = JSONResponse(status_code=status, content={"detail": detail})
    if clear_cookie:
        response.delete_cookie(**clear_cookie_kwargs())
    return response


async def enforce(request: Request, call_next):
    """Classify the request's route, check the Origin on unsafe methods, resolve the session cookie, and
    refuse what the route's class does not allow. Sets `request.state.principal` for signed-in routes."""
    if request.method == "OPTIONS":                 # CORS preflight: CORSMiddleware answers it
        return await call_next(request)
    key = route_key(request.app, request)
    if key is None:                                 # no such route: the router's own 404/405
        return await call_next(request)
    access = ROUTE_ACCESS.get(key)
    if access is None:
        logger.error("refused unclassified route %s: add it to backend/auth/access.py", key)
        return _refuse(403, "Forbidden")
    if access is Access.DEV_ONLY:
        return _refuse(404, "Not Found") if IS_PRODUCTION else await call_next(request)

    # CSRF (07-auth §2): a browser always sends Origin on a cross-site POST, so one from elsewhere is refused.
    # Clients without a browser (the Telegram webhook, curl) send none and carry no cookie to abuse.
    origin = request.headers.get("origin")
    if request.method in UNSAFE_METHODS and origin is not None and origin not in ALLOWED_ORIGINS:
        logger.warning("refused cross-origin %s from %r", key, origin)
        return _refuse(403, "Cross-origin request refused")
    if access is Access.PUBLIC:
        return await call_next(request)

    token = request.cookies.get(COOKIE_NAME)
    # A middleware runs outside FastAPI's exception handlers, so a drained pool or a timed-out query is answered here.
    db = SessionLocal()
    try:
        resolved = resolve(db, token)
    except PoolTimeout:
        logger.warning("DB pool exhausted while authenticating %s", key)
        return busy_response()
    except OperationalError as exc:
        if not is_statement_timeout(exc):
            raise
        logger.warning("Query timed out while authenticating %s", key)
        return busy_response()
    finally:
        db.close()
    if resolved is None:
        return _refuse(401, "Sign in to continue.", clear_cookie=token is not None)

    principal = resolved.principal
    if access is Access.PLATFORM and not principal.is_platform:
        return _refuse(403, "Platform admins only.")
    if access is Access.FIRM:
        if principal.is_platform:
            if principal.support_view_id is None:
                return _refuse(403, "A platform admin can't act inside a firm.")
            if request.method != "GET" or key in SUPPORT_VIEW_REFUSED:
                return _refuse(403, SUPPORT_VIEW_READ_ONLY)
        elif principal.firm_status == "SUSPENDED":
            return _refuse(403, "This workspace is suspended.")

    request.state.principal = principal
    response = await call_next(request)
    if resolved.expires_at is not None:             # the expiry slid: send the cookie again with it
        response.set_cookie(value=resolved.token, **cookie_kwargs(resolved.expires_at))
    return response
