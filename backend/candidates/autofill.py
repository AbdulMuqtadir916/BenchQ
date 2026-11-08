"""A résumé version's autofill (decided 2026-11-07; built on read since Abdul's review, 2026-11-08; the contract is
docs/02 §8.1): every question an application form can ask, answered in two parts.

- **Fixed answers** are built by `build()` from the version and the candidate's profile when they're asked for. They
  aren't stored, so they're never stale: a profile edit, or a new question added here, shows on every version at once.
- **The user's entries** are stored in `resumes.autofill` (`{question: answer}`, `{}` by default): only what a person
  typed, an edit to a fixed answer or a question they added. A save and a promote copy them to the new version.

`merged()` is what `GET …/resumes/{id}?autofill=true` returns: every question once, the user's entry winning, with
its `kind` (FIXED; EDITED, with `built`, the answer reset gives back; CUSTOM) and, for a question built here, its
`key`: a fixed name for what it asks (`address-city`, `work-auth-status`…), so a reader such as the extension can
match it whatever its wording. Answers keep their JSON type: 10, true/false, a list, a date as "YYYY-MM-DD".

- **From the version:** the header (name, contact, location, title), the summary, skills, every job with its dates
  and bullets (the current one: marked current, else the one that ended last), every education (the highest degree,
  with its own school and year), projects, awards, certifications and languages. A tailored version answers from its
  own text.
- **From the candidate:** the profile facts the owner and the candidate's manager keep (07 Q56): work authorization
  (the résumé's text only when the profile has none), its expiry, sponsorship, transfer, the target rate,
  availability, notice period, relocation, engagement types, work settings, preferred locations and industries,
  primary and target roles.
- **Years of experience:** worked out from the version's own jobs for today (`years_from_work`, the rule the New
  candidate form uses, src/lib/api/dto/resume-parse.ts `yearsFromWork`), else the candidate's `years_experience`.

Never in it: ids (candidate, firm, BDE, manager, base, job), and what is the firm's own: the floor rate (`rate_min`),
the notes for the BDE (`contact_notes`), `deal_breakers`, `status`, `bench_start_date`. A fact that is missing leaves
its question out (no empty answers).
"""
import re
from collections.abc import Mapping
from datetime import date, datetime, timezone
from decimal import Decimal

from backend.candidates.first_base import WORK_AUTH_LABEL
from backend.candidates.values import dicts, text

# The app's labels for the stored codes (src/lib/constants/work-auth.ts, submission-facts.tsx EMPLOYMENT_LABEL).
EMPLOYMENT_LABEL = {"C2C": "C2C", "W2": "W2", "TEEN99": "1099", "FTE": "Full-time"}
WORK_SETTING_LABEL = {"REMOTE": "Remote", "HYBRID": "Hybrid", "ONSITE": "On-site"}

FIXED, EDITED, CUSTOM = "FIXED", "EDITED", "CUSTOM"

# Every question build() answers, in order, by its key: what it asks, named once, so a reader doesn't depend on the
# wording. A new question goes here with a new key.
QUESTIONS: dict[str, str] = {
    "full-name": "What is your full name?",
    "email": "What is your email address?",
    "phone": "What is your phone number?",
    "linkedin-url": "What is your LinkedIn profile URL?",
    "github-url": "What is your GitHub profile URL?",
    "address-city": "Which city do you live in?",
    "address-region": "Which state do you live in?",
    "address-country": "Which country do you live in?",
    "professional-title": "What is your professional title?",
    "summary": "Give a short professional summary.",
    "work-auth-status": "What is your work authorization?",
    "skills": "What are your skills?",
    "current-company": "Who is your current or most recent employer?",
    "current-title": "What is your current or most recent job title?",
    "work-history": "List your work experience.",
    "education-degree": "What is your highest degree?",
    "education-school": "Which school did you attend?",
    "graduation-year": "What year did you graduate?",
    "education-history": "List your education.",
    "projects": "List your projects.",
    "awards": "Which awards have you received?",
    "certifications": "Which certifications do you have?",
    "languages": "Which languages do you speak?",
    "work-auth-expiry": "When does your work authorization expire?",
    "visa-sponsorship": "Will you now or in the future require visa sponsorship?",
    "visa-transfer": "Do you need a visa transfer?",
    "years-experience": "How many years of experience do you have?",
    "primary-role": "What is your primary role?",
    "target-roles": "What roles are you looking for?",
    "pay-rate": "What is your expected rate?",
    "start-date": "When can you start?",
    "notice-period-days": "What is your notice period in days?",
    "relocation-willing": "Are you willing to relocate?",
    "employment-types": "Which employment types are you open to?",
    "work-settings": "Do you prefer remote, hybrid or on-site work?",
    "preferred-locations": "Which locations do you prefer?",
    "preferred-industries": "Which industries do you prefer?",
}
YEARS = QUESTIONS["years-experience"]
KEY_OF = {question: key for key, question in QUESTIONS.items()}

