"""A résumé version's autofill: every non-id fact about the candidate as `{question: answer}` (decided 2026-11-07).

Each `resumes` row (every version, tailored ones too) stores its own `autofill`, built from that version's content and
the candidate's profile. What the application forms and the extension read to fill a form:

- **From the version:** the header (name, contact, location, title, work authorization), the summary, skills, every
  job with its bullets, every education, projects, awards, certifications and languages. A tailored version answers
  from its own text.
- **From the candidate:** the profile facts the owner and the candidate's manager keep (07 Q56): sponsorship, transfer,
  the work authorization's expiry, the target rate, availability, notice period, relocation, engagement types, work
  settings, preferred locations and industries, primary and target roles.
- **Years of experience:** worked out from the version's own jobs (`years_from_work`, the rule the New candidate form
  uses, src/lib/api/dto/resume-parse.ts `yearsFromWork`), else the candidate's `years_experience`. A current job
  keeps counting, so reading one version works it out again for today (`for_reading`).

Never in it: ids (candidate, firm, BDE, manager, base, job), and what is the firm's own: the floor rate (`rate_min`),
the notes for the BDE (`contact_notes`), `deal_breakers`, `status`, `bench_start_date`. A fact that is missing leaves
its question out (no empty answers). Answers keep their JSON type: 10, true/false, a list, a date as "YYYY-MM-DD".

Written when a version is created (`first_base`, a save, a promote) and, for every version of the candidate, when
the profile is edited (`refresh_candidate`): the profile answers follow the profile, each version's résumé answers
stay its own. `build()` takes plain mappings, so migration 0019 fills existing rows with the same code.
"""
import re
from collections.abc import Mapping
from datetime import date, datetime
from decimal import Decimal

# The app's labels for the stored codes (src/lib/constants/work-auth.ts, submission-facts.tsx EMPLOYMENT_LABEL).
EMPLOYMENT_LABEL = {"C2C": "C2C", "W2": "W2", "TEEN99": "1099", "FTE": "Full-time"}
WORK_SETTING_LABEL = {"REMOTE": "Remote", "HYBRID": "Hybrid", "ONSITE": "On-site"}

YEARS = "How many years of experience do you have?"

# The version's columns build() reads, and the candidate's (only these: nothing else reaches a form).
VERSION_FIELDS = ("full_name", "email", "phone", "linkedin", "github", "city", "state", "country", "title", "summary",
                  "work_authorization", "skills", "experiences", "educations", "projects", "awards", "certifications",
                  "languages")
CANDIDATE_FIELDS = ("work_auth_expiry", "needs_sponsorship", "needs_transfer", "years_experience", "primary_role",
                    "target_roles", "rate_target", "available_from", "notice_period_days", "willing_to_relocate",
                    "employment_types", "work_settings", "preferred_locations", "preferred_industries")


def _get(source, key):
    return source.get(key) if isinstance(source, Mapping) else getattr(source, key, None)


def _text(value) -> str:
    return str(value).strip() if value is not None else ""


def _number(value):
    """A stored number as JSON: 9 for 9.0, 7.5 stays 7.5."""
    if value is None:
        return None
    number = float(value) if isinstance(value, Decimal) else value
    return int(number) if isinstance(number, float) and number.is_integer() else number


def _day(value) -> str | None:
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    text = _text(value)
    return text[:10] or None


def _texts(values) -> list[str]:
    return [_text(v) for v in values or [] if _text(v)]


def _items(values) -> list[Mapping]:
    return [v for v in values or [] if isinstance(v, Mapping)]


def _bullets(item: Mapping) -> list[str]:
    return [_text(b.get("text") if isinstance(b, Mapping) else b) for b in item.get("bullets") or []
            if _text(b.get("text") if isinstance(b, Mapping) else b)]


def _clean(entry: dict) -> dict:
    """An entry without its empty fields."""
    return {k: v for k, v in entry.items() if v not in (None, "", [])}


_MONTH = re.compile(r"^(\d{4})(?:-(\d{2}))?$")


def _month_index(value) -> int | None:
    match = _MONTH.match(_text(value))
    if not match:
        return None
    return int(match[1]) * 12 + (int(match[2]) - 1 if match[2] else 0)


def years_from_work(jobs, today: date) -> int | None:
    """Whole years of experience from the work history: the months covered by every job, overlaps counted once, a
    current job up to this month, rounded down. A job with no start is skipped. None when nothing can be counted.
    The same rule as src/lib/api/dto/resume-parse.ts `yearsFromWork` (test_autofill.py checks they agree)."""
    this_month = today.year * 12 + today.month - 1
    spans = []
    for job in _items(jobs):
        start = _month_index(job.get("start"))
        end = this_month if job.get("current") else _month_index(job.get("end"))
        if start is not None and end is not None and end >= start:
            spans.append((start, end))
    if not spans:
        return None
    spans.sort()
    months = 0
    first, last = spans[0]
    for start, end in spans[1:]:
        if start <= last + 1:
            last = max(last, end)
        else:
            months += last - first + 1
            first, last = start, end
    months += last - first + 1
    return months // 12


