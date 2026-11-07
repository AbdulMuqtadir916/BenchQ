"""Résumé autofill (decided 2026-11-07): each version's `{question: answer}` from the version and the profile;
written on create, save and promote, rewritten on a profile edit, the years worked out again when one version is read."""
import uuid
from datetime import date

import pytest

from backend.candidates.autofill import YEARS, build, for_reading, years_from_work
from backend.tests.test_candidates_api import world  # noqa: F401  (the fixture)
from backend.tests.test_resume_versions import _candidate, _pdf, _save, _url, _v, parser  # noqa: F401

TODAY = date(2026, 10, 27)


def _job(start, end, current=False):
    return {"job_title": "", "company": "", "start": start, "end": end, "current": current, "bullets": []}


def test_years_follow_the_new_candidate_forms_rule():
    """The same cases as src/lib/api/dto/resume-parse.test.ts (`yearsFromWork`), the same answers."""
    assert years_from_work([_job("2020-01", "2021-12")], TODAY) == 2
    assert years_from_work([_job("2020-01", "2021-12"), _job("2021-01", "2022-12")], TODAY) == 3
    assert years_from_work([_job("2020-01", "2020-12"), _job("2022-01", "2022-12")], TODAY) == 2
    assert years_from_work([_job("2024-10", "", True)], TODAY) == 2
    assert years_from_work([_job("2019", "2020")], TODAY) == 1
    assert years_from_work([_job("", "2020-05"), _job("2023-01", "2022-01")], TODAY) is None
    assert years_from_work([], TODAY) is None


