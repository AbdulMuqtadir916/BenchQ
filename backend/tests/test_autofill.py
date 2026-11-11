"""Résumé autofill (decided 2026-11-07, finished 2026-11-08; docs/02 §8.1): the fixed answers are built from the version
and the profile on each read, each with its key; the user's own entries are stored per version, an edit by its key with
the built answer it replaced, and go with a save and a promote; only opening one version with `?autofill=true` returns
them."""
import re
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest

from backend.candidates import autofill
from backend.candidates.autofill import QUESTIONS, YEARS, build, entries_of, merged, years_from_work
from backend.tests.test_candidates_api import world  # noqa: F401  (the fixture)
from backend.tests.test_resume_versions import _candidate, _listing, _pdf, _save, _url, _v, parser  # noqa: F401

TODAY = date(2026, 10, 27)


def _job(start, end, current=False, **more):
    return {"job_title": "", "company": "", "start": start, "end": end, "current": current, "bullets": [], **more}


def test_years_follow_the_new_candidate_forms_rule():
    """The same cases as src/lib/api/dto/resume-parse.test.ts (`yearsFromWork`), the same answers."""
    assert years_from_work([_job("2020-01", "2021-12")], TODAY) == 2
    assert years_from_work([_job("2020-01", "2021-12"), _job("2021-01", "2022-12")], TODAY) == 3
    assert years_from_work([_job("2020-01", "2020-12"), _job("2022-01", "2022-12")], TODAY) == 2
    assert years_from_work([_job("2024-10", "", True)], TODAY) == 2
    assert years_from_work([_job("2019", "2020")], TODAY) == 1
    assert years_from_work([_job("", "2020-05"), _job("2023-01", "2022-01")], TODAY) is None
    assert years_from_work([], TODAY) is None


def test_only_real_months_count():
    """00 and 13 aren't months, so that job is skipped (resume-parse.test.ts has the same cases)."""
    assert years_from_work([_job("2020-00", "2021-12")], TODAY) is None
    assert years_from_work([_job("2020-01", "2021-13")], TODAY) is None
    assert years_from_work([_job("2020-01", "2021-13"), _job("2020-01", "2021-12")], TODAY) == 2


VERSION = {
    "full_name": "Ravi Teja", "email": "ravi@example.test", "phone": "+1 555 0100", "linkedin": "", "github": None,
    "city": "Irving", "state": "TX", "country": "US", "title": "Java Developer", "summary": "Nine years of Java.",
    "work_authorization": "H1B visa", "skills": [{"id": "s1", "category": "Languages", "name": "Java"}],
    "experiences": [{"id": "e1", "job_title": "Senior Java Developer", "company": "Capital Payments",
                     "location": "Irving, TX", "dates": "Mar 2021 – Present", "start": "2021-03", "end": "",
                     "current": True, "bullets": [{"id": "b1", "text": "Built the payments API."}]},
                    {"id": "e2", "job_title": "Java Developer", "company": "Acme", "location": "",
                     "dates": "2018 – 2021", "start": "2018", "end": "2021", "current": False, "bullets": []}],
    "educations": [{"id": "d1", "degree": "B.Tech", "institution": "JNTU", "graduation_date": "May 2017", "grade": ""}],
    "projects": [{"id": "p1", "name": "Ledger", "url": "", "dates": "2023", "technologies": "Kafka",
                  "bullets": [{"id": "b2", "text": "Designed it."}]}],
    "awards": [{"id": "a1", "name": "Star Performer", "issuer": "Capital Payments", "date": "2023", "detail": ""}],
    "certifications": [{"id": "c1", "name": "AWS Developer", "issuer": "Amazon", "date": "2022", "detail": ""}],
    "languages": [{"id": "l1", "name": "English"}],
    "autofill": {},
}
CANDIDATE = {
    "work_auth": "H1B", "work_auth_expiry": None, "needs_sponsorship": True, "needs_transfer": False,
    "years_experience": 9, "primary_role": "Java Developer", "target_roles": ["Java Developer", "Backend Engineer"],
    "rate_target": 85, "available_from": None, "notice_period_days": 14, "willing_to_relocate": False,
    "employment_types": ["C2C", "TEEN99"], "work_settings": ["REMOTE", "ONSITE"], "preferred_locations": ["Dallas, TX"],
    "preferred_industries": [],
    # The firm's own, never in the autofill:
    "rate_min": 70, "contact_notes": "Call after 6pm.", "deal_breakers": ["No travel"], "status": "ON_BENCH",
    "bench_start_date": "2026-09-01",
}


