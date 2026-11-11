"""The world F7's isolation test runs in (backend/tests/test_isolation.py; 07-auth F7).

Two firms, A ("acme", the signed-in test firm) and B ("globex"), each with one row of every firm-owned kind: a job
the firm links to, an application with an interview, a base résumé with a tailored copy, a cover letter, a tracer
link with a click, a pending BDE invite, a ledger entry. Firm B's rows carry canaries (`GLOBEX-CANARY…` text and
their ids), so a list that leaks one of them is caught whatever its shape. A third job is linked to both firms: the
shared pool (Q37), visible to each.

`snapshot_of(db, firm_id)` is every row the firm owns, to prove another firm's request changed none of it.
`offline` stubs the calls that leave the process (LLM workers, page fetches, the PDF browser), so a firm's own
member can really perform every write.

A track that adds a firm-owned table adds a row of it to `build_firm` (with a canary) and to `snapshot_of`.
"""
from dataclasses import dataclass, field
import uuid

import pytest

CANARY = "GLOBEX-CANARY"
JOB_TEXT = ("Senior Java developer for a payments platform. Spring Boot, Kafka, PostgreSQL, AWS, microservices, "
            "REST APIs, CI/CD, code review, mentoring. Hybrid in Dallas, TX; C2C or W2. ") * 4
RESUME_JSON = {
    "header": {"name": "Priya Raman", "email": "priya@example.test"},
    "summary": "Java developer with nine years of Spring Boot, Kafka and AWS for payments and banking clients.",
    "experience": [{"company": "Initech", "title": "Senior Java Developer", "bullets": [
        "Built Kafka pipelines processing two million payments a day.",
        "Led a team of five on a Spring Boot migration to AWS EKS.",
        "Cut API latency by forty percent with caching and query tuning."]}],
    "skills": ["Java", "Spring Boot", "Kafka", "AWS", "PostgreSQL", "Docker", "Kubernetes"],
}

# The same résumé in the version columns (résumé versioning §3.3), with item ids.
RESUME_COLUMNS = {
    "email": "priya@example.test", "summary": RESUME_JSON["summary"],
    "experiences": [{"id": "exp-1", "job_title": "Senior Java Developer", "company": "Initech", "location": "",
                     "dates": "", "start": "", "end": "", "current": False,
                     "bullets": [{"id": f"exp-1-b{n}", "text": text}
                                 for n, text in enumerate(RESUME_JSON["experience"][0]["bullets"])]}],
    "skills": [{"id": f"skill-{n}", "category": "", "name": name} for n, name in enumerate(RESUME_JSON["skills"])],
}

@dataclass
class Side:
    """One firm: its OWNER's cookie, its BDE's (for the routes only a candidate's BDE takes, 07 Q55) and its rows' ids,
    by the names the case table uses."""
    firm_id: uuid.UUID
    cookie: dict
    ids: dict = field(default_factory=dict)
    bde_cookie: dict = field(default_factory=dict)


@dataclass
class World:
    db: object
    a: Side
    b: Side | None
    admin: dict                       # the Super Admin's cookie
    shared_job: uuid.UUID
    plan_id: uuid.UUID

    def missing(self) -> dict:
        """Ids of the same kinds that exist nowhere: the answer for B's ids must equal the answer for these."""
        ids = {key: str(uuid.uuid4()) for key in self.a.ids}
        ids["slug"] = "no-such-firm"
        return ids

    def canaries(self) -> list[str]:
        """What must never appear in firm A's answers: B's canary text and every id of B's."""
        return [CANARY, *(str(value) for key, value in self.b.ids.items() if key != "slug")]


def cookie(token: str) -> dict:
    return {"cookie": f"bq_session={token}"}


def _session(db, account) -> dict:
    from backend.auth.sessions import start_session
    token, _ = start_session(db, account)
    return cookie(token)


