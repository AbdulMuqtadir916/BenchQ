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
        YEARS: 8,                                                        # from the jobs: 2018-01 to 2026-10
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
    assert all(re.fullmatch(r"[a-z]+(-[a-z]+)*", key) for key in QUESTIONS)


def _edit(answer, over):
    return {"answer": answer, "over": over}


def test_the_users_entry_wins_and_every_answer_says_what_it_is():
    typed = {"edited": {"pay-rate": _edit(95, 85), "github-url": _edit("github.com/ravi", None)},
             "custom": {"Why do you want to work here?": "Payments."}}
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
])
def test_anything_else_stored_reads_as_no_entries(stored):
    entries = merged(CANDIDATE, {**VERSION, "autofill": stored}, TODAY)
    assert all(entry["kind"] == "FIXED" for entry in entries)
    assert entries[0]["answer"] == "Ravi Teja" and entries_of({"autofill": stored}) == {}


def test_a_custom_question_in_a_fixed_questions_words_is_kept_and_shows_while_that_one_has_no_answer():
    """A question added or reworded here can take the words of one the user typed before (Abdul's third review): the
    entry stays, so a save copies it on, and the read shows the fixed question while it has an answer."""
    notice = "What is your notice period in days?"
    typed = {"custom": {notice: "30, negotiable", "What is your full name?": "Someone Else", "Why us?": "Payments."}}
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
             "custom": {"Why do you want to work here?": "Payments.",
                        "What is your notice period in days?": "30, negotiable"}}     # in a fixed question's words
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
                                                           "key": "professional-title"}

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
    assert _stored(test_db, v2["id"]).autofill == {"edited": {"pay-rate": _edit(120, None)}, "custom": {}}
    answers = {e["question"]: e["answer"] for e in _open(anonymous_client, world, c, v1["id"], autofill="true")["autofill"]}
    assert answers["What is your full name?"] == "Ravi Teja"


@pytest.mark.parametrize("field", ["qa_bank"])
def test_the_candidate_no_longer_carries_an_answer_bank(anonymous_client, test_db, world, field):
    c = _candidate(anonymous_client, test_db, world)
    assert field not in anonymous_client.get(f"/api/firms/{world['firm'].id}/candidates/{c['id']}",
                                             headers=world["as"]["owner"]).json()
