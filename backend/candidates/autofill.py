"""A résumé version's autofill (decided 2026-11-07; built on read since Abdul's review, 2026-11-08; the contract is
docs/02 §8.1): every question an application form can ask, answered in two parts.

- **Fixed answers** are built by `build()` from the version and the candidate's profile when they're asked for. They
  aren't stored as answers, so they're never stale: a profile edit, or a new question added here, shows on every
  version at once. The one copy kept is an edit's `over`, below.
- **The user's entries** are stored in `resumes.autofill` (`{}` by default): `{"edited": {key: {"answer": …, "over":
  …}}, "custom": [{"question": …, "also": [wording…], "answer": …}]}`. An edit is kept by its question's key, so
  rewording a question here never loses it, with `over`: a copy of the built answer it replaced. It applies while that
  is still the built answer: once the version's own text or the profile changes it, the new built answer shows, and
  the read marks the edit as `replaced` (07 Q15). The questions the user added are a list, oldest first (07 Q40), each
  with the other wordings it answers (`also`, Q41). A save and a promote copy the entries, as tailoring will (docs/02
  §8.1); on the new version an edit applies only where its built answer is still `over`. `change()` is how the
  Autofill screen's save writes them (`PATCH …/resumes/{id}/autofill`, docs/02 §8.3).

`merged()` is what `GET …/resumes/{id}?autofill=true` returns: every question once, with its `kind` (FIXED; EDITED,
with `built`, the answer reset gives back; CUSTOM, with `also`) and, for a question built here, its `key`: a fixed
name for what it asks (`address-city`, `work-auth-status`…), so a reader such as the extension can match it whatever
its wording. Answers keep their JSON type: 10, true/false, a list, a date as "YYYY-MM-DD". With `editor=true` (the
Autofill screen) it also lists the fixed questions with no answer, as null, and each keyed answer's `type`.

- **From the version:** the header (name, contact, location, title), the summary, skills, every job with its dates
  and bullets (the current one: marked current, else the one that ended last), every education (the highest degree,
  with its own school and year), projects, awards, certifications and languages. A tailored version answers from its
  own text.
- **From the candidate:** the profile facts the owner and the candidate's manager keep (07 Q56): work authorization
  (the profile's status: every candidate has one), its expiry, sponsorship, transfer, the target rate, availability,
  notice period, relocation, engagement types, work settings, preferred locations and industries, primary and target
  roles.
- **Self-identification** (gender, pronouns, race, Hispanic or Latino, veteran and disability status, sexual
  orientation, transgender): voluntary, and not in the profile, so never built. The Autofill screen lists them to
  answer, and the BDE adds the candidate's own answer to that version (an edit over no built answer).
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
    "education-field": "What did you study?",
    "education-school": "Which school did you attend?",
    "graduation-year": "What year did you graduate?",
    "education-grade": "What was your GPA?",
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
    # Personal and screening questions forms ask (decided 2026-11-11): the BDE adds the candidate's answer on the
    # Autofill screen, for that version. Only citizenship is built (the profile's status). Never a date of birth, an ID
    # or a password: the extension never fills those.
    "preferred-name": "What is your preferred name?",
    "middle-name": "What is your middle name?",
    "address-line1": "What is your street address?",
    "address-line2": "What is your apartment, suite or unit?",
    "address-postal": "What is your ZIP or postal code?",
    "portfolio-url": "What is your portfolio or personal website?",
    "citizenship": "Are you a US citizen?",
    "nationality": "What is your nationality?",
    "current-pay": "What is your current pay rate?",
    "salary-expectation": "What is your expected annual salary?",
    "onsite-work": "Are you willing to work on-site?",
    "willing-to-travel": "Are you willing to travel for work?",
    "commute": "Can you commute to the job's location?",
    "over-18": "Are you at least 18 years old?",
    "criminal-history": "Have you ever been convicted of a crime?",
    "background-check": "Are you willing to undergo a background check?",
    "drug-test": "Are you willing to take a drug test?",
    "security-clearance": "Do you hold an active security clearance?",
    "non-compete": "Are you bound by a non-compete agreement?",
    "government-work": "Have you ever worked for a government agency?",
    "relative-at-company": "Do you have relatives who work at the company?",
    "former-employee": "Have you worked for the company before?",
    "accommodations": "Do you need accommodations during the hiring process?",
    "essential-functions": "Can you perform the job's essential functions, with or without reasonable accommodation?",
    # Voluntary self-identification (decided 2026-11-11): the profile doesn't hold it, so it's never built; the BDE adds
    # the candidate's own answer on the Autofill screen, for that version. Never logged; the extension leaves these
    # answers out of the form saved with an application (docs/02 §8.1).
    "gender": "What is your gender?",
    "pronouns": "What are your pronouns?",
    "race": "What is your race or ethnicity?",
    "hispanic-latino": "Are you Hispanic or Latino?",
    "veteran-status": "What is your veteran status?",
    "disability-status": "Do you have a disability?",
    "sexual-orientation": "What is your sexual orientation?",
    "transgender": "Do you identify as transgender?",
}
YEARS = QUESTIONS["years-experience"]

# What each question's answer is, for the Autofill screen's editor and the save's check: text, texts (a list of short
# texts), number, boolean, date ("YYYY-MM-DD") or entries: a list of records, changed in the résumé itself and never
# edited here, since an edit's `over` would be a copy of the whole list (07 Q42).
ANSWER_TYPES: dict[str, str] = {
    "full-name": "text", "email": "text", "phone": "text", "linkedin-url": "text", "github-url": "text",
    "address-city": "text", "address-region": "text", "address-country": "text", "professional-title": "text",
    "summary": "text", "work-auth-status": "text", "skills": "texts", "current-company": "text", "current-title": "text",
    "work-history": "entries", "education-degree": "text", "education-field": "text", "education-school": "text",
    "graduation-year": "number", "education-grade": "text",
    "education-history": "entries", "projects": "entries", "awards": "entries", "certifications": "texts",
    "languages": "texts", "work-auth-expiry": "date", "visa-sponsorship": "boolean", "visa-transfer": "boolean",
    "years-experience": "number", "primary-role": "text", "target-roles": "texts", "pay-rate": "number",
    "start-date": "date", "notice-period-days": "number", "relocation-willing": "boolean", "employment-types": "texts",
    "work-settings": "texts", "preferred-locations": "texts", "preferred-industries": "texts",
    "preferred-name": "text", "middle-name": "text", "address-line1": "text", "address-line2": "text",
    "address-postal": "text", "portfolio-url": "text", "citizenship": "boolean", "nationality": "text",
    "current-pay": "text", "salary-expectation": "number", "onsite-work": "boolean", "willing-to-travel": "text",
    "commute": "boolean", "over-18": "boolean", "criminal-history": "boolean", "background-check": "boolean",
    "drug-test": "boolean", "security-clearance": "text", "non-compete": "boolean", "government-work": "boolean",
    "relative-at-company": "boolean", "former-employee": "boolean", "accommodations": "boolean",
    "essential-functions": "boolean",
    "gender": "text", "pronouns": "text", "race": "text", "hispanic-latino": "text", "veteran-status": "text",
    "disability-status": "text", "sexual-orientation": "text", "transgender": "text",
}
# Other wordings forms use for a fixed question that has no field type of its own, sent as its `also` on the
# extension's read (docs/02 §8.1), so the extension matches any of them as it does a saved question's. Wordings live
# here as data, not in the extension's tables (07 Q35).
ALSO: dict[str, list[str]] = {
    "visa-transfer": ["Do you need an H-1B transfer?", "Will you require an H1B visa transfer?",
                      "Do you require a visa transfer?"],
    "work-settings": ["Are you open to remote, hybrid or onsite work?", "Work arrangement preference",
                      "Preferred work setting", "Preferred work arrangement", "Work arrangement"],
    # Found unanswered by the question corpus (extension/src/autofill/question-corpus.test.ts, 2026-11-11).
    "languages": ["Languages", "Languages spoken", "What languages do you speak?"],
    "willing-to-travel": ["Willingness to travel", "Are you open to travel?"],
    "employment-types": ["Employment type", "What type of employment are you looking for?",
                         "Are you looking for full-time or contract roles?"],
    "preferred-industries": ["Preferred industry", "Which industries are you interested in?"],
    "preferred-locations": ["Which locations are you open to working in?"],
    "education-field": ["Field of study", "What is your field of study?", "Major", "What was your major?", "Area of study",
                        "Discipline", "Specialization", "Concentration"],
    "education-grade": ["GPA", "What is your GPA?", "Cumulative GPA", "Overall GPA", "Overall result (GPA)", "CGPA"],
}
# How much one version keeps (docs/02 §8.3): a question, a text answer, a list's items and each item, the questions
# the user adds.
MAX_QUESTION, MAX_ANSWER, MAX_ITEMS, MAX_ITEM, MAX_CUSTOM = 300, 4000, 100, 300, 200
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# A month is 01–12: "2024-00" or "2024-13" isn't one (src/lib/api/dto/resume-parse.ts `monthIndex`, in step).
_MONTH = re.compile(r"^(\d{4})(?:-(0[1-9]|1[0-2]))?$")
_YEAR = re.compile(r"\d{4}")
# Degree levels, 5 a doctorate down to 1 school, by the word or code that names them, read without dots ("M.S." is
# "ms", "B.Tech." is "btech"); a few two-word names are read as one word first.
_LEVEL_OF = {
    **dict.fromkeys(("phd", "dphil", "edd", "md", "pharmd"), 5),
    **dict.fromkeys(("master", "masters", "ms", "msc", "mtech", "me", "meng", "mba", "mca", "mcom", "ma", "mfa", "mph",
                     "mpharm", "mpharmacy", "pgdm", "pgdiploma", "postgraduate"), 4),
    **dict.fromkeys(("bachelor", "bachelors", "bs", "bsc", "btech", "be", "beng", "bca", "bba", "bcom", "ba",
                     "bpharm", "bpharmacy", "undergraduate"), 3),
    **dict.fromkeys(("associate", "associates"), 2),
    **dict.fromkeys(("highschool", "secondary", "diploma", "12th", "10th", "hsc", "ssc", "intermediate", "ged"), 1),
}
_TWO_WORDS = ((r"ph d", "phd"), (r"m sc", "msc"), (r"b sc", "bsc"), (r"m tech", "mtech"), (r"b tech", "btech"),
              (r"pg diploma", "pgdiploma"), (r"post graduate", "postgraduate"), (r"high school", "highschool"),
              (r"b pharm", "bpharm"), (r"m pharm", "mpharm"), (r"b pharmacy", "bpharmacy"), (r"m pharmacy", "mpharmacy"),
              (r"pharm d", "pharmd"))
# Codes that are also everyday words or branch names ("to be completed", "B.Tech in ME"): they name a degree only at
# its start, which can follow words such as these, or a number ("Integrated MS", "Dual Degree (BS-MS)", "Two Year MS").
_SHORT_CODES = {"ms", "me", "ma", "md", "bs", "be", "ba"}
_BEFORE_A_CODE = {"integrated", "dual", "degree", "year", "years", "one", "two", "three", "four", "five", "six"}
# Words that join the levels a degree starts with without ending them ("B.S. and M.S.").
_JOINERS = {"and", "plus"}
# A short master's code after another degree names one only after its own bachelor's code ("BE/ME", "BS-MS") or a
# joiner: anywhere else it's a branch ("B.Tech (ME)" is Mechanical).
_PAIRED = {"ms": "bs", "me": "be", "ma": "ba"}


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
    """A degree's word that is also an everyday one ("Scrum Master", "Master Trainer", "AWS Certified Developer –
    Associate", "Pre-Doctoral Fellow"): it names a degree only before "of", "in", "degree" or a degree's code ("Master
    (MS)"). "Doctorate", "Master's" and "Associate's" always name one."""
    return word in ("master", "associate") or (word.startswith("doctor") and word != "doctorate")


