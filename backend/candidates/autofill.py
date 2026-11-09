"""A résumé version's autofill (decided 2026-11-07; built on read since Abdul's review, 2026-11-08; the contract is
docs/02 §8.1): every question an application form can ask, answered in two parts.

- **Fixed answers** are built by `build()` from the version and the candidate's profile when they're asked for. They
  aren't stored as answers, so they're never stale: a profile edit, or a new question added here, shows on every
  version at once. The one copy kept is an edit's `over`, below.
- **The user's entries** are stored in `resumes.autofill` (`{}` by default):
  `{"edited": {key: {"answer": …, "over": …}}, "custom": {question: answer}}`. An edit is kept by its question's key,
  so rewording a question here never loses it, with `over`: a copy of the built answer it replaced (for a list such
  as the work history, the whole list). It applies while that is still the built answer: once the version's own text
  or the profile changes it, the new built answer shows. A save and a promote copy the entries, as tailoring will
  (docs/02 §8.1); on the new version an edit applies only where its built answer is still `over`.

`merged()` is what `GET …/resumes/{id}?autofill=true` returns: every question once, with its `kind` (FIXED; EDITED,
with `built`, the answer reset gives back; CUSTOM) and, for a question built here, its `key`: a fixed name for what it
asks (`address-city`, `work-auth-status`…), so a reader such as the extension can match it whatever its wording.
Answers keep their JSON type: 10, true/false, a list, a date as "YYYY-MM-DD".

- **From the version:** the header (name, contact, location, title), the summary, skills, every job with its dates
  and bullets (the current one: marked current, else the one that ended last), every education (the highest degree,
  with its own school and year), projects, awards, certifications and languages. A tailored version answers from its
  own text.
- **From the candidate:** the profile facts the owner and the candidate's manager keep (07 Q56): work authorization
  (the profile's status: every candidate has one), its expiry, sponsorship, transfer, the target rate, availability,
  notice period, relocation, engagement types, work settings, preferred locations and industries, primary and target
  roles.
- **Years of experience:** worked out from the version's own jobs for today (`years_from_work`, the rule the New
  candidate form uses, src/lib/api/dto/resume-parse.ts `yearsFromWork`), else the candidate's `years_experience`.

Never in it: ids (candidate, firm, BDE, manager, base, job), and what is the firm's own: the floor rate (`rate_min`),
the notes for the BDE (`contact_notes`), `deal_breakers`, `status`, `bench_start_date`. A fact that is missing leaves
its question out (no empty answers).
"""
import json
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
# How build() writes an answer is part of every edit stored over it: an edit applies only while its `over` is the
# built answer, so changing how one is written (a label in WORK_AUTH_LABEL, a field of the work-history entries, the
# date format) ends every edit of that question, on every version, once it's deployed. To keep them, the same change
# rewrites the stored `over` values (a migration).
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

# A month is 01–12: "2024-00" or "2024-13" isn't one (src/lib/api/dto/resume-parse.ts `monthIndex`, in step).
_MONTH = re.compile(r"^(\d{4})(?:-(0[1-9]|1[0-2]))?$")
_YEAR = re.compile(r"\d{4}")
# Degree levels, 5 a doctorate down to 1 school, by the word or code that names them, read without dots ("M.S." is
# "ms", "B.Tech." is "btech"); a few two-word names are read as one word first.
_LEVEL_OF = {
    **dict.fromkeys(("phd", "dphil", "edd", "md"), 5),
    **dict.fromkeys(("master", "masters", "ms", "msc", "mtech", "me", "meng", "mba", "mca", "mcom", "ma", "mfa", "mph",
                     "pgdm", "pgdiploma", "postgraduate"), 4),
    **dict.fromkeys(("bachelor", "bachelors", "bs", "bsc", "btech", "be", "beng", "bca", "bba", "bcom", "ba",
                     "undergraduate"), 3),
    **dict.fromkeys(("associate", "associates"), 2),
    **dict.fromkeys(("highschool", "secondary", "diploma", "12th", "10th", "hsc", "ssc", "intermediate", "ged"), 1),
}
_TWO_WORDS = ((r"ph d", "phd"), (r"m sc", "msc"), (r"b sc", "bsc"), (r"m tech", "mtech"), (r"b tech", "btech"),
              (r"pg diploma", "pgdiploma"), (r"post graduate", "postgraduate"), (r"high school", "highschool"))