# A month is 01–12: "2024-00" or "2024-13" isn't one (src/lib/api/dto/resume-parse.ts `monthIndex`, in step).
_MONTH = re.compile(r"^(\d{4})(?:-(0[1-9]|1[0-2]))?$")
_YEAR = re.compile(r"\d{4}")
# Degree levels, highest first, read from the degree without its dots ("M.S." is "ms", "B.Tech." is "btech").
_LEVELS = (
    re.compile(r"\b(phd|ph d|doctor\w*|dphil|edd|md)\b"),
    re.compile(r"\b(masters?|ms|msc|m sc|mtech|m tech|me|meng|mba|mca|mcom|ma|mfa|mph|pgdm|pg diploma|"
               r"post ?graduate)\b"),
    re.compile(r"\b(bachelors?|bs|bsc|b sc|btech|b tech|be|beng|bca|bba|bcom|ba|undergraduate)\b"),
    re.compile(r"\bassociates?\b"),
    re.compile(r"\b(high school|secondary|diploma|12th|10th|hsc|ssc|intermediate|ged)\b"),
)


def _get(source, key):
    return source.get(key) if isinstance(source, Mapping) else getattr(source, key, None)


def _number(value):
    """A stored number as JSON: 9 for 9.0, 7.5 stays 7.5."""
    if value is None:
        return None
    number = float(value) if isinstance(value, Decimal) else value
    return int(number) if isinstance(number, float) and number.is_integer() else number


def _day(value) -> str | None:
    """A stored date as "YYYY-MM-DD". A moment is taken in UTC: the wizard sends midnight UTC, which a US session
    timezone would otherwise turn into the day before."""
    if isinstance(value, datetime):
        return (value.astimezone(timezone.utc) if value.tzinfo else value).date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return text(value)[:10] or None


def _texts(values) -> list[str]:
    return [text(v) for v in values or [] if text(v)]


def _bullets(item: Mapping) -> list[str]:
    texts = (text(b.get("text") if isinstance(b, Mapping) else b) for b in item.get("bullets") or [])
    return [t for t in texts if t]


def _entries(rows) -> list[dict]:
    """Rows without their empty fields, and without a row that has nothing left but its `current` flag."""
    cleaned = ({k: v for k, v in row.items() if v not in (None, "", [])} for row in rows)
    return [row for row in cleaned if any(k != "current" for k in row)]


def _month_index(value) -> int | None:
    match = _MONTH.match(text(value))
    if not match:
        return None
    return int(match[1]) * 12 + (int(match[2]) - 1 if match[2] else 0)


def years_from_work(jobs, today: date) -> int | None:
    """Whole years of experience from the work history: the months covered by every job, overlaps counted once, a
    current job up to this month, rounded down. A job with no start is skipped. None when nothing can be counted.
    The same rule as src/lib/api/dto/resume-parse.ts `yearsFromWork` (test_autofill.py checks they agree)."""
    this_month = today.year * 12 + today.month - 1
    spans = []
    for job in dicts(jobs):
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


def _latest_job(jobs: list[dict]) -> dict:
    """The current or most recent job: the one marked current (the latest started, if several), else the one that
    ended last, else the first listed. A résumé's order doesn't say: a tailored version can put an older role first.
    A row with neither a company nor a title isn't a job."""
    def month(job, field):
        index = _month_index(job.get(field))
        return -1 if index is None else index
    jobs = [job for job in jobs if text(job.get("company")) or text(job.get("job_title"))]
    current = [job for job in jobs if job.get("current")]
    if current:
        return max(current, key=lambda job: month(job, "start"))
    ended = [job for job in jobs if _month_index(job.get("end")) is not None]
    return max(ended, key=lambda job: month(job, "end")) if ended else (jobs[0] if jobs else {})


def _level(degree: str) -> int:
    """How high a degree is, from the first level it names ("B.Tech in ME" is a bachelor's, whatever ME stands for):
    5 for a doctorate down to 1 for school, 0 when it names none."""
    words = re.sub(r"[^a-z0-9]+", " ", re.sub(r"[.'’]", "", degree.lower()))
    found = [(match.start(), len(_LEVELS) - rank) for rank, pattern in enumerate(_LEVELS)
             if (match := pattern.search(words))]
    return min(found)[1] if found else 0


def _highest_school(schools: list[dict]) -> dict:
    """The education with the highest degree; the first listed when they're level or can't be told apart."""
    return max(schools, key=lambda school: _level(text(school.get("degree"))), default={})