def _level(degree: str, certificate: bool = False) -> int:
    """How high a degree is: 5 for a doctorate down to 1 for school, 0 when it names none. The highest level it names
    counts, by these rules:

    1. "Integrated", "Dual", "Degree", "Two Year" or a number before a degree's codes is skipped.
    2. Every level a degree starts with counts, joined by "and" or "plus" or not: "BE/ME dual degree", "B.S. and M.S."
       and "Dual Degree (BS-MS)" are master's. After another level, a short master's code counts only after its own
       bachelor's code or a joiner, so "B.Tech (ME)" is a bachelor's in Mechanical.
    3. After that start, a longer code counts anywhere ("Dual Degree (B.Tech + M.Tech)" is a master's) and a two-letter
       one doesn't ("B.Tech in ME", "Coursework, to be completed").
    4. "Master", "Associate" and a "doctor" word other than "Doctorate" count only before "of", "in", "degree" or a
       degree's code: "Master of Technology", "Master Degree in CS" and "Master (MS)" are master's; "Certified Scrum
       Master", "Master Trainer" and "AWS Certified Developer – Associate" name none.
    5. With `certificate` (a row that says certified or certificate), a two-letter code counts only written with dots
       or before "in" or "of": "M.S. Computer Science (Certificate in Data Science)" is a master's, "MS Certified: Azure
       Data Engineer Associate" names none.

    Known limits, left as they are (pinned with the rest in `test_autofill.py`'s EDUCATION_LINES): "Master" before a
    plain word ("Master, Computer Science", "Master Computer Applications") names none, as "Master Trainer" doesn't; a
    second degree after "in" ("BS in CS and MS in Data Science") isn't counted; "Post Graduate Certificate" ranks as a
    PG Diploma does; a bare two-letter code beside a certificate ("BA (Certificate in Accounting)") is set aside; and a
    degree the levels don't list (MBBS, B.Arch, LLB, AA) is 0, as is a certification that doesn't say certified or
    certificate ("CompTIA Security+")."""
    lowered = degree.lower()
    dotted = {first + second for first, second in re.findall(r"\b([a-z])\.\s?([a-z])\b", lowered)}
    plain = re.sub(r"[.'’]", "", lowered)
    words = re.sub(r"[^a-z0-9]+", " ", plain)
    for pair, word in _TWO_WORDS:
        words = re.sub(rf"\b{pair}\b", word, words)
    def level(word):
        return 5 if word.startswith("doctor") else _LEVEL_OF.get(word, 0)
    def joined(bachelor, master):
        """Written as one dual degree ("BE/ME", "BS-MS", "BS & MS"), not a branch ("B.E. (ME)", "B.E. - ME")."""
        found = re.search(rf"\b{bachelor}\b([^a-z0-9]*)\b{master}\b", plain)
        return bool(found) and (found[1].strip() in ("/", "&", "+") or found[1] == "-")
    tokens = words.split()
    dual = any(word in ("dual", "integrated") for word in tokens)
    while tokens and (tokens[0] in _BEFORE_A_CODE or tokens[0].isdigit()):
        tokens = tokens[1:]
    levels, leading, previous = [], True, ""
    for word, following in zip(tokens, [*tokens[1:], ""]):
        if leading and word in _JOINERS:
            previous = word
            continue
        named = level(word)
        if _everyday(word) and following not in ("of", "in", "degree") and not level(following):
            named = 0
        elif certificate and word in _SHORT_CODES and word not in dotted and following not in ("in", "of"):
            named = 0
        elif word in _PAIRED and levels and not (
                previous in _JOINERS or previous == _PAIRED[word] and (dual or joined(previous, word))):
            named = 0
        leading = leading and bool(named)
        if named and (leading or word not in _SHORT_CODES):
            levels.append(named)
        previous = word
    return max(levels, default=0)