# Codes that are also everyday words or branch names ("to be completed", "B.Tech in ME"): they name a degree only at
# its start, which can follow words such as these, or a number ("Integrated MS", "Dual Degree (BS-MS)", "Five Year
# Integrated MS").
_SHORT_CODES = {"ms", "me", "ma", "md", "bs", "be", "ba"}
_BEFORE_A_CODE = {"integrated", "dual", "degree", "five", "year", "years"}


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


def _is_job(job: Mapping) -> bool:
    """A row is a job when it names a company or a title: one with only a location, dates or bullets isn't."""
    return bool(text(job.get("company")) or text(job.get("job_title")))


def _latest_job(jobs: list[dict]) -> dict:
    """The current or most recent job: the one marked current (the latest started, if several), else the one that
    ended last, else the first listed. A résumé's order doesn't say: a tailored version can put an older role first."""
    def month(job, field):
        index = _month_index(job.get(field))
        return -1 if index is None else index
    jobs = [job for job in jobs if _is_job(job)]
    current = [job for job in jobs if job.get("current")]
    if current:
        return max(current, key=lambda job: month(job, "start"))
    ended = [job for job in jobs if _month_index(job.get("end")) is not None]
    return max(ended, key=lambda job: month(job, "end")) if ended else (jobs[0] if jobs else {})


def _everyday(word: str) -> bool:
    """A degree's word that is also an everyday one: "Scrum Master", "Pre-Doctoral Research Fellow"."""
    return word == "master" or word.startswith("doctor")


def _level(degree: str) -> int:
    """How high a degree is: 5 for a doctorate down to 1 for school, 0 when it names none. The highest level it names
    counts, in whatever order ("Dual Degree (B.Tech + M.Tech)" is a master's, as "B.Tech + M.Tech" is). Every level a
    degree starts with counts: "BE/ME dual degree", "Dual Degree (BS-MS)" and "Integrated MS" are master's. After
    them, a two-letter code doesn't ("B.Tech in ME" is a bachelor's, and "Coursework, to be completed" no degree), and
    "master" or a "doctor" word counts only before "of" or "in" ("Bachelor of Technology and Master of Technology" is a
    master's, and "Certified Scrum Master" no degree)."""
    words = re.sub(r"[^a-z0-9]+", " ", re.sub(r"[.'’]", "", degree.lower()))
    for pair, word in _TWO_WORDS:
        words = re.sub(rf"\b{pair}\b", word, words)
    def level(word):
        return 5 if word.startswith("doctor") else _LEVEL_OF.get(word, 0)
    tokens = words.split()
    while tokens and (tokens[0] in _BEFORE_A_CODE or tokens[0].isdigit()):
        tokens = tokens[1:]
    levels, leading = [], True
    for word, following in zip(tokens, [*tokens[1:], ""]):
        named = level(word)
        leading = leading and bool(named)
        if leading or (named and word not in _SHORT_CODES and (not _everyday(word) or following in ("of", "in"))):
            levels.append(named)
    return max(levels, default=0)


def _is_certificate(degree: str) -> bool:
    """A certificate, not a degree ("Certified Scrum Master", "Master Data Management Certificate"): résumés often list
    them under education."""
    return any(word.startswith("certif") for word in re.findall(r"[a-z]+", degree.lower()))


def _highest_school(schools: list[dict]) -> dict:
    """The education with the highest degree, among the rows that name a degree or a school (a blank row is none) and
    aren't a certificate; the first listed when they're level or can't be told apart."""
    named = [school for school in schools if (text(school.get("degree")) or text(school.get("institution")))
             and not _is_certificate(text(school.get("degree")))]
    return max(named, key=lambda school: _level(text(school.get("degree"))), default={})


def _graduation_year(school: Mapping) -> int | None:
    """The year a degree ended: the last year written, so "2013 – 2017" is 2017."""
    years = _YEAR.findall(text(school.get("graduation_date")))
    return int(years[-1]) if years else None


