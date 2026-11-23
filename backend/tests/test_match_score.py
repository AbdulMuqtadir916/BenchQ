"""BenchQ's door into the Match calculator (backend/match/score.py, decided 2026-11-14, Q30–Q37): the candidate as it
reads them, a job's score and the reason it is held at 40, and the work-authorization rules a search leaves jobs out by
(Q32, replacing part 3's four rules). Pure: stand-in candidates and jobs; every sentence is made up."""
from types import SimpleNamespace

import pytest

from backend.match import score as match
from backend.match.ats_match import CAP, VERSION
from backend.match.ats_match_terms import ResumeFacts


def _candidate(**over):
    base = {"target_roles": ["Java Developer"], "primary_role": "Senior Java Developer", "years_experience": 9,
            "work_auth": "H1B", "needs_sponsorship": True, "needs_transfer": True, "employment_types": ["C2C"]}
    return SimpleNamespace(**{**base, **over})


def _job(title="Java Developer", description="", location="Austin, TX", company="Acme"):
    return SimpleNamespace(title=title, description=description, location=location, company=company)


H1B = match.who(_candidate(), "us")
H1B_NO_TRANSFER = match.who(_candidate(needs_transfer=False), "us")
GC = match.who(_candidate(work_auth="GC", needs_sponsorship=False, needs_transfer=False), "us")
GC_EAD = match.who(_candidate(work_auth="GC_EAD", needs_sponsorship=False, needs_transfer=False), "us")
USC = match.who(_candidate(work_auth="USC", needs_sponsorship=False, needs_transfer=False, employment_types=["W2"]), "us")

RESUME = ResumeFacts.read({
    "header": {"title": "Senior Java Developer"},
    "skills": {"Languages": ["Java", "SQL"], "Frameworks": ["Spring Boot", "Hibernate"], "Cloud": ["AWS"]},
    "experience": [{"title": "Senior Java Developer", "company": "Bank", "start_date": "2017-01", "end_date": "Present",
                    "bullets": ["Built Java and Spring Boot microservices on AWS.", "Tuned SQL queries in PostgreSQL."]}],
})
POSTING = ("Required: 5+ years of Java and Spring Boot. Build microservices on AWS. Experience with SQL and PostgreSQL. "
           "Hibernate is a plus.")


def test_who_reads_the_wanted_titles_years_status_and_country():
    got = match.who(_candidate(target_roles=["Java Developer", " "], years_experience=None), None)
    assert got.wanted == ("Java Developer", "Senior Java Developer")
    assert (got.years, got.country, got.work_auth, got.employment_types) == (None, None, "H1B", ("C2C",))
    assert H1B.country == "US" and H1B.years == 9.0


def test_a_fitting_job_scores_high_with_no_note_and_names_the_version():
    got = match.score(RESUME, _job(description=POSTING), USC)
    assert got.score >= 60 and got.note is None and got.version == VERSION


def test_a_job_held_at_40_says_why():
    got = match.score(RESUME, _job(description=POSTING + " No C2C. W2 only."), H1B)
    assert got.score <= CAP and got.note and "C2C" in got.note
    another_subject = match.score(RESUME, _job(title="Sales Account Executive", description="Sell software."), USC)
    assert another_subject.score <= CAP and another_subject.note


def test_the_resume_is_read_the_way_tailoring_reads_a_version():
    facts = match.read_resume({})                     # an empty version still reads: nothing used, nothing listed
    assert isinstance(facts, ResumeFacts) and facts.used == frozenset()


@pytest.mark.parametrize("text", [
    "We do not sponsor visas for this role.", "Unable to sponsor H1B at this time.", "No visa sponsorship available.",
    "Sponsorship is not available.", "We don't offer sponsorship.",
])
def test_no_sponsorship_rules_out_a_candidate_who_needs_it(text):
    assert match.ruled_out(_job(description=text), H1B_NO_TRANSFER) == "no sponsorship"
    assert match.ruled_out(_job(description=text), GC) is None


@pytest.mark.parametrize("text", ["US citizens only.", "Must be a United States citizen.", "Must be US Citizen",
                                  "Visa : Only US citizens and Greencard holders", "USC/GC only."])
def test_citizens_or_green_card_only_rules_out_a_visa_holder(text):
    assert match.ruled_out(_job(description=text), H1B_NO_TRANSFER) is not None
    assert match.ruled_out(_job(description=text), USC) is None


def test_citizens_only_rules_out_a_green_card_holder_and_gc_or_citizens_does_not():
    assert match.ruled_out(_job(description="US citizens only."), GC) == "citizens only"
    assert match.ruled_out(_job(description="US citizens or green card holders only."), GC) is None
    assert match.ruled_out(_job(description="US citizens or green card holders only."), GC_EAD) is not None


def test_an_active_clearance_rules_out_anyone_but_a_citizen():
    text = "Active secret clearance required."
    assert match.ruled_out(_job(description=text), GC) == "clearance"
    assert match.ruled_out(_job(description=text), USC) is None          # whether they hold one isn't recorded


def test_no_transfers_rules_out_a_candidate_who_needs_one():
    assert match.ruled_out(_job(description="No H1B transfers."), H1B) == "no visa transfers"
    assert match.ruled_out(_job(description="No H1B transfers."), H1B_NO_TRANSFER) is None


def test_transfers_welcome_keeps_a_transfer_candidate_when_new_petitions_are_not_offered():
    text = "We are unable to sponsor new H-1B petitions. H-1B transfer candidates are encouraged."
    assert match.ruled_out(_job(description=text), H1B) is None


@pytest.mark.parametrize("text", ["", "Build data pipelines in Python and Spark.",
                                  "We sponsor H-1B visas and welcome transfers.",
                                  "Our customers include US citizens and companies worldwide.",
                                  "No C2C. W2 only."])         # no C2C holds the score at 40; the job is kept
def test_a_job_that_says_nothing_against_the_candidates_status_is_kept(text):
    for who in (H1B, GC_EAD, GC, USC):
        assert match.ruled_out(_job(description=text), who) is None