def test_every_non_id_fact_as_a_typed_answer_and_nothing_of_the_firms_own():
    answers = build(CANDIDATE, VERSION, TODAY)
    assert answers == {
        "What is your full name?": "Ravi Teja",
        "What is your email address?": "ravi@example.test",
        "What is your phone number?": "+1 555 0100",
        "Which city do you live in?": "Irving",
        "Which state do you live in?": "TX",
        "Which country do you live in?": "US",
        "What is your professional title?": "Java Developer",
        "Give a short professional summary.": "Nine years of Java.",
        "What is your work authorization?": "H-1B",                      # the profile's, not the résumé's "H1B visa"
        "What are your skills?": ["Java"],
        "Who is your current or most recent employer?": "Capital Payments",
        "What is your current or most recent job title?": "Senior Java Developer",
        "List your work experience.": [
            {"company": "Capital Payments", "title": "Senior Java Developer", "location": "Irving, TX",
             "dates": "Mar 2021 – Present", "start": "2021-03", "current": True, "bullets": ["Built the payments API."]},
            {"company": "Acme", "title": "Java Developer", "dates": "2018 – 2021", "start": "2018", "end": "2021",
             "current": False}],
        "What is your highest degree?": "B.Tech",
        "Which school did you attend?": "JNTU",
        "What year did you graduate?": 2017,
        "List your education.": [{"degree": "B.Tech", "school": "JNTU", "graduation_date": "May 2017"}],
        "List your projects.": [{"name": "Ledger", "dates": "2023", "technologies": "Kafka", "bullets": ["Designed it."]}],
        "Which awards have you received?": [{"name": "Star Performer", "issuer": "Capital Payments", "date": "2023"}],
        "Which certifications do you have?": ["AWS Developer"],
        "Which languages do you speak?": ["English"],
        "Will you now or in the future require visa sponsorship?": True,
        "Do you need a visa transfer?": False,
        "Are you a US citizen?": False,                                  # the profile's H1B
        YEARS: 8,                                                       # from the jobs: 2018-01 to 2026-10
        "What is your primary role?": "Java Developer",
        "What roles are you looking for?": ["Java Developer", "Backend Engineer"],
        "What is your expected rate?": 85,
        "What is your notice period in days?": 14,
        "Are you willing to relocate?": False,
        "Which employment types are you open to?": ["C2C", "1099"],
        "Do you prefer remote, hybrid or on-site work?": ["Remote", "On-site"],
        "Which locations do you prefer?": ["Dallas, TX"],
    }
    text = str(answers)
    for own in ("Call after 6pm", "No travel", "ON_BENCH", "70", "2026-09-01"):
        assert own not in text