def _work_authorization(candidate) -> str:
    """The profile's status, the one sponsorship and transfer come from. Every candidate has one: `work_auth` is
    required, with a check on its values."""
    code = text(_get(candidate, "work_auth"))
    return WORK_AUTH_LABEL.get(code, code)


def build(candidate, version, today: date | None = None) -> dict:
    """The fixed answers for one version of `candidate`, by question: plain mappings or ORM rows alike."""
    return {QUESTIONS[key]: answer for key, answer in _answers(candidate, version, today or date.today()).items()}


def _answers(candidate, version, today: date) -> dict:
    """The fixed answers by key, a missing fact left out."""
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
        "work-auth-status": _work_authorization(candidate),
        "skills": _texts(s.get("name") for s in dicts(v("skills"))),
        "current-company": text(latest.get("company")),
        "current-title": text(latest.get("job_title")),
        "work-history": _entries({
            "company": text(j.get("company")), "title": text(j.get("job_title")), "location": text(j.get("location")),
            "dates": text(j.get("dates")), "start": text(j.get("start")), "end": text(j.get("end")),
            "current": bool(j.get("current")), "bullets": _bullets(j)} for j in jobs if _is_job(j)),
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
    return {key: answer for key, answer in answers.items() if answer not in (None, "", [])}


def entries_of(version) -> dict:
    """The user's entries a version stores, as they're read and copied: `edited` by key, each with the built answer it
    replaced (`over`), and `custom` by question. Anything else stored is no entry: a value that isn't an object, the
    first 0019's `{question: answer}` (built answers, not typed ones), an edit without an answer, a blank question. A
    question in a fixed question's words stays (a question added or reworded here can take them after it was typed):
    `merged()` decides whether it shows. `{}` when none are left."""
    stored = _get(version, "autofill")
    if not isinstance(stored, Mapping):
        return {}
    edited, custom = stored.get("edited"), stored.get("custom")
    edits = {key: {"answer": edit["answer"], "over": edit.get("over")} for key, edit in edited.items()
             if isinstance(key, str) and isinstance(edit, Mapping) and "answer" in edit} if isinstance(edited, Mapping) else {}
    added = {question: answer for question, answer in custom.items()
             if isinstance(question, str) and question.strip()} if isinstance(custom, Mapping) else {}
    return {"edited": edits, "custom": added} if edits or added else {}


def _plain(value):
    """A value as `_same` reads it: a whole number as an int, as `_number` writes the built ones (85.0 is 85)."""
    if isinstance(value, bool):
        return value
    if isinstance(value, (float, Decimal)):
        return _number(value)
    if isinstance(value, Mapping):
        return {key: _plain(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_plain(item) for item in value]
    return value


def _same(left, right) -> bool:
    """The same JSON value: 85.0 is 85, but `true` isn't `1`, as Python's `==` would have it."""
    def dump(value):
        return json.dumps(_plain(value), sort_keys=True, default=str)
    return dump(left) == dump(right)


def merged(candidate, version, today: date | None = None) -> list[dict]:
    """Every question of one version once: the fixed ones in QUESTIONS order, each the user's edit while the answer it
    replaced is still the built one, then the questions the user added. Built for this read; nothing is written."""
    built = _answers(candidate, version, today or date.today())
    entries = entries_of(version)
    edits, added = entries.get("edited", {}), entries.get("custom", {})
    out = []
    for key, question in QUESTIONS.items():
        answer, edit = built.get(key), edits.get(key)
        if edit is not None and _same(edit["over"], answer):
            out.append({"question": question, "answer": edit["answer"], "kind": EDITED, "key": key, "built": answer})
        elif answer is not None:
            out.append({"question": question, "answer": answer, "kind": FIXED, "key": key})
    # A question the user added in words a fixed question took later shows only while that one has no answer: each
    # question once.
    shown = {entry["question"] for entry in out}
    out.extend({"question": question, "answer": answer, "kind": CUSTOM}
               for question, answer in added.items() if question not in shown)
    return out
