"""What freehire.me is asked for a candidate's titles (decided 2026-11-21): level words go to `seniority`, Lead, Staff
and Principal titles stay as typed, Developer also searches Engineer, and six technologies get a title check. Pure."""
import pytest

from backend.job_search.freehire_titles import plan
from backend.match import score as match
from backend.match import seniority
from backend.match.ats_match_terms import ResumeFacts


@pytest.mark.parametrize("typed, alternatives, levels", [
    ("Sr Full Stack Developer", ["Full Stack Developer", "Full Stack Engineer"], ["senior"]),
    ("Sr. .NET Developer", [".NET Developer", ".NET Engineer"], ["senior"]),
    ("Snr Java Developer", ["Java Developer", "Java Engineer"], ["senior"]),
    ("Python Developer - Senior", ["Python Developer", "Python Engineer"], ["senior"]),
    ("Java Developer (Senior)", ["Java Developer", "Java Engineer"], ["senior"]),
    ("Mid-Level .NET Developer", [".NET Developer", ".NET Engineer"], ["middle"]),
    ("Mid Level Java Developer", ["Java Developer", "Java Engineer"], ["middle"]),
    ("Intermediate Java Developer", ["Java Developer", "Java Engineer"], ["middle"]),
    ("Jr. Python Developer", ["Python Developer", "Python Engineer"], ["junior"]),
    ("Junior Data Analyst", ["Data Analyst"], ["junior"]),
    ("Data Analyst Intern", ["Data Analyst"], ["intern"]),
    ("Sr Full Stack Engineer", ["Full Stack Engineer"], ["senior"]),         # Engineer never brings Developer
    ("Sr DevOps Engineer", ["DevOps Engineer"], ["senior"]),
    ("Sr Business Systems Analyst", ["Business Systems Analyst"], ["senior"]),
    ("Sr C++ Developer", ["C++ Developer", "C++ Engineer"], ["senior"]),
    ("Technical Lead", ["Technical Lead"], []),
    ("QA Lead", ["QA Lead"], []),
    ("Senior Technical Lead", ["Senior Technical Lead"], []),
    ("Senior Staff Engineer", ["Senior Staff Engineer"], []),
    ("Principal Architect", ["Principal Architect"], []),
    ("Lead Java Developer", ["Lead Java Developer"], []),                    # as typed: no Engineer added
    ("Internal Tools Developer", ["Internal Tools Developer", "Internal Tools Engineer"], []),
    ("Senior", ["Senior"], []),
])
def test_a_title_is_read_into_the_search(typed, alternatives, levels):
    asked = plan([typed])
    assert list(asked.alternatives) == alternatives and list(asked.levels) == levels


def test_real_titles_come_before_the_added_ones_within_five():
    asked = plan(["Sr Java Developer", "Backend Developer", "API Developer", "Platform Developer", "Cloud Developer"])
    assert list(asked.alternatives) == ["Java Developer", "Backend Developer", "API Developer", "Platform Developer",
                                        "Cloud Developer"]
    assert list(plan(["Sr Java Developer", "Backend Engineer"]).alternatives) == [
        "Java Developer", "Backend Engineer", "Java Engineer"]


def test_the_seniority_asked_for():
    assert plan(["Sr Java Developer"]).seniority("mid") == ["senior"]                # the title's word wins
    assert plan(["Java Developer"]).seniority("senior") == ["senior"]
    assert plan(["Java Developer"]).seniority("lead") == ["senior", "lead", "staff"]
    assert plan(["Java Developer"]).seniority("entry") == ["intern", "junior"]
    assert plan(["Senior Staff Engineer"]).seniority("lead") == ["senior", "lead", "staff"]
    assert plan(["Java Developer"]).seniority(None) == []


@pytest.mark.parametrize("typed, kept, left_out", [
    ("Sr C++ Developer", ["Senior C++ Engineer", "C++ Developer"], ["Senior C# Developer", "C-BRAIN Software Developer"]),
    ("Senior C# Developer", ["Senior C# Back-End Developer"], ["Senior C++ Developer", "Senior C Developer"]),
    ("C Developer", ["Senior C Developer", "Embedded C/C++ Engineer", "Senior Software Engineer - C"],
     ["Senior C# Developer", "C-BRAIN Developer", "P&C Senior Test Engineer", "Senior I&C Engineer",
      "Senior Project Engineer - Washington D.C."]),
    ("R Developer", ["Senior R Developer", "Python/R Engineer"],
     ["R&D Senior Engineer", "Engineer, Axon 911 R &D", "Engineer III Maintenance Engineer (HVAC/R)",
      "WISSENSCHAFTLICHE*R MITARBEITER*IN Ontology Engineer"]),
    ("F# Developer", ["F# Developer"], ["Senior D365 F& O Developer"]),
    ("Go Developer", ["Senior Go Engineer", "Golang Developer", "Software Engineer - Go/Golang"],
     ["Go-To-Market Engineer", "Java Developer", "Sr. AI Engineer - Need locals who can go for face to face"]),
])
def test_a_symbol_technology_is_checked_in_the_jobs_title(typed, kept, left_out):
    asked = plan([typed])
    assert asked.checked and all(asked.keeps(title) for title in kept)
    assert not any(asked.keeps(title) for title in left_out)


def test_other_technologies_get_no_title_check():
    for typed in (".NET Developer", "Node.js Developer", "React Developer", "PL/SQL Developer", "Java Developer"):
        assert not plan([typed]).checked


def test_a_checked_search_keeps_jobs_for_its_other_titles():
    asked = plan(["C++ Developer", "Backend Engineer"])
    assert asked.keeps("Senior Backend Engineers") and not asked.keeps("Senior C# Developer")


def _who(years=None, target=(), marketed=""):
    return match.Who(wanted=(*target, marketed), years=years, country="US", work_auth=None, needs_sponsorship=False,
                     needs_transfer=False, employment_types=(), target_titles=tuple(target), marketed_as=marketed)


def test_the_candidates_level_comes_from_the_first_source_that_says():
    resume = ResumeFacts(resume={}, latest_role="Junior Developer", years=12.0)
    assert match.search_level_of(resume, _who(3.0, ["Sr Java Developer"], "Lead Developer")) == "senior"
    assert match.search_level_of(resume, _who(3.0, ["Java Developer"], "Lead Developer")) == "lead"
    assert match.search_level_of(resume, _who(7.0, ["Java Developer"])) == "senior"              # years before the role
    assert match.search_level_of(resume, _who(None, ["Java Developer"])) == "entry"              # the latest role
    plain = ResumeFacts(resume={}, latest_role="Developer", years=12.0)
    assert match.search_level_of(plain, _who(None, ["Java Developer"])) == "lead"                # the résumé's years
    assert match.search_level_of(None, _who(None, ["Java Developer"])) is None


def test_the_years_bands():
    for years, name in ((1.9, "entry"), (2, "mid"), (4.9, "mid"), (5, "senior"), (9.9, "senior"), (10, "lead")):
        assert seniority.NAMES[seniority.for_job_search(["Java Developer"], "", years).lo] == name


def test_matchs_own_order_does_not_change():
    resume = ResumeFacts(resume={}, latest_role="Junior Developer", years=9.0)
    assert match.level_of(resume, _who(9.0, ["Java Developer"])) == "entry"