def _graduation_year(school: Mapping) -> int | None:
    """The year a degree ended: the last year written, so "2013 – 2017" is 2017."""
    years = _YEAR.findall(text(school.get("graduation_date")))
    return int(years[-1]) if years else None


def _work_authorization(candidate, version) -> str:
    """The profile's status, the same one sponsorship and transfer come from; the résumé's text only without one."""
    code = text(_get(candidate, "work_auth"))
    return WORK_AUTH_LABEL.get(code, code) if code else text(_get(version, "work_authorization"))


def build(candidate, version, today: date | None = None) -> dict:
    """The fixed answers for one version of `candidate`, by question: plain mappings or ORM rows alike."""
    today = today or date.today()
    v = lambda key: _get(version, key)            # noqa: E731
    c = lambda key: _get(candidate, key)          # noqa: E731
    jobs = dicts(v("experiences"))
    schools = dicts(v("educations"))
    latest = _latest_job(jobs)
    school = _highest_school(schools)

    answers = {
        # The résumé (this version's own text).
        "full-name": text(v("full_name")),
        "email": text(v("email")),
        "phone": text(v("phone")),
        "linkedin-url": text(v("linkedin")),
        "github-url": text(v("github")),
        "address-city": text(v("city")),
        "address-region": text(v("state")),
        "address-country": text(v("country")),
        "professional-title": text(v("title")),
        "summary": text(v("summary")),
        "work-auth-status": _work_authorization(candidate, version),
        "skills": _texts(s.get("name") for s in dicts(v("skills"))),
        "current-company": text(latest.get("company")),
        "current-title": text(latest.get("job_title")),
        "work-history": _entries({
            "company": text(j.get("company")), "title": text(j.get("job_title")), "location": text(j.get("location")),
            "dates": text(j.get("dates")), "start": text(j.get("start")), "end": text(j.get("end")),
            "current": bool(j.get("current")), "bullets": _bullets(j)} for j in jobs),
        "education-degree": text(school.get("degree")),
        "education-school": text(school.get("institution")),
        "graduation-year": _graduation_year(school),
        "education-history": _entries({
            "degree": text(e.get("degree")), "school": text(e.get("institution")),
            "graduation_date": text(e.get("graduation_date")), "grade": text(e.get("grade"))} for e in schools),
        "projects": _entries({
            "name": text(p.get("name")), "url": text(p.get("url")), "dates": text(p.get("dates")),
            "technologies": text(p.get("technologies")), "bullets": _bullets(p)} for p in dicts(v("projects"))),
        "awards": _entries({
            "name": text(a.get("name")), "issuer": text(a.get("issuer")), "date": text(a.get("date")),
            "detail": text(a.get("detail"))} for a in dicts(v("awards"))),
        "certifications": _texts(x.get("name") for x in dicts(v("certifications"))),
        "languages": _texts(x.get("name") for x in dicts(v("languages"))),
        # The candidate's profile (the owner's and the manager's, 07 Q56).
        "work-auth-expiry": _day(c("work_auth_expiry")),
        "visa-sponsorship": c("needs_sponsorship"),
        "visa-transfer": c("needs_transfer"),
        "years-experience": _years(version, candidate, today),
        "primary-role": text(c("primary_role")),
        "target-roles": _texts(c("target_roles")),
        "pay-rate": _number(c("rate_target")),
        "start-date": _day(c("available_from")),
        "notice-period-days": c("notice_period_days"),
        "relocation-willing": c("willing_to_relocate"),
        "employment-types": [EMPLOYMENT_LABEL.get(t, t) for t in c("employment_types") or []],
        "work-settings": [WORK_SETTING_LABEL.get(s, s) for s in c("work_settings") or []],
        "preferred-locations": _texts(c("preferred_locations")),
        "preferred-industries": _texts(c("preferred_industries")),
    }
    return {QUESTIONS[key]: answer for key, answer in answers.items() if answer not in (None, "", [])}


def merged(candidate, version, today: date | None = None) -> list[dict]:
    """Every question of one version once: the fixed ones in build() order, each the user's entry if they edited it,
    then the questions the user added. Built for this read; nothing is written."""
    built = build(candidate, version, today)
    entries = dict(_get(version, "autofill") or {})
    out = []
    for question, key in KEY_OF.items():
        if question in entries:
            out.append({"question": question, "answer": entries.pop(question), "kind": EDITED, "key": key,
                        "built": built.get(question)})
        elif question in built:
            out.append({"question": question, "answer": built[question], "kind": FIXED, "key": key})
    out.extend({"question": question, "answer": answer, "kind": CUSTOM} for question, answer in entries.items())
    return out