def build_firm(db, firm, owner, tag: str) -> dict:
    """One row of every firm-owned kind, `tag` in every text (B's is the canary). Returns their ids."""
    from backend.auth import ledger
    from backend.auth.invites import send_invite
    from backend.models.db import Application, CoverLetter, Interview, Job, Resume, TracerClickEvent, TracerLink, utcnow
    from backend.models.tenancy import link_job_to_firm

    job = Job(external_id=f"{tag}-job", title=f"{tag} Java Developer", company=f"{tag} Corp",
              url=f"https://jobs.example.test/{tag.lower()}", source="manual", description=JOB_TEXT,
              cached_page_html=f"<html><body><p>{JOB_TEXT}</p></body></html>", cached_page_text=JOB_TEXT)
    db.add(job)
    db.flush()
    link_job_to_firm(db, firm.id, job.id, "CAPTURED", captured_by_user_id=owner.id)
    # The hierarchy (07 Q40): a MANAGER and a BDE who reports to them.
    from backend.models.tenancy import User
    from backend.tests.auth_support import password_hash
    manager = User(firm_id=firm.id, role="MANAGER", name=f"{tag} manager", email=f"manager@{tag.lower()}.test",
                   password_hash=password_hash())
    db.add(manager)
    db.flush()
    bde = User(firm_id=firm.id, role="BDE", name=f"{tag} bde", email=f"bde-user@{tag.lower()}.test",
               manager_id=manager.id, password_hash=password_hash())
    db.add(bde)
    db.flush()
    from backend.models.candidates import Candidate
    candidate = Candidate(firm_id=firm.id, manager_id=manager.id, bde_id=bde.id, created_by_user_id=owner.id,
                          full_name=f"{tag} candidate", primary_role=f"{tag} Java Developer", work_auth="H1B")
    db.add(candidate)
    db.flush()
    # Applications name one of their candidate's postings (migration 0025): the job, as the candidate's.
    from backend.tests.posting_support import posting_for
    posted = dict(title=job.title, company=job.company, url=job.url, description=JOB_TEXT)
    app = Application(firm_id=firm.id, candidate_id=candidate.id, status="applied", notes=f"{tag} application notes",
                      job_id=posting_for(db, firm.id, candidate.id, **posted).id)
    legacy_app = Application(firm_id=firm.id, candidate_id=candidate.id, status="applied",
                             notes=f"{tag} legacy application", job_id=posting_for(db, firm.id, candidate.id, **posted).id)
    db.add_all([app, legacy_app])
    db.flush()
    interview = Interview(firm_id=firm.id, application_id=app.id, what=f"{tag} phone screen")
    db.add(interview)
    # Résumé versioning (PRs 5, 6): the candidate's upload, its active base (the owner's, at onboarding: v1 is
    # "resume") with a BDE's v2 and a tailored résumé for the job ("tailored"); and a second base the BDE made from
    # v2, unused, so a delete of it or of v2 goes through.
    from backend.models.candidates import BaseResume, ResumeParse
    upload = ResumeParse(firm_id=firm.id, uploaded_by_user_id=owner.id, candidate_id=candidate.id,
                         file_name=f"{tag}.pdf", mime_type="application/pdf", size_bytes=len(tag),
                         content=f"{tag} file".encode(), parse={"header": {"name": f"{tag} candidate"}})
    db.add(upload)
    db.flush()
    first = BaseResume(firm_id=firm.id, candidate_id=candidate.id, source="UPLOAD", resume_parse_id=upload.id,
                       is_active=True, created_by_user_id=owner.id)
    db.add(first)
    db.flush()
    versioned = dict(firm_id=firm.id, candidate_id=candidate.id, full_name=f"{tag} candidate")
    resume = Resume(**versioned, base_resume_id=first.id, category="BASE", version=1, name=f"{tag} base résumé",
                    created_by_user_id=owner.id, **{**RESUME_COLUMNS, "summary": f"{tag} {RESUME_COLUMNS['summary']}"})
    v2 = Resume(**versioned, base_resume_id=first.id, category="BASE", version=2, name=f"{tag} base résumé",
                created_by_user_id=bde.id, **RESUME_COLUMNS)
    tailored = Resume(**versioned, base_resume_id=first.id, category="TAILORED", job_id=job.id, version=1,
                      name=f"{tag} tailored résumé", created_by_user_id=bde.id, **RESUME_COLUMNS)
    db.add_all([resume, v2, tailored])
    db.flush()
    second = BaseResume(firm_id=firm.id, candidate_id=candidate.id, source="PROMOTED", promoted_from_resume_id=v2.id,
                        created_by_user_id=bde.id)
    db.add(second)
    db.flush()
    db.add(Resume(**versioned, base_resume_id=second.id, category="BASE", version=1, name=f"{tag} base résumé",
                  created_by_user_id=bde.id, **RESUME_COLUMNS))
    letter = CoverLetter(firm_id=firm.id, name=f"{tag} cover letter", job_id=job.id, resume_id=resume.id,
                         json_data={"header": RESUME_JSON["header"], "body": f"{tag} letter body"})
    db.add(letter)
    db.flush()
    link = TracerLink(firm_id=firm.id, token=uuid.uuid4().hex[:16],          # tokens are 16 characters
                      destination_url="https://linkedin.example.test/in/priya", source_label=f"{tag} LinkedIn",
                      resume_id=resume.id)
    db.add(link)
    db.flush()
    db.add(TracerClickEvent(firm_id=firm.id, tracer_link_id=link.id))
    # The candidate core (migration 0007): one row of each candidate-owned kind, with `tag` in its text.
    from backend.models.candidates import CandidateJob, CandidateMailbox, FavoriteJob, InboxMessage
    db.add_all([CandidateJob(firm_id=firm.id, candidate_id=candidate.id, job_id=job.id, match_score=80),
                FavoriteJob(firm_id=firm.id, candidate_id=candidate.id, job_id=job.id, marked_by_user_id=bde.id)])
    mailbox = CandidateMailbox(firm_id=firm.id, candidate_id=candidate.id, address=f"{tag.lower()}@mail.test",
                               connected_by_user_id=bde.id)
    db.add(mailbox)
    db.flush()
    candidate_message = InboxMessage(firm_id=firm.id, candidate_id=candidate.id, mailbox_id=mailbox.id, application_id=app.id,
                             provider_message_id=f"{tag}-msg-1", from_name=f"{tag} recruiter",
                             from_email=f"recruiter@{tag.lower()}.test", subject=f"{tag} interview",
                             snippet=f"{tag} snippet", received_at=utcnow())
    db.add(candidate_message)
    db.flush()
    invite, _ = send_invite(db, inviter=owner, firm=firm, email=f"bde@{tag.lower()}.test", role="BDE",
                            invitee_name=f"{tag} invitee", summary=f"Invited a BDE to {tag}", now=utcnow(),
                            manager_id=manager.id)
    ledger.record(db, actor=owner, action="UPDATE", entity_type="candidate", entity_id=uuid.uuid4(),
                  entity_label=f"{tag} candidate", summary=f"{tag} edited a candidate", firm_id=firm.id)
    # A dedicated pending-review application exercises the review command independently.
    from backend.models.db import ApplicationReview
    review_job = Job(external_id=f"{tag}-review", title=f"{tag} review role", company=f"{tag} Corp", source="manual")
    db.add(review_job)
    db.flush()
    review_app = Application(firm_id=firm.id, candidate_id=candidate.id, status="applied",
                             job_id=posting_for(db, firm.id, candidate.id, title=review_job.title, company=review_job.company).id)
    db.add(review_app)
    db.flush()
    review_message = InboxMessage(firm_id=firm.id, candidate_id=candidate.id, mailbox_id=mailbox.id,
        application_id=review_app.id, provider_message_id=f"{tag}-review-email", from_name="Recruiter",
        from_email="recruiter@example.test", subject=f"{tag} assessment", snippet="Assessment", received_at=utcnow())
    db.add(review_message)
    db.flush()
    review = ApplicationReview(firm_id=firm.id, candidate_id=candidate.id, application_id=review_app.id,
        inbox_message_id=review_message.id, reason="LOW_CONFIDENCE", application_revision=0)
    db.add(review)
    db.flush()
    from backend.models.candidates import CandidateGoogleOAuthAttempt
    from datetime import timedelta
    attempt = CandidateGoogleOAuthAttempt(firm_id=firm.id, candidate_id=candidate.id,
        initiated_by_user_id=owner.id, state_hash=uuid.uuid4().hex, code_verifier_ciphertext=b'',
        pending_address=mailbox.address, pending_token_ciphertext=b'synthetic', return_to='/',
        expires_at=utcnow() + timedelta(minutes=10))
    db.add(attempt)
    db.flush()
    # A résumé read waiting for its create (07 Q58: no candidate is added without one).
    pending = ResumeParse(firm_id=firm.id, uploaded_by_user_id=owner.id, file_name=f"{tag} new.pdf",
                          mime_type="application/pdf", size_bytes=len(tag), content=f"{tag} new file".encode(),
                          parse={"header": {}}, expires_at=utcnow() + timedelta(minutes=30))
    db.add(pending)
    db.flush()

    return {"oauth_attempt": attempt.id, "pending_parse": pending.id, "review_app": review_app.id, "review": review.id, "review_message": review_message.id,
            "version": v2.id, "base": second.id,

            "firm": firm.id, "slug": firm.slug, "job": job.id,
            "app": app.id, "legacy_app": legacy_app.id, "inbox_message": candidate_message.id, "interview": interview.id,
            "resume": resume.id, "tailored": tailored.id, "letter": letter.id, "invite": invite.id,
            "manager": manager.id, "bde_user": bde.id, "candidate": candidate.id}