def _is_certificate(degree: str) -> bool:
    """A certificate, not a degree: a row that says certified or certificate and names no degree, read with the
    certificate rule ("Certified Scrum Master", "MS Certified: Azure Data Engineer Associate", "AWS Certified Developer
    – Associate"). Résumés often list them under education. A degree with a certificate attached is still a degree
    ("MBA with Graduate Certificate in Business Analytics", "M.S. Computer Science (Certificate in Data Science)")."""
    says = any(word.startswith("certif") for word in re.findall(r"[a-z]+", degree.lower()))
    return says and not _level(degree, certificate=True)


def _highest_school(schools: list[dict]) -> dict:
    """The education with the highest degree, among the rows that name a degree or a school (a blank row is none) and
    aren't a certificate; the first listed when they're level or can't be told apart."""
    named = [school for school in schools if (text(school.get("degree")) or text(school.get("institution")))
             and not _is_certificate(text(school.get("degree")))]
    return max(named, key=lambda school: _level(text(school.get("degree"))), default={})


# What a degree line says was studied, after the degree's own words: "B.Tech in Computer Science", "B.S., Information
# Systems", "B.E. - Mechanical Engineering", or after a degree's short code: "BS Computer Science", "MBA Finance".
_FIELD_AFTER = re.compile(r"\s+in\s+|\s*,\s+|\s+[-–—:]\s+", re.IGNORECASE)
_FIELD_AFTER_CODE = re.compile(
    r"^(?:b\.?\s?tech|m\.?\s?tech|b\.?\s?sc|m\.?\s?sc|b\.?\s?com|m\.?\s?com|b\.?\s?e|m\.?\s?e|b\.?\s?s|m\.?\s?s|b\.?\s?a|"
    r"m\.?\s?a|mba|bba|bca|mca|ph\.?\s?d)\.?\s+(.+)$", re.IGNORECASE)
