"""A résumé version for tests (docs/team/resume-versioning.md §3.3): since 0013 every `resumes` row belongs to a
candidate and a base, so a test that needs "a résumé" makes one here instead of a bare row."""
import re
import uuid

from backend.models.candidates import BaseResume, Candidate
from backend.models.db import Resume
from backend.models.tenancy import User


def make_version(db, firm_id, *, candidate=None, candidate_name=None, category="BASE", job_id=None, version=1,
                 name="Base", active=True, id=None, **content) -> Resume:
    """A version on a base of `candidate` (a new candidate, with a manager of its own, when none is given). `content`
    fills the columns (`summary`, `experiences`, …); a TAILORED version needs `job_id`. Flushed, not committed."""
    if candidate is None:
        manager = User(firm_id=firm_id, role="MANAGER", name="Test manager",
                       email=f"manager-{uuid.uuid4().hex[:8]}@example.test", password_hash="x")
        db.add(manager)
        db.flush()
        candidate = Candidate(firm_id=firm_id, manager_id=manager.id, created_by_user_id=manager.id,
                              full_name=candidate_name or content.get("full_name") or "Test candidate",
                              work_auth="H1B")
        db.add(candidate)
        db.flush()
    base = db.query(BaseResume).filter(BaseResume.candidate_id == candidate.id, BaseResume.is_active).first()
    if base is None or not active:
        base = BaseResume(firm_id=firm_id, candidate_id=candidate.id, source="PROMOTED", is_active=active,
                          created_by_user_id=candidate.created_by_user_id)
        db.add(base)
        db.flush()
    # The candidate's name lives in the résumé (07 Q57): a test that names the candidate names the résumé.
    if candidate_name:
        content = {**content, "full_name": candidate_name}
    row = Resume(firm_id=firm_id, candidate_id=candidate.id, base_resume_id=base.id, category=category,
                 job_id=job_id, version=version, name=name, created_by_user_id=candidate.created_by_user_id,
                 **({"id": id} if id is not None else {}), **content)
    db.add(row)
    db.flush()
    return row


# Test-only: some older tests describe a résumé in JobNavigator's JSON shape. This maps it into the version columns
# so they can keep their fixtures; nothing in the app or in migration 0013 reads that shape (0013 deletes old rows).
def _id() -> str:
    return str(uuid.uuid4())


def _t(value) -> str:
    return str(value or "").strip()


def _split(value) -> list:
    """A skills line into its items, ignoring commas inside brackets (as base_resume._split_skills)."""
    if isinstance(value, list):
        return [_t(v) for v in value if _t(v)]
    items, depth, current = [], 0, []
    for ch in str(value or ""):
        depth += ch in "([{"
        depth -= ch in ")]}" and depth > 0
        if ch == "," and depth == 0:
            items.append("".join(current).strip())
            current = []
        else:
            current.append(ch)
    items.append("".join(current).strip())
    return [i for i in items if i]


def _contact(header: dict) -> dict:
    out = {"email": _t(header.get("email")), "phone": _t(header.get("phone")), "linkedin": _t(header.get("linkedin")),
           "github": _t(header.get("github")), "location": _t(header.get("location"))}
    for item in header.get("contact_items") or []:
        text, url = (_t(item.get("text")), _t(item.get("url"))) if isinstance(item, dict) else (_t(item), "")
        both = f"{text} {url}".lower()
        if "@" in text or url.startswith("mailto:"):
            out["email"] = out["email"] or text or url.removeprefix("mailto:")
        elif "linkedin" in both:
            out["linkedin"] = out["linkedin"] or url or text
        elif "github" in both:
            out["github"] = out["github"] or url or text
        elif re.fullmatch(r"\+?[\d\s().-]{7,}", text):
            out["phone"] = out["phone"] or text
        elif text and not url:
            out["location"] = out["location"] or text
    return out


def _bullets(item: dict) -> list:
    texts = [_t(item.get("description"))] + [_t(b) for b in item.get("bullets") or [] if not isinstance(b, dict)]
    return [{"id": _id(), "text": t} for t in texts if t]