def make_world(db, accounts) -> World:
    """Firm A (the signed-in test firm, with its OWNER) and the shared job. Firm B comes with `add_firm_b`, so a
    test can read firm A's answers before B's rows exist."""
    from backend.models.db import Job, Setting
    from backend.models.tenancy import Firm, PlatformUser, User, link_job_to_firm

    firm_a = db.get(Firm, accounts.firm_id)
    owner_a = db.get(User, accounts.user_id)
    # The tailor and letter routes refuse to run without their prompts (platform settings, seeded in production).
    db.merge(Setting(key="cv_tailor_prompt", value="Tailor the résumé to the job."))
    db.merge(Setting(key="cover_letter_prompt", value="Write a cover letter for the job."))
    shared = Job(external_id="shared-job", title="Shared pool job", company="Pool Inc",
                 url="https://jobs.example.test/shared", source="manual", description=JOB_TEXT)
    db.add(shared)
    db.flush()
    link_job_to_firm(db, firm_a.id, shared.id, "SCRAPED")
    ids = build_firm(db, firm_a, owner_a, "ACME")
    a = Side(firm_a.id, cookie(accounts.firm_token), ids, _session(db, db.get(User, ids["bde_user"])))
    db.commit()
    return World(db=db, a=a, b=None, admin=cookie(accounts.admin_token), shared_job=shared.id,
                 plan_id=firm_a.plan_id)