def test_every_question_has_its_own_key():
    assert len(set(QUESTIONS.values())) == len(QUESTIONS)
    # Lower-case words joined by hyphens; a digit may name a part ("address-line1", "over-18", as the extension names them).
    assert all(re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", key) for key in QUESTIONS)


def _edit(answer, over):
    return {"answer": answer, "over": over}


def _custom(question, answer, also=()):
    return {"question": question, "also": list(also), "answer": answer}


def test_the_users_entry_wins_and_every_answer_says_what_it_is():
    typed = {"edited": {"pay-rate": _edit(95, 85), "github-url": _edit("github.com/ravi", None)},
             "custom": [_custom("Why do you want to work here?", "Payments.")]}
    entries = merged(CANDIDATE, {**VERSION, "autofill": typed}, TODAY)
    by_question = {entry["question"]: entry for entry in entries}
    assert entries[0] == {"question": "What is your full name?", "answer": "Ravi Teja", "kind": "FIXED",
                          "key": "full-name"}
    assert by_question["What is your expected rate?"] == {
        "question": "What is your expected rate?", "answer": 95, "kind": "EDITED", "key": "pay-rate", "built": 85}
    # A fixed question the résumé doesn't answer, typed in: the user's; a reset leaves nothing.
    assert by_question["What is your GitHub profile URL?"] == {
        "question": "What is your GitHub profile URL?", "answer": "github.com/ravi", "kind": "EDITED",
        "key": "github-url", "built": None}
    assert entries[-1] == {"question": "Why do you want to work here?", "answer": "Payments.", "kind": "CUSTOM"}
    questions = [entry["question"] for entry in entries]
    assert len(questions) == len(set(questions))                    # each question once
    assert set(questions) == set(build(CANDIDATE, VERSION, TODAY)) | {
        "What is your GitHub profile URL?", "Why do you want to work here?"}


def test_an_edit_applies_while_the_answer_it_replaced_is_the_built_one():
    typed = {"edited": {"pay-rate": _edit(95, 85), "professional-title": _edit("Staff Engineer", "Java Developer")}}
    kinds = lambda candidate, version: {e["key"]: (e["kind"], e["answer"]) for e in merged(candidate, version, TODAY)
                                        if "key" in e}                           # noqa: E731
    both = kinds(CANDIDATE, {**VERSION, "autofill": typed})
    assert both["pay-rate"] == ("EDITED", 95) and both["professional-title"] == ("EDITED", "Staff Engineer")
    # The profile's rate changed after the edit: the new rate shows. The version's own title changed: so does it.
    later = kinds({**CANDIDATE, "rate_target": 100}, {**VERSION, "title": "Principal Engineer", "autofill": typed})
    assert later["pay-rate"] == ("FIXED", 100) and later["professional-title"] == ("FIXED", "Principal Engineer")
    # `true` isn't `1`: an edit made over one doesn't apply over the other.
    flag = {"edited": {"visa-sponsorship": _edit(False, 1)}}
    assert kinds(CANDIDATE, {**VERSION, "autofill": flag})["visa-sponsorship"] == ("FIXED", True)
    # But 85.0 is 85, as the built numbers are written, at any depth (Abdul's third review).
    whole = {"edited": {"pay-rate": _edit(95, 85.0)}}
    assert kinds(CANDIDATE, {**VERSION, "autofill": whole})["pay-rate"] == ("EDITED", 95)
    assert autofill._same([{"rate": 2.0}], [{"rate": 2}]) and not autofill._same([True], [1.0])


def test_an_edit_is_kept_by_its_key_whatever_the_wording(monkeypatch):
    typed = {"edited": {"address-region": _edit("Texas", "TX")}}
    monkeypatch.setitem(autofill.QUESTIONS, "address-region", "In which state do you reside?")
    region = next(e for e in merged(CANDIDATE, {**VERSION, "autofill": typed}, TODAY) if e.get("key") == "address-region")
    assert region == {"question": "In which state do you reside?", "answer": "Texas", "kind": "EDITED",
                      "key": "address-region", "built": "TX"}


@pytest.mark.parametrize("stored", [
    "Texas", ["a", "b"], [], None, {"edited": "Texas"}, {"edited": {"address-region": "Texas"}},
    # What the first 0019 wrote: every built answer by its question, never typed by anyone.
    {"What is your full name?": "Old Name", "Which state do you live in?": "CA"},
    # `custom` as a map, as before 07 Q40 made it a list: nothing ever wrote one.
    {"custom": {"Why us?": "Payments."}},
])
def test_anything_else_stored_reads_as_no_entries(stored):
    entries = merged(CANDIDATE, {**VERSION, "autofill": stored}, TODAY)
    assert all(entry["kind"] == "FIXED" for entry in entries)
    assert entries[0]["answer"] == "Ravi Teja" and entries_of({"autofill": stored}) == {}


def test_a_custom_question_in_a_fixed_questions_words_is_kept_and_shows_while_that_one_has_no_answer():
    """A question added or reworded here can take the words of one the user typed before (Abdul's third review): the
    entry stays, so a save copies it on, and the read shows the fixed question while it has an answer."""
    notice = "What is your notice period in days?"
    typed = {"custom": [_custom(notice, "30, negotiable"), _custom("What is your full name?", "Someone Else"),
                        _custom("Why us?", "Payments.")]}
    assert entries_of({"autofill": typed}) == {"edited": {}, "custom": typed["custom"]}

    def asked(candidate, question):
        entries = merged(candidate, {**VERSION, "autofill": typed}, TODAY)
        assert entries[-1] == {"question": "Why us?", "answer": "Payments.", "kind": "CUSTOM"}
        return [(e["answer"], e["kind"]) for e in entries if e["question"] == question]

    assert asked(CANDIDATE, notice) == [(14, "FIXED")]
    assert asked(CANDIDATE, "What is your full name?") == [("Ravi Teja", "FIXED")]
    assert asked({**CANDIDATE, "notice_period_days": None}, notice) == [("30, negotiable", "CUSTOM")]


def test_work_authorization_is_the_profiles_status():
    assert build(CANDIDATE, VERSION, TODAY)["What is your work authorization?"] == "H-1B"   # not the résumé's "H1B visa"
    assert build({**CANDIDATE, "work_auth": "GC_EAD"}, VERSION, TODAY)["What is your work authorization?"] == "GC EAD"
    assert "What is your work authorization?" not in build({**CANDIDATE, "work_auth": None}, VERSION, TODAY)


def test_the_highest_degree_comes_with_its_own_school_and_year():
    schools = [{"degree": "B.Tech in ME", "institution": "JNTU", "graduation_date": "2013 – 2017"},
               {"degree": "M.S. Computer Science", "institution": "UT Dallas", "graduation_date": "Dec 2019"},
               {"degree": "Intermediate", "institution": "Narayana", "graduation_date": "2013"}]
    asked = ("What is your highest degree?", "Which school did you attend?", "What year did you graduate?")

    def answers(educations):
        built = build(CANDIDATE, {**VERSION, "educations": educations}, TODAY)
        return tuple(built.get(question) for question in asked)

    assert answers(schools) == ("M.S. Computer Science", "UT Dallas", 2019)
    assert answers([schools[2], schools[0]]) == ("B.Tech in ME", "JNTU", 2017)      # the last year written
    assert answers([{"degree": "Coursework", "institution": "A"}, {"degree": "Training", "institution": "B"}]) == (
        "Coursework", "A", None)                                                    # can't tell: the first listed
    # A two-letter code names a degree only at its start: "to be completed" isn't a bachelor's.
    assert answers([{"degree": "Coursework, to be completed 2025", "institution": "A"},
                    {"degree": "Associate of Arts", "institution": "B", "graduation_date": "2019"}]) == (
        "Associate of Arts", "B", 2019)
    # The levels a degree starts with count, the highest of them.
    assert answers([{"degree": "B.Tech", "institution": "A"}, {"degree": "BE/ME dual degree", "institution": "B"}])[:2] == (
        "BE/ME dual degree", "B")
    # The highest level named counts, in whatever order it's written (Abdul's third review).
    for dual in ("B.Tech + M.Tech Dual Degree", "Dual Degree (B.Tech + M.Tech)",
                 "Bachelor of Technology and Master of Technology", "Integrated MS"):
        assert answers([{"degree": "B.Sc. Physics", "institution": "A"}, {"degree": dual, "institution": "B"}])[:2] == (
            dual, "B")
    # Words such as "Dual", "Degree", "Five" and "Year" can come before the codes (Abdul's fourth review).
    for dual in ("Dual Degree (BS-MS)", "Dual Degree BS-MS", "Integrated Dual Degree BS-MS", "Five Year Integrated MS",
                 "BS-MS Dual Degree", "Integrated BS-MS"):
        assert answers([{"degree": "Diploma in Electronics", "institution": "SBTET"},
                        {"degree": dual, "institution": "IISER Pune"}])[:2] == (dual, "IISER Pune")
    # A certificate listed under education isn't a degree, and "Master" or a "Doctor" word that doesn't lead names one
    # only before "of" or "in" (Abdul's fourth review).
    btech = {"degree": "B.Tech in CSE", "institution": "JNTU", "graduation_date": "2017"}
    for other in ("Certified Scrum Master", "Master Data Management Certificate",
                  "B.Sc., Pre-Doctoral Research Fellow"):
        assert answers([btech, {"degree": other, "institution": "B", "graduation_date": "2021"}]) == (
            "B.Tech in CSE", "JNTU", 2017)
    assert answers([{"degree": "Certified Scrum Master", "institution": "Scrum Alliance"}]) == (None, None, None)
    # Abdul's fifth review. A degree with a certificate attached is still a degree; a certificate alone isn't one.
    mba = {"degree": "MBA with Graduate Certificate in Business Analytics", "institution": "UT Dallas",
           "graduation_date": "2017"}
    assert answers([btech, mba]) == (mba["degree"], "UT Dallas", 2017)
    for degree in ("M.S. Computer Science (Certificate in Data Science)", "B.Tech (NBA Certified program)"):
        assert answers([{"degree": degree, "institution": "A"}])[:2] == (degree, "A")
    for certificate in ("AWS Certified Solutions Architect", "Certificate in Project Management"):
        assert answers([{"degree": certificate, "institution": "A"}]) == (None, None, None)
    # "and" or "plus" doesn't end the levels a degree starts with; "in" and "with" do.
    both = {"degree": "B.S. and M.S.", "institution": "IISER", "graduation_date": "2015"}
    assert answers([btech, both]) == ("B.S. and M.S.", "IISER", 2015)
    assert [autofill._level(d) for d in ("BE and ME", "B.Tech and MS", "Bachelor and Master Degree",
                                         "B.Tech in Electronics and ME")] == [4, 4, 4, 3]
    # Any number word can come before the codes, as a digit can.
    assert answers([{"degree": "Diploma in Electronics", "institution": "SBTET"},
                    {"degree": "Two Year MS", "institution": "UIUC"}])[:2] == ("Two Year MS", "UIUC")
    assert [autofill._level(d) for d in ("Four-year B.S.", "Three Year BA")] == [3, 3]
    # "Master" names a degree only before "of", "in" or "degree", at the start too; "Doctorate" always does.
    assert answers([btech, {"degree": "Master Data Management Specialist", "institution": "B"}])[:2] == (
        "B.Tech in CSE", "JNTU")
    assert [autofill._level(d) for d in ("Master Trainer", "Master Degree in CS", "Doctorate")] == [0, 4, 5]


# Abdul's sixth review: real education lines, each with the level the rules written in `autofill._level` give it, or
# None for a certificate, which is never the highest degree. Every line from his six reviews is here, with Indian and US
# degrees, dual and integrated degrees, branches, vendor certificates, school levels and bootcamps.
EDUCATION_LINES = [
    # Bachelor's, with a branch written after it.
    ("B.Tech in CSE", 3), ("B.Tech (CSE)", 3), ("B.Tech - Computer Science", 3), ("BTech", 3), ("B.Tech (Hons.)", 3),
    ("B.E. Computer Science", 3), ("B.E (ECE)", 3), ("BE in Mechanical Engineering", 3), ("B.Tech (ME)", 3),
    ("B.Tech - ME", 3), ("B.E. (ME)", 3), ("BE (ME)", 3), ("B.E. ME", 3), ("B.E. - ME", 3), ("BE - ME", 3),
    ("B.Sc (MS)", 3), ("B.Com with MS Office", 3), ("B.Tech with ME specialization", 3),
    ("B.Tech in Electronics and ME", 3), ("B.Sc. Computer Science", 3), ("B.Sc (MPC)", 3), ("BCA", 3), ("B.Com", 3),
    ("BBA", 3), ("Four-year B.S.", 3), ("B.Pharm", 3), ("B.Pharmacy", 3), ("Bachelor of Pharmacy", 3),
    ("Bachelor of Science in Computer Science", 3), ("Bachelor of Science (BS) in Information Technology", 3),
    ("BS Computer Science", 3), ("B.S., Computer Science", 3), ("BS in CS", 3), ("Bachelor's in Computer Science", 3),
    ("Bachelor's Degree", 3), ("Bachelors of Engineering", 3), ("B.Sc., Pre-Doctoral Research Fellow", 3),
    # Master's.
    ("M.Tech (CSE)", 4), ("M.Tech in Software Engineering", 4), ("MCA", 4), ("M.Sc (IT)", 4), ("M.Com", 4),
    ("MBA (Finance)", 4), ("MBA - Marketing", 4), ("PGDM", 4), ("PG Diploma in Data Science", 4),
    ("Post Graduate Diploma in Management", 4), ("Post Graduate Programme in Management (PGPM)", 4), ("M.Pharm", 4),
    ("M. Pharm", 4), ("Master of Pharmacy", 4), ("M.E.", 4), ("M.E. (Structures)", 4), ("MS (CS)", 4),
    ("MS - Computer Science", 4), ("Master of Science in Computer Science", 4),
    ("Master of Science (MS) in Information Systems", 4), ("MS in Computer Science", 4), ("M.S. Data Science", 4),
    ("MS Computer Science", 4), ("Master's in CS", 4), ("Master's Degree in Computer Science", 4),
    ("Master Degree in CS", 4), ("Master (MS) in Computer Science", 4), ("Master (M.S.), Computer Science", 4),
    ("Master (M.Tech)", 4), ("Master in Computer Applications (MCA)", 4), ("Master of Business Administration", 4),
    ("Executive MBA", 4), ("MBA", 4),
    # Dual and integrated degrees.
    ("Integrated M.Tech", 4), ("Integrated MS", 4), ("Integrated BS-MS", 4), ("Dual Degree (B.Tech + M.Tech)", 4),
    ("Dual Degree (BS-MS)", 4), ("B.Tech + M.Tech Dual Degree", 4), ("Five Year Integrated M.Sc", 4),
    ("Five Year Integrated MS", 4), ("Two Year MS", 4), ("BE/ME dual degree", 4), ("BS & MS", 4), ("B.S. and M.S.", 4),
    ("B.S.-M.S.", 4), ("BS - MS Dual Degree", 4), ("BS / MS", 4), ("BE+ME", 4), ("BE and ME", 4), ("B.Tech and MS", 4),
    ("Bachelor and Master Degree", 4), ("BS/MS in Physics", 4), ("BA/MA Economics", 4),
    # Doctorates, associate degrees, school.
    ("Ph.D. in Physics", 5), ("PhD", 5), ("Doctor of Philosophy", 5), ("Doctorate", 5), ("Doctoral Degree in Education", 5),
    ("Pharm.D", 5), ("Doctor of Pharmacy (Pharm.D)", 5), ("Associate of Applied Science", 2), ("Associate of Arts", 2),
    ("Associate Degree in Nursing", 2), ("Associate's Degree", 2), ("Diploma in Electrical Engineering", 1),
    ("Diploma in Electronics", 1), ("Intermediate (MPC)", 1), ("Intermediate", 1), ("SSC", 1),
    ("SSC (Secondary School Certificate)", 1), ("HSC (Higher Secondary Certificate)", 1), ("12th (CBSE)", 1),
    ("10th (ICSE)", 1), ("High School Diploma", 1), ("High School", 1), ("GED", 1),
    # A degree with a certificate attached is still a degree.
    ("M.S. Computer Science (Certificate in Data Science)", 4), ("MS in Computer Science (Certificate in AI)", 4),
    ("MBA with Graduate Certificate in Business Analytics", 4), ("B.Tech (NBA Certified program)", 3),
    ("Associate of Arts, Certificate in Accounting", 2),
    # Certificates.
    ("MS Certified: Azure Data Engineer Associate", None), ("Microsoft Certified: Azure Fundamentals", None),
    ("MS Office Certification", None), ("MS SQL Server Certified DBA", None),
    ("MS Azure Fundamentals (AZ-900) Certified", None), ("AWS Certified Solutions Architect – Associate", None),
    ("AWS Certified Developer – Associate", None), ("Oracle Certified Associate, Java SE 8 Programmer", None),
    ("Oracle Certified Professional", None), ("Google Cloud Certified Professional Data Engineer", None),
    ("Cisco Certified Network Associate (CCNA)", None), ("PMP Certification", None), ("Certified Scrum Master", None),
    ("Certified Scrum Master (CSM)", None), ("ITIL Foundation Certificate", None),
    ("Salesforce Certified Administrator", None), ("Certificate in Project Management", None),
    ("BA Certified (Business Analysis)", None), ("Coursera Machine Learning Certificate", None),
    ("Master Data Management Certificate", None),
    # No degree.
    ("Coursework", 0), ("Training", 0), ("Full Stack Development Bootcamp", 0), ("Master Trainer", 0),
    ("Master Data Management", 0), ("Master Data Management Specialist", 0), ("Coursework, to be completed 2025", 0),
    # Known limits, left as they are (`autofill._level`).
    ("Master, Computer Science", 0), ("Master Computer Applications", 0), ("BS in CS and MS in Data Science", 3),
    ("Post Graduate Certificate in Data Science", 4), ("BA (Certificate in Accounting)", None), ("MBBS", 0),
    ("B.Arch", 0), ("LLB", 0), ("AA", 0), ("CompTIA Security+", 0), ("Project Management Professional (PMP)", 0),
]


@pytest.mark.parametrize("line, level", EDUCATION_LINES)
def test_each_education_line_ranks_by_the_written_rules(line, level):
    if level is None:
        alone = build(CANDIDATE, {**VERSION, "educations": [{"degree": line, "institution": "A"}]}, TODAY)
        assert autofill._is_certificate(line) and "What is your highest degree?" not in alone
    else:
        assert not autofill._is_certificate(line) and autofill._level(line) == level


FIELD_LINES = [
    ("B.Tech in Computer Science and Engineering", "Computer Science and Engineering"),
    ("Master of Science in Information Systems", "Information Systems"),
    ("Master's in Computer Science", "Computer Science"),
    ("B.S., Information Systems", "Information Systems"),
    ("Bachelor's degree, Computer Science", "Computer Science"),
    ("B.E. - Mechanical Engineering", "Mechanical Engineering"),
    ("M.S. Computer Science", "Computer Science"),
    ("MS Data Science", "Data Science"),
    ("BS Computer Science", "Computer Science"),
    ("MBA Finance", "Finance"),
    ("Diploma in Electronics", "Electronics"),
    ("Ph.D. in Computer Science (2019)", "Computer Science"),
    ("Bachelor of Engineering in Civil (Honours)", "Civil"),
    ("M.S in CS, GPA 3.8", "CS"),
    ("MBA", None),
    ("B.Tech", None),
    ("Master of Computer Applications", None),
    ("B.Tech (CSE)", None),
    ("High School Diploma", None),
    ("MS Certified: Azure Data Engineer Associate", None),
    ("", None),
]


@pytest.mark.parametrize("line, field", FIELD_LINES)
def test_the_field_of_study_is_what_the_degree_line_names_after_the_degree(line, field):
    assert autofill._field_of_study(line) == field


def test_the_highest_degree_comes_with_its_field_and_gpa_and_each_school_with_its_field():
    built = build(CANDIDATE, {**VERSION, "educations": [
        {"degree": "B.Tech in ECE", "institution": "JNTU", "graduation_date": "2017", "grade": "8.1/10"},
        {"degree": "M.S. Computer Science", "institution": "UT Dallas", "graduation_date": "Dec 2019", "grade": "3.8"}]}, TODAY)
    assert (built["What did you study?"], built["What was your GPA?"]) == ("Computer Science", "3.8")
    assert built["List your education."] == [
        {"degree": "B.Tech in ECE", "field": "ECE", "school": "JNTU", "graduation_date": "2017", "grade": "8.1/10"},
        {"degree": "M.S. Computer Science", "field": "Computer Science", "school": "UT Dallas",
         "graduation_date": "Dec 2019", "grade": "3.8"}]
    # A line that names only the degree, and no grade, leave both questions out.
    assert "What did you study?" not in build(CANDIDATE, VERSION, TODAY)
    assert "What was your GPA?" not in build(CANDIDATE, VERSION, TODAY)


SELF_ID = ("gender", "pronouns", "race", "hispanic-latino", "veteran-status", "disability-status", "sexual-orientation",
           "transgender")


PERSONAL = ("preferred-name", "middle-name", "address-line1", "address-line2", "address-postal", "portfolio-url",
            "nationality", "current-pay", "salary-expectation", "onsite-work", "willing-to-travel", "commute", "over-18",
            "criminal-history", "background-check", "drug-test", "security-clearance", "non-compete", "government-work",
            "relative-at-company", "former-employee", "accommodations", "essential-functions")


def test_personal_questions_wait_for_the_bdes_answer_and_citizenship_is_the_profiles_status():
    built = build(CANDIDATE, VERSION, TODAY)
    assert not {QUESTIONS[key] for key in PERSONAL} & set(built)
    listed = {entry["key"] for entry in merged(CANDIDATE, VERSION, TODAY, editor=True) if entry["answer"] is None}
    assert set(PERSONAL) <= listed
    assert built["Are you a US citizen?"] is False                                  # H1B
    assert build({**CANDIDATE, "work_auth": "USC"}, VERSION, TODAY)["Are you a US citizen?"] is True
    assert "Are you a US citizen?" not in build({**CANDIDATE, "work_auth": None}, VERSION, TODAY)


def test_self_identification_is_never_built_and_the_screen_lists_it_to_answer():
    assert all(autofill.ANSWER_TYPES[key] == "text" for key in SELF_ID)
    assert not {QUESTIONS[key] for key in SELF_ID} & set(build(CANDIDATE, VERSION, TODAY))
    listed = {entry["key"]: entry for entry in merged(CANDIDATE, VERSION, TODAY, editor=True) if entry.get("key") in SELF_ID}
    assert set(listed) == set(SELF_ID)
    assert all(entry["answer"] is None and entry["kind"] == "FIXED" and entry["type"] == "text" for entry in listed.values())
    # The BDE's answer is an edit over no built answer: it applies, and the extension's read carries it.
    version = {**VERSION, "autofill": {"edited": {"gender": {"answer": "Female", "over": None}}}}
    read = {entry["key"]: entry for entry in merged(CANDIDATE, version, TODAY) if entry.get("key")}
    assert (read["gender"]["answer"], read["gender"]["kind"]) == ("Female", "EDITED")
    assert "race" not in read


def test_the_current_job_is_the_one_marked_current_else_the_one_that_ended_last():
    older_first = [_job("2015-01", "2017-12", company="Old Co", job_title="Developer"),
                   _job("2018-01", "2023-06", company="Recent Co", job_title="Senior Developer")]
    asked = ("Who is your current or most recent employer?", "What is your current or most recent job title?")

    def answers(jobs):
        built = build(CANDIDATE, {**VERSION, "experiences": jobs}, TODAY)
        return tuple(built.get(question) for question in asked)

    assert answers(older_first) == ("Recent Co", "Senior Developer")
    assert answers([*older_first, _job("2019-01", "", True, company="Side Co"),
                    _job("2022-05", "", True, company="Main Co", job_title="Lead")]) == ("Main Co", "Lead")
    assert answers([_job("", "", True), *older_first]) == ("Recent Co", "Senior Developer")   # an empty row isn't one


def test_a_blank_row_is_left_out():
    """Without its empty fields, a blank job is `{"current": false}` and a blank education, project or award is `{}`:
    neither is an entry, and a list with nothing else leaves its question out. A row with no company or title (only a
    location, or dates and bullets) isn't a job either."""
    not_jobs = [_job("", "", False, location="Remote"), _job("2019-01", "2019-06", bullets=[{"id": "b", "text": "Led QA."}])]
    blank = {**VERSION,
             "experiences": [_job("", "", False), _job("", "", True), *not_jobs, _job("2020-01", "", True, company="Acme")],
             "educations": [{"id": "d0", "degree": "", "institution": "", "graduation_date": "", "grade": ""}, {}],
             "projects": [{"id": "p0", "name": "", "url": "", "dates": "", "technologies": "", "bullets": []}, {}],
             "awards": [{"id": "a0", "name": "", "issuer": "", "date": "", "detail": ""}, {}]}
    answers = build(CANDIDATE, blank, TODAY)
    assert answers["List your work experience."] == [{"company": "Acme", "start": "2020-01", "current": True}]
    for question in ("List your education.", "List your projects.", "Which awards have you received?",
                     "What is your highest degree?", "Which school did you attend?", "What year did you graduate?"):
        assert question not in answers
    one_school = build(CANDIDATE, {**blank, "educations": [{}, *VERSION["educations"]]}, TODAY)
    assert one_school["List your education."] == [{"degree": "B.Tech", "school": "JNTU", "graduation_date": "May 2017"}]
    # A blank row first doesn't hide a degree the levels don't name (Abdul's third review).
    arch = {"degree": "B.Arch", "institution": "SPA Delhi", "graduation_date": "2016"}
    unranked = build(CANDIDATE, {**VERSION, "educations": [{"degree": "", "institution": ""}, arch]}, TODAY)
    assert [unranked.get(q) for q in ("What is your highest degree?", "Which school did you attend?",
                                      "What year did you graduate?")] == ["B.Arch", "SPA Delhi", 2016]


def test_a_date_is_its_day_in_utc_whatever_the_sessions_timezone():
    dallas_evening = datetime(2026, 11, 30, 18, 0, tzinfo=timezone(timedelta(hours=-6)))     # midnight UTC, Dec 1
    answers = build({**CANDIDATE, "available_from": dallas_evening,
                     "work_auth_expiry": datetime(2027, 3, 1, tzinfo=timezone.utc)}, VERSION, TODAY)
    assert answers["When can you start?"] == "2026-12-01"
    assert answers["When does your work authorization expire?"] == "2027-03-01"


def test_years_fall_back_to_the_profile_and_count_to_today():
    no_dates = {**VERSION, "experiences": [_job("", "")]}
    assert build(CANDIDATE, no_dates, TODAY)[YEARS] == 9                 # the profile's number
    assert YEARS not in build({**CANDIDATE, "years_experience": None}, no_dates, TODAY)
    assert build(CANDIDATE, VERSION, date(2027, 10, 27))[YEARS] == 9     # a year on, the current job counts a year more


# ── Through the API ──────────────────────────────────────────────────────────

def _open(client, world, candidate, version_id, who="owner", **params):
    r = client.get(_url(world, candidate, f"/{version_id}"), params=params, headers=world["as"][who])
    assert r.status_code == 200, r.text
    return r.json()


def _answers(opened) -> dict:
    return {entry["question"]: entry["answer"] for entry in opened["autofill"]}


def _stored(test_db, version_id):
    from backend.models.db import Resume
    test_db.expire_all()
    return test_db.get(Resume, uuid.UUID(version_id))


def test_only_opening_one_version_with_autofill_true_returns_it(anonymous_client, test_db, world):
    c = _candidate(anonymous_client, test_db, world)
    v1 = _v(anonymous_client, world, c)
    assert "autofill" not in v1 and "autofill" not in _open(anonymous_client, world, c, v1["id"], autofill="false")
    opened = _open(anonymous_client, world, c, v1["id"], autofill="true")
    assert opened["autofill"][0] == {"question": "What is your full name?", "answer": "Ravi Teja", "kind": "FIXED",
                                     "key": "full-name"}
    answers = _answers(opened)
    assert answers["What is your work authorization?"] == "H-1B"
    assert answers["Will you now or in the future require visa sponsorship?"] is True
    assert answers[YEARS] == years_from_work(
        [{"start": "2021-03", "end": "", "current": True}, {"start": "2018", "end": "2021"}], date.today())

    firm_url = f"/api/firms/{world['firm'].id}/resumes/{v1['id']}"
    by_id = anonymous_client.get(firm_url, params={"autofill": "true"}, headers=world["as"]["owner"])
    assert by_id.status_code == 200 and by_id.json()["autofill"] == opened["autofill"]
    assert "autofill" not in anonymous_client.get(firm_url, headers=world["as"]["owner"]).json()
    listing = _listing(anonymous_client, world, c)
    assert all("autofill" not in v for base in listing["bases"] for v in base["versions"])
    saved = _save(anonymous_client, world, c, v1, summary="Shorter.")
    assert saved.status_code == 201 and "autofill" not in saved.json()


def test_a_profile_edit_shows_in_every_version_at_once_and_nothing_is_stored(anonymous_client, test_db, world):
    c = _candidate(anonymous_client, test_db, world)
    v1 = _v(anonymous_client, world, c)
    v2 = _save(anonymous_client, world, c, v1, title="Staff Engineer").json()
    r = anonymous_client.patch(f"/api/firms/{world['firm'].id}/candidates/{c['id']}", headers=world["as"]["owner"],
                               json={"rate_target": 95, "willing_to_relocate": True})
    assert r.status_code == 200, r.text
    for version, title in ((v1, "Java Developer"), (v2, "Staff Engineer")):
        answers = _answers(_open(anonymous_client, world, c, version["id"], autofill="true"))
        assert answers["What is your expected rate?"] == 95 and answers["Are you willing to relocate?"] is True
        assert answers["What is your professional title?"] == title                 # each version its own text
        assert _stored(test_db, version["id"]).autofill == {}                       # built, not stored


def test_the_users_entries_go_with_a_save_and_a_promote_and_an_upload_starts_without(anonymous_client, test_db,
                                                                                       world, parser):
    c = _candidate(anonymous_client, test_db, world, bde="adnan")
    v1 = _v(anonymous_client, world, c, who="adnan")
    typed = {"edited": {"pay-rate": _edit(120, None), "professional-title": _edit("Lead Java Developer", "Java Developer")},
             "custom": [_custom("Why do you want to work here?", "Payments."),
                        _custom("What is your notice period in days?", "30, negotiable")]}  # in a fixed question's words
    _stored(test_db, v1["id"]).autofill = typed
    test_db.commit()
    on_v1 = {e["question"]: e for e in _open(anonymous_client, world, c, v1["id"], "adnan", autofill="true")["autofill"]}
    assert on_v1["What is your professional title?"]["answer"] == "Lead Java Developer"

    v2 = _save(anonymous_client, world, c, v1, "adnan", title="Staff Engineer").json()
    assert _stored(test_db, v2["id"]).autofill == typed
    entries = {e["question"]: e for e in _open(anonymous_client, world, c, v2["id"], "adnan", autofill="true")["autofill"]}
    assert entries["What is your expected rate?"] == {"question": "What is your expected rate?", "answer": 120,
                                                      "kind": "EDITED", "key": "pay-rate", "built": None}
    assert entries["Why do you want to work here?"]["kind"] == "CUSTOM"
    # v2's own title shows: the edit replaced v1's title, which v2 doesn't have.
    assert entries["What is your professional title?"] == {"question": "What is your professional title?",
                                                           "answer": "Staff Engineer", "kind": "FIXED",
                                                           "key": "professional-title",
                                                           "replaced": "Lead Java Developer"}      # 07 Q15

    r = anonymous_client.post(_url(world, c, f"/{v2['id']}/use-as-base"), headers=world["as"]["adnan"])
    assert r.status_code in (200, 201), r.text
    promoted = _listing(anonymous_client, world, c, "adnan")["bases"][1]["versions"][0]
    assert _stored(test_db, promoted["id"]).autofill == typed

    assert anonymous_client.post(_url(world, c, "/upload"), files=_pdf(), headers=world["as"]["adnan"]).status_code == 201
    uploaded = _listing(anonymous_client, world, c, "adnan")["bases"][2]["versions"][0]
    assert _stored(test_db, uploaded["id"]).autofill == {}


def test_a_save_leaves_behind_what_isnt_an_entry(anonymous_client, test_db, world):
    """What the first 0019 wrote (every built answer by its question) isn't copied on: a save keeps only entries."""
    c = _candidate(anonymous_client, test_db, world)
    v1 = _v(anonymous_client, world, c)
    _stored(test_db, v1["id"]).autofill = {"What is your full name?": "Old Name", "edited": {"pay-rate": _edit(120, None)}}
    test_db.commit()
    v2 = _save(anonymous_client, world, c, v1, title="Staff Engineer").json()
    assert _stored(test_db, v2["id"]).autofill == {"edited": {"pay-rate": _edit(120, None)}, "custom": []}
    answers = {e["question"]: e["answer"] for e in _open(anonymous_client, world, c, v1["id"], autofill="true")["autofill"]}
    assert answers["What is your full name?"] == "Ravi Teja"


@pytest.mark.parametrize("field", ["qa_bank"])
def test_the_candidate_no_longer_carries_an_answer_bank(anonymous_client, test_db, world, field):
    c = _candidate(anonymous_client, test_db, world)
    assert field not in anonymous_client.get(f"/api/firms/{world['firm'].id}/candidates/{c['id']}",
                                             headers=world["as"]["owner"]).json()