def _years(version, candidate, today: date):
    worked = years_from_work(_get(version, "experiences"), today)
    return worked if worked is not None else _number(_get(candidate, "years_experience"))


def build(candidate, version, today: date | None = None) -> dict:
    """The autofill for one version of `candidate`: plain mappings or ORM rows alike."""
    today = today or date.today()
    v = lambda key: _get(version, key)            # noqa: E731
    c = lambda key: _get(candidate, key)          # noqa: E731
    jobs = _items(v("experiences"))
    schools = _items(v("educations"))
    latest = jobs[0] if jobs else {}                 # a résumé lists the newest job first
    school = schools[0] if schools else {}
    graduated = re.search(r"\d{4}", _text(school.get("graduation_date")))

    answers = {
        # The résumé (this version's own text).
        "What is your full name?": _text(v("full_name")),
        "What is your email address?": _text(v("email")),
        "What is your phone number?": _text(v("phone")),
        "What is your LinkedIn profile URL?": _text(v("linkedin")),
        "What is your GitHub profile URL?": _text(v("github")),
        "Which city do you live in?": _text(v("city")),
        "Which state do you live in?": _text(v("state")),
        "Which country do you live in?": _text(v("country")),
        "What is your professional title?": _text(v("title")),
        "Give a short professional summary.": _text(v("summary")),
        "What is your work authorization?": _text(v("work_authorization")),
        "What are your skills?": _texts(s.get("name") for s in _items(v("skills"))),
        "Who is your current or most recent employer?": _text(latest.get("company")),
        "What is your current or most recent job title?": _text(latest.get("job_title")),
        "List your work experience.": [_clean({
            "company": _text(j.get("company")), "title": _text(j.get("job_title")), "location": _text(j.get("location")),
            "start": _text(j.get("start")), "end": _text(j.get("end")), "current": bool(j.get("current")),
            "bullets": _bullets(j)}) for j in jobs],
        "What is your highest degree?": _text(school.get("degree")),
        "Which school did you attend?": _text(school.get("institution")),
        "What year did you graduate?": int(graduated[0]) if graduated else None,
        "List your education.": [_clean({
            "degree": _text(e.get("degree")), "school": _text(e.get("institution")),
            "graduation_date": _text(e.get("graduation_date")), "grade": _text(e.get("grade"))}) for e in schools],
        "List your projects.": [_clean({
            "name": _text(p.get("name")), "url": _text(p.get("url")), "dates": _text(p.get("dates")),
            "technologies": _text(p.get("technologies")), "bullets": _bullets(p)}) for p in _items(v("projects"))],
        "Which awards have you received?": [_clean({
            "name": _text(a.get("name")), "issuer": _text(a.get("issuer")), "date": _text(a.get("date")),
            "detail": _text(a.get("detail"))}) for a in _items(v("awards"))],
        "Which certifications do you have?": _texts(x.get("name") for x in _items(v("certifications"))),
        "Which languages do you speak?": _texts(x.get("name") for x in _items(v("languages"))),
        # The candidate's profile (the owner's and the manager's, 07 Q56).
        "When does your work authorization expire?": _day(c("work_auth_expiry")),
        "Will you now or in the future require visa sponsorship?": c("needs_sponsorship"),
        "Do you need a visa transfer?": c("needs_transfer"),
        YEARS: _years(version, candidate, today),
        "What is your primary role?": _text(c("primary_role")),
        "What roles are you looking for?": _texts(c("target_roles")),
        "What is your expected rate?": _number(c("rate_target")),
        "When can you start?": _day(c("available_from")),
        "What is your notice period in days?": c("notice_period_days"),
        "Are you willing to relocate?": c("willing_to_relocate"),
        "Which employment types are you open to?": [EMPLOYMENT_LABEL.get(t, t) for t in c("employment_types") or []],
        "Do you prefer remote, hybrid or on-site work?": [WORK_SETTING_LABEL.get(s, s) for s in c("work_settings") or []],
        "Which locations do you prefer?": _texts(c("preferred_locations")),
        "Which industries do you prefer?": _texts(c("preferred_industries")),
    }
    return {question: answer for question, answer in answers.items() if answer not in (None, "", [])}


def fill(candidate, row) -> None:
    """Write `row`'s autofill (a version being created)."""
    row.autofill = build(candidate, row)


def refresh_candidate(db, candidate) -> int:
    """The profile changed: rewrite the autofill of every version of `candidate` (deleted ones too, so a restored
    version is current). Returns how many rows were rewritten. The caller commits."""
    from backend.auth.scoping import scoped
    from backend.models.db import Resume
    rows = scoped(db, Resume, candidate.firm_id).filter(Resume.candidate_id == candidate.id).all()
    for row in rows:
        fill(candidate, row)
    return len(rows)


def for_reading(stored: dict | None, candidate, version, today: date | None = None) -> dict:
    """The stored autofill as one version is read: the years worked out again for today, since a current job keeps
    counting (decided 2026-11-07); every other answer as stored. Nothing is written."""
    out = dict(stored or {})
    years = _years(version, candidate, today or date.today())
    if years is None:
        out.pop(YEARS, None)
    else:
        out[YEARS] = years
    return out