def columns_from_json(data: dict) -> dict:
    data = data if isinstance(data, dict) else {}
    header = data.get("header") if isinstance(data.get("header"), dict) else {}
    contact = _contact(header)
    city, _, state = contact["location"].partition(",")
    skills = data.get("skills") or {}
    pairs = skills.items() if isinstance(skills, dict) else [("", skills)]
    entries = lambda key: [{"id": _id(), "name": _t(e.get("name") if isinstance(e, dict) else e),
                            "issuer": _t(e.get("issuer")) if isinstance(e, dict) else "",
                            "date": _t(e.get("date")) if isinstance(e, dict) else "",
                            "detail": _t(e.get("detail") or e.get("description")) if isinstance(e, dict) else ""}
                           for e in data.get(key) or [] if _t(e.get("name") if isinstance(e, dict) else e)]
    dicts = lambda key: [e for e in data.get(key) or [] if isinstance(e, dict)]
    return {
        "full_name": _t(header.get("name")) or None, "title": _t(header.get("title")) or None,
        "city": city.strip() or None, "state": state.strip() or None, "country": None,
        "email": contact["email"] or None, "phone": contact["phone"] or None,
        "linkedin": contact["linkedin"] or None, "github": contact["github"] or None, "work_authorization": None,
        "summary": _t(data.get("summary")) or None,
        "summary_id": _id() if _t(data.get("summary")) else None,        # the summary is an item too (0011, §3.4)
        "skills": [{"id": _id(), "category": _t(category), "name": name} for category, line in pairs
                   for name in _split(line)],
        "experiences": [{"id": _id(), "job_title": _t(e.get("title")), "company": _t(e.get("company")),
                         "location": _t(e.get("location")), "dates": _t(e.get("date") or e.get("dates")),
                         "start": "", "end": "", "current": "present" in _t(e.get("date") or e.get("dates")).lower(),
                         "bullets": _bullets(e)} for e in dicts("experience")],
        "projects": [{"id": _id(), "name": _t(p.get("name") or p.get("title")), "url": _t(p.get("url")), "dates": "",
                      "technologies": "", "bullets": _bullets(p)} for p in dicts("projects")],
        "educations": [{"id": _id(), "degree": _t(e.get("degree")), "institution": _t(e.get("school")),
                        "graduation_date": _t(e.get("years") or e.get("year") or e.get("date")), "grade": ""}
                       for e in dicts("education")],
        "certifications": entries("certifications"), "awards": entries("awards"), "languages": [],
    }


def old_resume(db, firm_id, name, json_data=None, *, is_base=True, job_id=None, **kw) -> Resume:
    """A test's old-style résumé (a name and JobNavigator's json_data) as a version: a base's v1, or a tailored
    résumé for `job_id`, of a new candidate called `name` (scoring labels a base with its candidate's name)."""
    return make_version(db, firm_id, name=name, candidate_name=name, category="BASE" if is_base else "TAILORED",
                        job_id=job_id, **columns_from_json(json_data or {}), **kw)


def make_posting(db, firm_id, candidate_id, user_id, n=0, title="Dev"):
    """A job posting of the candidate's (job search, migration 0023): what a tailored résumé or a cover letter names.
    Its own finished capture batch, made-up content. Flushed, not committed."""
    import hashlib
    from backend.models.db import utcnow
    from backend.models.job_search import JobPosting, ScrapeJob
    batch = ScrapeJob(firm_id=firm_id, candidate_id=candidate_id, user_id=user_id, batch_id=uuid.uuid4(),
                      kind="capture", state="success", finished_at=utcnow(), meta={"request": {"source": "manual"}})
    db.add(batch)
    db.flush()
    posting = JobPosting(firm_id=firm_id, candidate_id=candidate_id, batch_id=batch.batch_id, source="manual",
                         job_id=hashlib.sha256(f"{candidate_id}-{n}-{uuid.uuid4()}".encode()).hexdigest(),
                         content={"title": f"{title} {n}", "company": "Acme", "description": f"Made-up job {n}.",
                                  "url": f"https://jobs.example.test/{n}"})
    db.add(posting)
    db.flush()
    return posting


def make_target_posting(db, id=None):
    """A job posting with that id, of a new candidate in the Default firm: what `job_runs.target_job_id` and
    `llm_call_log.job_id` name since migration 0023. Committed."""
    from backend.models.candidates import Candidate
    from backend.tests.firm_support import default_firm_id
    firm_id = default_firm_id(db)
    manager = User(firm_id=firm_id, role="MANAGER", name="Test manager",
                   email=f"manager-{uuid.uuid4().hex[:8]}@example.test", password_hash="x")
    db.add(manager)
    db.flush()
    candidate = Candidate(firm_id=firm_id, manager_id=manager.id, created_by_user_id=manager.id, work_auth="H1B")
    db.add(candidate)
    db.flush()
    posting = make_posting(db, firm_id, candidate.id, manager.id)
    if id is not None:
        posting.id = id
    db.commit()
    return posting
