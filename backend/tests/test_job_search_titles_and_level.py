"""A search asks for every title of the candidate's role (decided 2026-11-16, Q69) and leaves out jobs at the wrong level
(Q70, Q74): "A | B" and "GenAI / LLM Engineer" are split the way Match reads a title; Indeed gets them in quotes
joined by OR, freehire.me as title alternatives with the years the candidate can take; a job Match holds at 40 for far
more years asked, or a level two rungs away, is left out and counted. Fakes only; every job is made up."""
import asyncio
import uuid

from backend.job_search import pipeline, places
from backend.job_search.providers.base import quoted_or
from backend.job_search.providers.freehire import title_query
from backend.match import score as match
from backend.match.ats_match_terms import ResumeFacts
from backend.models.job_search import ScrapeJob
from backend.tests.test_candidates_api import _create, world  # noqa: F401  (the fixture)
from backend.tests.test_job_search_api import _job, _post, _run, adnans, fake, launched  # noqa: F401  (fixtures)
from backend.tests.test_job_search_indeed import _page, indeed  # noqa: F401  (the fixture)
from backend.tests.test_job_search_indeed import _job as indeed_job

ROLE = "GenAI / LLM Engineer | Python Backend Engineer"
TITLES = ["GenAI Engineer", "LLM Engineer", "Python Backend Engineer"]


def test_the_role_is_split_into_its_titles():
    candidate = type("C", (), {"target_roles": [ROLE]})()
    assert places.search_titles(candidate) == TITLES
    assert places.search_titles(type("C", (), {"target_roles": ["Senior Java Developer"]})()) == ["Senior Java Developer"]
    assert places.search_titles(type("C", (), {"target_roles": []})()) == []


def test_the_search_carries_the_titles(anonymous_client, world, launched, test_db):
    candidate = _create(anonymous_client, world, bde="adnan", target_roles=[ROLE]).json()
    assert _post(anonymous_client, world, candidate).status_code == 202
    assert launched[-1]["kwargs"]["titles"] == TITLES
    batch = test_db.query(ScrapeJob).filter(ScrapeJob.candidate_id == uuid.UUID(candidate["id"])).one()
    assert batch.meta["request"]["titles"] == TITLES and batch.meta["request"]["query"] == ROLE


def test_indeed_gets_the_titles_in_quotes_joined_by_or(indeed):
    from backend.job_search.providers.indeed import Indeed
    fake = indeed([_page([indeed_job("a1")])])
    asyncio.run(Indeed().search(ROLE, "us", 100, None, place="Austin, TX", posted_within_days=14, titles=TITLES))
    assert 'what: "\\"GenAI Engineer\\" OR \\"LLM Engineer\\" OR \\"Python Backend Engineer\\""' in fake.query()


def test_freehire_gets_every_title_as_a_title_alternative():
    assert quoted_or(TITLES) == '"GenAI Engineer" OR "LLM Engineer" OR "Python Backend Engineer"'
    assert title_query(ROLE, TITLES) == 'title:"GenAI Engineer" OR title:"LLM Engineer" OR title:"Python Backend Engineer"'
    assert title_query(ROLE, ["Java Developer"]) == 'title:"Java Developer" OR title:"Java Engineer"'
    assert quoted_or(["Java Developer"]) is None


def test_the_most_years_a_job_may_ask():
    who = lambda years: match.Who(wanted=(), years=years, country="US", work_auth=None, needs_sponsorship=False,  # noqa: E731
                                  needs_transfer=False, employment_types=())
    assert match.most_years_asked(None, who(0.0)) == 2            # entry level: 2 more years
    assert match.most_years_asked(None, who(9.0)) == 12           # 9 + 40%
    assert match.most_years_asked(None, who(None)) is None        # not known: no filter
    assert match.most_years_asked(ResumeFacts(resume={}, years=4.0), who(None)) == 6


def test_a_job_at_the_wrong_level_is_left_out_and_counted(world, adnans, fake, test_db):
    """The test candidate has 9 years: an entry-level title ("… 1") is two rungs below, and 15 years is far above."""
    fake.jobs = [_job(1), _job(2, t="Java Developer 1"), _job(3, d="Build Java services. 15+ years of Java required.")]
    assert _run(world, adnans) == "1 new, 0 seen again"
    batch = test_db.query(ScrapeJob).filter(ScrapeJob.candidate_id == uuid.UUID(adnans["id"])).one()
    assert batch.meta["counts"]["skipped_level"] == 2


def test_the_candidates_level_as_a_search_asks_for_it():
    """Q96, Q99: Match's own reading of the candidate's level, in three buckets."""
    def who(years, wanted=("Java Developer",)):
        return match.Who(wanted=wanted, years=years, country="US", work_auth=None, needs_sponsorship=False,
                         needs_transfer=False, employment_types=())
    assert match.level_of(None, who(0.5)) == "entry"
    assert match.level_of(None, who(3.0)) == "mid"
    assert match.level_of(None, who(9.0)) == "senior"
    assert match.level_of(None, who(9.0, wanted=("Junior Java Developer",))) == "entry"     # the title's word first
    assert match.level_of(None, who(None, wanted=("Java Developer",))) is None


def test_a_job_without_its_text_gets_the_level_check_from_its_title():
    """Q97: a LinkedIn job has no posting text; "Senior" in its title is enough to leave it out for an entry-level
    candidate."""
    from backend.job_search.providers.base import JobFields
    entry = match.Who(wanted=("AI Engineer",), years=0.0, country="US", work_auth=None, needs_sponsorship=False,
                      needs_transfer=False, employment_types=())
    resume = ResumeFacts(resume={}, years=0.0)
    senior = JobFields(title="Senior AI Engineer", company="Example", description="", source_id="linkedin:1")
    plain = JobFields(title="AI Engineer", company="Example", description="", source_id="linkedin:2")
    assert match.score(resume, senior, entry).wrong_level and not match.score(resume, plain, entry).wrong_level
