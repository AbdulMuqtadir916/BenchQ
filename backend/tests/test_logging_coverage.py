"""Every route that takes a body is reviewed for what it could write to the log (docs/team/uzair.md §1, step 4a).

The canary (test_logging_canary.py) only checks the routes it sends planted data through. So that a new route can't
be missed, each POST, PUT and PATCH route is listed here as one of:

  canary  the canary sends planted data through it: the value names that canary test
  none    it neither receives nor works on anyone's data (ids, flags, job postings, companies): the value says why
  todo    it handles people's data and has no canary case yet: the value names its owner

A new route fails `test_every_route_that_takes_a_body_is_reviewed` until it is listed. If it handles people's data,
add a case to the canary and list it as canary; `todo` is the list of what is still owed, and it should only shrink.
Reviewed 2026-11-04.
"""
import backend.tests.test_logging_canary as canary

BODY_METHODS = {"POST", "PUT", "PATCH"}

LOG_REVIEW: dict[str, tuple[str, str]] = {
    # ── Covered by the canary ─────────────────────────────────────────────────
    "POST /api/auth/sign-in": ("canary", "test_sign_in"),
    "POST /api/invites/{token}/accept": ("canary", "test_invite_links"),
    "POST /api/auth/password-reset/request": ("canary", "test_a_password_reset_from_request_to_new_password"),
    "POST /api/auth/password-reset/complete": ("canary", "test_a_password_reset_from_request_to_new_password"),
    "POST /api/notifications/{notification_id}/password-reset-decision":
        ("canary", "test_a_password_reset_from_request_to_new_password"),
    "POST /api/firms/{firm_id}/candidates": ("canary", "test_creating_and_editing_a_candidate"),
    "PATCH /api/firms/{firm_id}/candidates/{candidate_id}": ("canary", "test_creating_and_editing_a_candidate"),
    "POST /api/firms/{firm_id}/candidates/parse-resume": ("canary", "test_parsing_a_resume"),

    # ── No one's data ─────────────────────────────────────────────────────────
    "POST /api/auth/sign-out": ("none", "no body; ends the session"),
    "POST /api/auth/first-run-done": ("none", "no body; a flag"),
    "PATCH /api/notifications/{notification_id}/read": ("none", "an id and a flag"),
    "PATCH /api/firms/{firm_id}/candidates/{candidate_id}/inbox-messages/{message_id}/read":
        ("none", "ids and a flag; the message isn't read"),
    "PATCH /api/firms/{firm_id}/members/{user_id}/manager": ("none", "ids"),
    "POST /api/firms/{firm_id}/candidates/{candidate_id}/assign": ("none", "ids"),
    "POST /api/firms/{firm_id}/invites/{invite_id}/resend": ("none", "an id; a new token, which is masked"),
    "POST /api/firms/{firm_id}/invites/{invite_id}/revoke": ("none", "an id"),
    "POST /api/admin/invites/{invite_id}/resend": ("none", "an id; a new token, which is masked"),
    "POST /api/admin/invites/{invite_id}/revoke": ("none", "an id"),
    "POST /api/applications/bulk-delete": ("none", "ids"),
    "POST /api/applications/extract": ("none", "a job posting's URL and text"),
    "PATCH /api/companies/{company_id}": ("none", "a company: global reference data"),
    "POST /api/companies": ("none", "a company: global reference data"),
    "POST /api/companies/auto-create-from-jobs": ("none", "companies from job postings"),
    "POST /api/companies/backfill-h1b-jobs": ("none", "public H-1B data"),
    "POST /api/companies/bulk-activate": ("none", "company ids"),
    "POST /api/companies/refresh-h1b": ("none", "public H-1B data"),
    "POST /api/companies/{company_id}/acknowledge": ("none", "a company id"),
    "POST /api/companies/{company_id}/test-scrape": ("none", "a company's job board"),
    "POST /api/h1b/refresh": ("none", "public H-1B data"),
    "PATCH /api/jobs/{job_id}": ("none", "a job posting"),
    "POST /api/jobs/backfill-descriptions": ("none", "job postings"),
    "POST /api/jobs/bulk-update": ("none", "job ids and flags"),
    "POST /api/jobs/cache-applied": ("none", "job postings"),
    "POST /api/jobs/manual": ("none", "a job posting"),
    "POST /api/jobs/save-from-extension": ("none", "a job posting"),
    "POST /api/jobs/linkedin-import": ("none", "job postings"),
    "POST /api/scrape/company/{company_id}": ("none", "a company's job board"),
    "POST /api/scrape/run-all": ("none", "a trigger"),
    "POST /api/auto-reject/run": ("none", "a trigger; logs counts"),
    "POST /api/db/backup": ("none", "a trigger; the backup isn't logged"),
    "POST /api/db/cleanup": ("none", "a trigger; logs counts"),
    "POST /api/telegram/digest": ("none", "the platform's job alerts"),
    "POST /api/telegram/register-webhook": ("none", "the platform's bot setup; the URL carries no secret"),
    "POST /api/telegram/rotate-webhook-secret": ("none", "a new secret, which is masked"),
    "POST /api/telegram/test": ("none", "a test alert"),
    "POST /api/telegram/webhook": ("none", "the platform's bot commands"),

    # ── People's data, no canary case yet ─────────────────────────────────────
    "POST /api/admin/firms": ("todo", "Abdul: the firm's owner name and email"),
    "POST /api/firms/{firm_id}/invites": ("todo", "Abdul: the invitee's name and email"),
    "PATCH /api/firms/{firm_id}/settings": ("todo", "Abdul: firm settings"),
    "POST /api/support-views": ("todo", "Abdul: the support view's reason"),
    "POST /api/notifications/{notification_id}/password-reset-link": ("todo", "Umamah: a reset link's token"),
    "PATCH /api/settings": ("todo", "Uzair: global settings carry API keys"),
    "POST /api/linkedin/session/pin": ("todo", "Zuhair: a LinkedIn PIN"),
    "POST /api/linkedin/session/refresh": ("todo", "Zuhair: LinkedIn session cookies"),
    "POST /api/analyze/{job_id}": ("todo", "Zuhair: scores a candidate's résumé"),
    "POST /api/searches": ("todo", "Zuhair: a search may be named after its candidate"),
    "PATCH /api/searches/{search_id}": ("todo", "Zuhair: a search may be named after its candidate"),
    "POST /api/searches/{search_id}/acknowledge": ("todo", "Zuhair: a search may be named after its candidate"),
    "POST /api/searches/{search_id}/run": ("todo", "Zuhair: a search may be named after its candidate"),
    "POST /api/searches/{search_id}/test": ("todo", "Zuhair: a search may be named after its candidate"),
    "POST /api/resumes": ("todo", "Zuhair: résumé text"),
    "PATCH /api/resumes/{resume_id}": ("todo", "Zuhair: résumé text"),
    "POST /api/resumes/copy": ("todo", "Zuhair: résumé text"),
    "POST /api/resumes/import-pdf": ("todo", "Zuhair: a résumé file"),
    "POST /api/resumes/tailor": ("todo", "Zuhair: résumé text and the AI's reply"),
    "POST /api/resumes/{resume_id}/score-check": ("todo", "Zuhair: résumé text and the AI's reply"),
    "POST /api/firms/{firm_id}/candidates/{candidate_id}/resumes/upload": ("todo", "Zuhair: a résumé file"),
    "POST /api/firms/{firm_id}/candidates/{candidate_id}/resumes/{resume_id}/save": ("todo", "Zuhair: résumé text"),
    "POST /api/firms/{firm_id}/candidates/{candidate_id}/resumes/{resume_id}/use-as-base":
        ("todo", "Zuhair: résumé text"),
    "POST /api/firms/{firm_id}/candidates/{candidate_id}/resumes/bases/{base_id}/show": ("todo", "Zuhair: résumé text"),
    "PATCH /api/persona": ("todo", "Zuhair: a persona's résumé"),
    "POST /api/persona/import": ("todo", "Zuhair: a résumé file"),
    "POST /api/persona/qa-bank": ("todo", "Zuhair: a candidate's answers"),
    "PATCH /api/cover-letters/{cl_id}": ("todo", "Zuhair: a cover letter"),
    "POST /api/cover-letters": ("todo", "Zuhair: a cover letter"),
    "POST /api/cover-letters/generate": ("todo", "Zuhair: a cover letter and the AI's reply"),
    "POST /api/applications": ("todo", "Samad: an application's notes"),
    "PATCH /api/applications/{app_id}": ("todo", "Samad: an application's notes"),
    "PATCH /api/applications/{app_id}/candidate-status": ("todo", "Samad: a candidate's status and note"),
    "PATCH /api/applications/{app_id}/review": ("todo", "Samad: a review's note"),
    "POST /api/applications/bulk-update": ("todo", "Samad: application notes"),
    "POST /api/applications/{app_id}/interviews": ("todo", "Samad: an interview's people and notes"),
    "PATCH /api/applications/interviews/{interview_id}": ("todo", "Samad: an interview's people and notes"),
    "POST /api/email/check-now": ("todo", "Samad: reads candidates' email"),
    "POST /api/firms/{firm_id}/candidates/{candidate_id}/mailbox/oauth": ("todo", "Samad: a mailbox's Google grant"),
    "POST /api/firms/{firm_id}/candidates/{candidate_id}/mailbox/confirm/{attempt_id}":
        ("todo", "Samad: a mailbox's address"),
    "POST /api/firms/{firm_id}/candidates/{candidate_id}/mailbox/sync": ("todo", "Samad: reads a candidate's email"),
    "POST /api/autofill/answer": ("todo", "Samad: a candidate's answers"),
    "POST /api/autofill/answer/stream": ("todo", "Samad: a candidate's answers"),
}


def _body_routes() -> set[str]:
    from backend.main import app
    return {f"{m} {r.path}" for r in app.router.routes for m in (getattr(r, "methods", None) or ()) if m in BODY_METHODS}


def test_every_route_that_takes_a_body_is_reviewed():
    missing = sorted(_body_routes() - set(LOG_REVIEW))
    assert not missing, (
        "a new route takes a body: list it in LOG_REVIEW in backend/tests/test_logging_coverage.py. If it handles "
        "anyone's data (a name, an email, a résumé, an email's text, a secret), add a case to the canary "
        f"(test_logging_canary.py) and list it as canary: {missing}")


def test_the_review_names_no_route_that_does_not_exist():
    stale = sorted(set(LOG_REVIEW) - _body_routes())
    assert not stale, f"remove these from LOG_REVIEW: {stale}"


def test_each_entry_is_complete():
    for route, (status, note) in LOG_REVIEW.items():
        assert status in {"canary", "none", "todo"} and note.strip(), route
        if status == "canary":
            assert callable(getattr(canary, note, None)), f"{route}: no canary test named {note}"
        if status == "todo":
            assert ":" in note, f"{route}: a todo names its owner first ('Owner: what')"