VERSION = {
    "full_name": "Ravi Teja", "email": "ravi@example.test", "phone": "+1 555 0100", "linkedin": "", "github": None,
    "city": "Irving", "state": "TX", "country": "US", "title": "Java Developer", "summary": "Nine years of Java.",
    "work_authorization": "H-1B", "skills": [{"id": "s1", "category": "Languages", "name": "Java"}],
    "experiences": [{"id": "e1", "job_title": "Senior Java Developer", "company": "Capital Payments",
                     "location": "Irving, TX", "start": "2021-03", "end": "", "current": True,
                     "bullets": [{"id": "b1", "text": "Built the payments API."}]},
                    {"id": "e2", "job_title": "Java Developer", "company": "Acme", "location": "", "start": "2018",
                     "end": "2021", "current": False, "bullets": []}],
    "educations": [{"id": "d1", "degree": "B.Tech", "institution": "JNTU", "graduation_date": "May 2017", "grade": ""}],
    "projects": [{"id": "p1", "name": "Ledger", "url": "", "dates": "2023", "technologies": "Kafka",
                  "bullets": [{"id": "b2", "text": "Designed it."}]}],
    "awards": [{"id": "a1", "name": "Star Performer", "issuer": "Capital Payments", "date": "2023", "detail": ""}],
    "certifications": [{"id": "c1", "name": "AWS Developer", "issuer": "Amazon", "date": "2022", "detail": ""}],
    "languages": [{"id": "l1", "name": "English"}],
}
CANDIDATE = {
    "work_auth_expiry": None, "needs_sponsorship": True, "needs_transfer": False, "years_experience": 9,
    "primary_role": "Java Developer", "target_roles": ["Java Developer", "Backend Engineer"], "rate_target": 85,
    "available_from": None, "notice_period_days": 14, "willing_to_relocate": False, "employment_types": ["C2C", "TEEN99"],
    "work_settings": ["REMOTE", "ONSITE"], "preferred_locations": ["Dallas, TX"], "preferred_industries": [],
    # The firm's own, never in the autofill:
    "rate_min": 70, "contact_notes": "Call after 6pm.", "deal_breakers": ["No travel"], "status": "ON_BENCH",
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
        "What is your work authorization?": "H-1B",                      # the résumé's own text
        "What are your skills?": ["Java"],
        "Who is your current or most recent employer?": "Capital Payments",
        "What is your current or most recent job title?": "Senior Java Developer",
        "List your work experience.": [
            {"company": "Capital Payments", "title": "Senior Java Developer", "location": "Irving, TX",
             "start": "2021-03", "current": True, "bullets": ["Built the payments API."]},
            {"company": "Acme", "title": "Java Developer", "start": "2018", "end": "2021", "current": False}],
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
    assert "Call after 6pm" not in text and "No travel" not in text and "ON_BENCH" not in text and "70" not in text


def test_years_fall_back_to_the_profile_and_reading_works_them_out_for_today():
    no_dates = {**VERSION, "experiences": [_job("", "")]}
    assert build(CANDIDATE, no_dates, TODAY)[YEARS] == 9                 # the profile's number
    stored = build(CANDIDATE, VERSION, TODAY)
    assert for_reading(stored, CANDIDATE, VERSION, date(2027, 10, 27))[YEARS] == 9    # a year later, the current job
    assert for_reading(stored, {**CANDIDATE, "years_experience": None}, no_dates, TODAY).get(YEARS) is None


# ── Through the API ──────────────────────────────────────────────────────────

def _stored(test_db, version_id):
    from backend.models.db import Resume
    test_db.expire_all()
    return test_db.get(Resume, uuid.UUID(version_id)).autofill


def test_create_upload_save_and_promote_each_write_the_versions_autofill(anonymous_client, test_db, world, parser):
    c = _candidate(anonymous_client, test_db, world, bde="adnan")
    v1 = _v(anonymous_client, world, c, who="adnan")
    first = _stored(test_db, v1["id"])
    assert first["What is your full name?"] == "Ravi Teja" and first["What is your work authorization?"] == "H-1B"
    assert first["Will you now or in the future require visa sponsorship?"] is True
    assert first["List your work experience."][0]["company"] == "Capital Payments"

    saved = _save(anonymous_client, world, c, v1, "adnan", title="Staff Engineer").json()
    assert _stored(test_db, saved["id"])["What is your professional title?"] == "Staff Engineer"   # its own text
    assert _stored(test_db, v1["id"])["What is your professional title?"] == "Java Developer"      # v1 keeps its own

    assert anonymous_client.post(_url(world, c, "/upload"), files=_pdf(), headers=world["as"]["adnan"]).status_code == 201
    upload_v1 = _v(anonymous_client, world, c, base_number=2, who="adnan")
    assert _stored(test_db, upload_v1["id"])["What is your full name?"] == "Ravi T"                 # the file's

    r = anonymous_client.post(_url(world, c, f"/{saved['id']}/use-as-base"), headers=world["as"]["adnan"])
    assert r.status_code in (200, 201), r.text
    promoted = _v(anonymous_client, world, c, base_number=3, who="adnan")
    assert _stored(test_db, promoted["id"])["What is your professional title?"] == "Staff Engineer"


def test_a_profile_edit_rewrites_every_versions_profile_answers_and_keeps_their_own(anonymous_client, test_db, world):
    c = _candidate(anonymous_client, test_db, world)
    v1 = _v(anonymous_client, world, c)
    v2 = _save(anonymous_client, world, c, v1, title="Staff Engineer").json()
    r = anonymous_client.patch(f"/api/firms/{world['firm'].id}/candidates/{c['id']}", headers=world["as"]["owner"],
                               json={"rate_target": 95, "willing_to_relocate": True})
    assert r.status_code == 200, r.text
    for version, title in ((v1, "Java Developer"), (v2, "Staff Engineer")):
        answers = _stored(test_db, version["id"])
        assert answers["What is your expected rate?"] == 95 and answers["Are you willing to relocate?"] is True
        assert answers["What is your professional title?"] == title


def test_only_opening_one_version_returns_the_autofill(anonymous_client, test_db, world):
    c = _candidate(anonymous_client, test_db, world)
    opened = _v(anonymous_client, world, c)
    assert opened["autofill"]["What is your full name?"] == "Ravi Teja"
    assert opened["autofill"][YEARS] == years_from_work(
        [{"start": "2021-03", "end": "", "current": True}, {"start": "2018", "end": "2021"}], date.today())
    by_id = anonymous_client.get(f"/api/firms/{world['firm'].id}/resumes/{opened['id']}", headers=world["as"]["owner"])
    assert by_id.json()["autofill"] == opened["autofill"]
    listing = anonymous_client.get(_url(world, c), headers=world["as"]["owner"]).json()
    assert all("autofill" not in v for base in listing["bases"] for v in base["versions"])
    saved = _save(anonymous_client, world, c, opened, summary="Shorter.").json()
    assert "autofill" not in saved


@pytest.mark.parametrize("field", ["qa_bank"])
def test_the_candidate_no_longer_carries_an_answer_bank(anonymous_client, test_db, world, field):
    c = _candidate(anonymous_client, test_db, world)
    assert field not in anonymous_client.get(f"/api/firms/{world['firm'].id}/candidates/{c['id']}",
                                             headers=world["as"]["owner"]).json()