# A note at the end of the line that isn't the subject: "(Honors)", "(2019)", ", GPA 3.8".
_FIELD_NOTE = re.compile(r"\s*\([^)]*\)\s*$|\s*[,;|]\s*(?:c?gpa|grade|percentage|honou?rs)\b.*$", re.IGNORECASE)


def _field_of_study(degree: str) -> str | None:
    """The subject a degree line names, as printed: "B.Tech in Computer Science and Engineering" is "Computer Science and
    Engineering", "B.S., Information Systems" is "Information Systems", "MS Data Science" is "Data Science". A line that
    only names the degree ("MBA", "Master of Computer Applications", "B.Tech (CSE)") gives none, and none is guessed; nor
    does a certificate row."""
    degree = text(degree)
    if not degree or _is_certificate(degree):
        return None
    found = _FIELD_AFTER.search(degree)
    rest = degree[found.end():] if found else (_FIELD_AFTER_CODE.match(degree) or [None, None])[1]
    if not rest:
        return None
    for _ in range(3):
        rest = _FIELD_NOTE.sub("", rest).strip(" .,-–—:;")
    return rest or None


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
        "education-field": _field_of_study(school.get("degree")),
        "education-school": text(school.get("institution")),
        "graduation-year": _graduation_year(school),
        "education-grade": text(school.get("grade")),
        "education-history": _entries({
            "degree": text(e.get("degree")), "field": _field_of_study(e.get("degree")), "school": text(e.get("institution")),
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
        # A US citizen is exactly the USC status; any other status the profile records isn't one.
        "citizenship": (text(c("work_auth")) == "USC") if text(c("work_auth")) else None,
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
    replaced (`over`), and `custom`, the questions the user added, oldest first, each `{question, also, answer}`.
    Anything else stored is no entry: a value that isn't an object, the first 0019's `{question: answer}` (built
    answers, not typed ones), an edit without an answer, a custom entry that isn't one (a blank question, no answer).
    A question in a fixed question's words stays (a question added or reworded here can take them after it was typed):
    `merged()` decides whether it shows. `{}` when none are left."""
    stored = _get(version, "autofill")
    if not isinstance(stored, Mapping):
        return {}
    edited, custom = stored.get("edited"), stored.get("custom")
    edits = {key: {"answer": edit["answer"], "over": edit.get("over")} for key, edit in edited.items()
             if isinstance(key, str) and isinstance(edit, Mapping) and "answer" in edit} if isinstance(edited, Mapping) else {}
    added = [{"question": entry["question"], "also": _wordings(entry.get("also")), "answer": entry["answer"]}
             for entry in (custom if isinstance(custom, list) else [])
             if isinstance(entry, Mapping) and isinstance(entry.get("question"), str) and entry["question"].strip()
             and "answer" in entry]
    return {"edited": edits, "custom": added} if edits or added else {}


def _wordings(also) -> list[str]:
    return [wording for wording in also if isinstance(wording, str) and wording.strip()] if isinstance(also, list) else []


def wording(question: str) -> str:
    """A question as two are compared (07 Q43): without capitals, spacing or punctuation."""
    return " ".join(re.sub(r"[^\w\s]", " ", question.casefold()).split())


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


def merged(candidate, version, today: date | None = None, *, editor: bool = False) -> list[dict]:
    """Every question of one version once: the fixed ones in QUESTIONS order, each the user's edit while the answer it
    replaced is still the built one, then the questions the user added, oldest first, with their other wordings
    (`also`, when there are any). A fixed answer whose edit stopped applying carries that edit's answer as `replaced`
    (07 Q15). `editor` (the Autofill screen, Q34) also lists the fixed questions with no answer, as null, and gives
    each keyed answer its `type`. Built for this read; nothing is written."""
    built = _answers(candidate, version, today or date.today())
    entries = entries_of(version)
    edits, added = entries.get("edited", {}), entries.get("custom", [])
    out = []
    for key, question in QUESTIONS.items():
        answer, edit = built.get(key), edits.get(key)
        typed = {"type": ANSWER_TYPES[key]} if editor else {}
        worded = {"also": ALSO[key]} if key in ALSO and not editor else {}
        if edit is not None and _same(edit["over"], answer):
            out.append({"question": question, "answer": edit["answer"], "kind": EDITED, "key": key, **typed,
                        **worded, "built": answer})
        elif answer is not None or editor:
            fixed = {"question": question, "answer": answer, "kind": FIXED, "key": key, **typed, **worded}
            out.append({**fixed, "replaced": edit["answer"]} if edit is not None else fixed)
    # A question the user added in words a fixed question took later shows only while that one has no answer: each
    # question once.
    shown = {entry["question"] for entry in out if entry["answer"] is not None}
    out.extend({"question": entry["question"], "answer": entry["answer"], "kind": CUSTOM,
                **({"also": entry["also"]} if entry["also"] else {})}
               for entry in added if entry["question"] not in shown)
    return out


class Refused(ValueError):
    """A change the save route refuses (400), with what to tell the user."""


def _checked(key: str, answer):
    """`answer` as fixed question `key` keeps it, or Refused."""
    kind = ANSWER_TYPES.get(key)
    if kind is None:
        raise Refused(f"No question has the key {key!r}.")
    if kind == "entries":
        raise Refused(f"{QUESTIONS[key]} Change it in the résumé itself.")
    if kind == "text" and isinstance(answer, str) and answer.strip() and len(answer) <= MAX_ANSWER:
        return answer.strip()
    if kind == "texts" and isinstance(answer, list) and all(isinstance(item, str) for item in answer):
        items = [item.strip() for item in answer if item.strip()]
        if items and len(items) <= MAX_ITEMS and all(len(item) <= MAX_ITEM for item in items):
            return items
    if kind == "number" and isinstance(answer, (int, float)) and not isinstance(answer, bool) and 0 <= answer < 10**7:
        return _number(answer)
    if kind == "boolean" and isinstance(answer, bool):
        return answer
    if kind == "date" and isinstance(answer, str) and _DATE.match(answer):
        try:
            return date.fromisoformat(answer).isoformat()
        except ValueError:
            pass
    raise Refused(f"That isn't an answer to {QUESTIONS[key]!r}: it takes {_TAKES[kind]}.")


_TAKES = {"text": f"text, up to {MAX_ANSWER} characters", "texts": f"a list of up to {MAX_ITEMS} short texts",
          "number": "a number", "boolean": "yes or no", "date": "a date (YYYY-MM-DD)"}


def checked_change(edit: Mapping, reset: list, add: Mapping, remove: list) -> dict:
    """A save's change with each answer as it's kept, or Refused: an unknown key, a list answer (Q42), an answer of the
    wrong kind, a key both edited and reset, an added question in a fixed question's words (edit that one instead)."""
    if not (edit or reset or add or remove):
        raise Refused("Nothing to save.")
    edits = {key: _checked(key, answer) for key, answer in edit.items()}
    for key in reset:
        if key not in QUESTIONS:
            raise Refused(f"No question has the key {key!r}.")
        if key in edits:
            raise Refused(f"{QUESTIONS[key]} is both changed and reset.")
    fixed = {wording(question) for question in QUESTIONS.values()}
    added = {}
    for question, answer in add.items():
        question, answer = question.strip(), answer.strip() if isinstance(answer, str) else answer
        if not question or len(question) > MAX_QUESTION:
            raise Refused(f"A question is 1 to {MAX_QUESTION} characters.")
        if not isinstance(answer, str) or not answer or len(answer) > MAX_ANSWER:
            raise Refused(f"An answer to {question!r} is text, up to {MAX_ANSWER} characters.")
        if wording(question) in fixed:
            raise Refused(f"{question!r} is one of BenchQ's own questions: change its answer instead.")
        added[question] = answer
    return {"edit": edits, "reset": list(dict.fromkeys(reset)), "add": added,
            "remove": [q.strip() for q in remove if isinstance(q, str) and q.strip()]}


def unseen(candidate, version, edited: Mapping, shown_built: Mapping, today: date) -> list[str]:
    """The edited keys whose built answer now isn't the one the user was shown (`shown_built`): saving over it would
    replace an answer they never saw, such as a rate the manager changed meanwhile (Abdul's fourth review, §8.1)."""
    built = _answers(candidate, version, today)
    return [key for key in edited if not _same(shown_built.get(key), built.get(key))]


def shown(candidate, version, today: date) -> dict:
    """What a version answers now, for comparing one version with another: each fixed question's answer by key (an
    edit while it applies), and each added question's by its wording, its other wordings too."""
    built = _answers(candidate, version, today)
    entries = entries_of(version)
    edits = entries.get("edited", {})
    out = {key: (edit["answer"] if (edit := edits.get(key)) is not None and _same(edit["over"], built.get(key))
                 else built.get(key)) for key in QUESTIONS}
    for entry in entries.get("custom", []):
        for asked in (entry["question"], *entry["also"]):
            out.setdefault(("custom", wording(asked)), entry["answer"])
    return out


def change(candidate, version, change: dict, before: dict, today: date, *, is_opened: bool) -> dict | None:
    """`version`'s entries with `change` made (from `checked_change`), or None when it changes nothing. On the version
    opened on the screen (`is_opened`) every part applies. On another version of the same résumé (07 Q30, Q44) a new
    answer goes where that version has no answer to the question yet or still answers what the opened one did before
    the save (`before`, from `shown()`); a reset or a removal only where it still answers the same. A version that
    answers differently keeps its own. An edit's `over` is the version's own built answer; an edit equal to it is no
    edit."""
    built = _answers(candidate, version, today)
    now = shown(candidate, version, today)
    entries = entries_of(version)
    edits = dict(entries.get("edited", {}))
    custom = [dict(entry) for entry in entries.get("custom", [])]

    def reaches(slot, *, answers: bool = False) -> bool:
        return is_opened or _same(now.get(slot), before.get(slot)) or (answers and now.get(slot) is None)

    for key, answer in change["edit"].items():
        if reaches(key, answers=True):
            if _same(answer, built.get(key)):
                edits.pop(key, None)
            else:
                edits[key] = {"answer": answer, "over": built.get(key)}
    for key in change["reset"]:
        if reaches(key):
            edits.pop(key, None)

    def find(question: str) -> dict | None:
        asked = wording(question)
        return next((entry for entry in custom if asked in {wording(q) for q in (entry["question"], *entry["also"])}),
                    None)

    for question, answer in change["add"].items():
        if not reaches(("custom", wording(question)), answers=True):
            continue
        found = find(question)
        if found is not None:
            found["answer"] = answer
        elif len(custom) < MAX_CUSTOM:
            custom.append({"question": question, "also": [], "answer": answer})
        elif is_opened:
            raise Refused(f"A résumé keeps up to {MAX_CUSTOM} questions of your own.")
    for question in change["remove"]:
        found = find(question)
        if found is not None and reaches(("custom", wording(question))):
            custom.remove(found)

    result = {"edited": edits, "custom": custom} if edits or custom else {}
    return None if result == entries else result