def add_firm_b(world: World) -> Side:
    from backend.models.tenancy import Plan, link_job_to_firm
    from backend.tests.auth_support import make_firm, make_user

    db = world.db
    firm_b = make_firm(db, db.get(Plan, world.plan_id), slug="globex", name=f"Globex {CANARY}")
    owner_b = make_user(db, firm_b, email="owner@globex.test", name=f"Gary {CANARY}")
    link_job_to_firm(db, firm_b.id, world.shared_job, "SCRAPED")
    from backend.models.tenancy import User
    ids = build_firm(db, firm_b, owner_b, CANARY)
    world.b = Side(firm_b.id, _session(db, owner_b), ids, _session(db, db.get(User, ids["bde_user"])))
    db.commit()
    return world.b


def snapshot_of(db, firm_id: uuid.UUID) -> dict:
    """Every row firm `firm_id` owns, and the jobs only it links to, as plain values: equal before and after another
    firm's request, or that request changed this firm's data."""
    from sqlalchemy import inspect as sa_inspect

    from backend.models.db import Base, Job
    from backend.models.tenancy import FirmJob

    db.expire_all()
    out = {}
    for mapper in Base.registry.mappers:
        table = mapper.class_.__table__
        if "firm_id" not in table.c or table.name in ("users",):
            continue
        rows = db.query(mapper.class_).filter(mapper.class_.firm_id == firm_id).all()
        out[table.name] = sorted(repr({c.key: getattr(row, c.key) for c in sa_inspect(row).mapper.column_attrs})
                                 for row in rows)
    only_mine = db.query(FirmJob.job_id).filter(FirmJob.firm_id == firm_id)
    others = db.query(FirmJob.job_id).filter(FirmJob.firm_id != firm_id)
    jobs = db.query(Job).filter(Job.id.in_(only_mine), ~Job.id.in_(others)).all()
    out["jobs (only this firm's)"] = sorted(
        repr({c.key: getattr(job, c.key) for c in sa_inspect(job).mapper.column_attrs}) for job in jobs)
    return out


class _Page:
    async def set_content(self, *args, **kwargs):
        return None

    async def pdf(self, *args, **kwargs):
        return b"%PDF-1.4 isolation test"

    async def close(self):
        return None


class _Browser:
    async def new_page(self, *args, **kwargs):
        return _Page()


class _Response:
    status_code = 200
    url = "https://jobs.example.test/page"
    headers = {"content-type": "text/html"}
    text = f"<html><head><title>Posting</title></head><body><main><h1>Java Developer</h1><p>{JOB_TEXT}</p></main></body></html>"
    content = text.encode()

    def raise_for_status(self):
        return None


@pytest.fixture
def offline(monkeypatch):
    """Nothing leaves the process: LLM workers aren't launched, pages aren't fetched, PDFs aren't rendered."""
    from backend import main
    from backend.api import routes_applications, routes_cover_letters, routes_jobs

    def no_launch(*args, **kwargs):
        return "isolation-run"

    async def no_fetch(*args, **kwargs):
        return None

    async def page(*args, **kwargs):
        return _Response()

    async def browser():
        return _Browser()

    for module in (main, routes_cover_letters, routes_jobs):
        monkeypatch.setattr(module, "launch_background", no_launch)
    monkeypatch.setattr(routes_applications, "_cache_job_page", no_fetch)
    monkeypatch.setattr(routes_applications, "_fetch_and_store_description", no_fetch)
    monkeypatch.setattr(routes_applications, "_fetch_with_playwright", page)
    monkeypatch.setattr("backend.analyzer.h1b_checker.fetch_h1b_for_company_id", no_fetch)
    monkeypatch.setattr("backend.scraper._shared.url_safety.safe_get", page)
    monkeypatch.setattr("backend.scraper._shared.url_safety.assert_public_http_url", lambda *args, **kwargs: None)
    if hasattr(routes_cover_letters, "_get_browser"):
        monkeypatch.setattr(routes_cover_letters, "_get_browser", browser)
    # The new-candidate parser (onboarding 06 PR 3): no text extraction, no model.
    from backend.api import routes_candidates
    from backend.candidates.base_resume import clean_reply

    async def read_resume(text, kind, db, firm_id=None):
        return clean_reply({"header": {"name": "Isolation Reader"}})

    monkeypatch.setattr(routes_candidates, "extract_text", lambda kind, content: "isolation résumé text")
    monkeypatch.setattr(routes_candidates, "read_resume", read_resume)

    # Provider I/O is synthetic in F7; Google and mailbox secrets are never contacted.
    from backend import config
    monkeypatch.setattr(config, 'CANDIDATE_EMAIL_CLASSIFICATION_ENABLED', True)
    monkeypatch.setattr(config, 'CANDIDATE_EMAIL_REAL_MAIL_APPROVED', True)
    monkeypatch.setattr('backend.inbox.classification_worker.wake_worker', lambda: None)
    from backend.api import routes_inbox
    from backend.inbox.google_oauth import Authorization
    monkeypatch.setattr(routes_inbox, "build_authorization", lambda: Authorization(
        "https://accounts.google.com/test", "synthetic-state-" + uuid.uuid4().hex, "verifier", "challenge"))
    monkeypatch.setattr(routes_inbox, "encrypt_secret", lambda value: b"synthetic-test-ciphertext")
    monkeypatch.setattr(routes_inbox, "sync_mailbox", lambda *args, **kwargs: 0)
    monkeypatch.setattr(routes_inbox, "run_import", lambda *args, **kwargs: 0)
    monkeypatch.setattr(routes_inbox, "revoke_token", lambda *args, **kwargs: True)

    from backend.api import routes_candidate_resumes
    monkeypatch.setattr(routes_candidate_resumes, "extract_text", lambda kind, content: "isolation résumé text")
    monkeypatch.setattr(routes_candidate_resumes, "read_resume", read_resume)
