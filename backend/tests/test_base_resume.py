"""clean_reply: the base-résumé parser's reply with its values fixed in code, in the response format's own shape
(docs/team/resume-versioning.md §2; the parser handoff, Part 2 §8 and §14 tests 1–15 and 19). Hand-written replies;
no model is called."""
import pytest

from backend.analyzer.model_json import parse_model_json
from backend.candidates.base_resume import clean_reply
from backend.candidates.parse_defaults import BASE_RESUME_SCHEMA

ROLES = [
    {"job_title": "Senior Data Engineer", "company": "Northwind Health", "location": "Austin, TX", "dates": "",
     "start": "2022-03", "end": "", "current": True, "bullets": ["Built the claims lakehouse."]},
    {"job_title": "Data Analyst", "company": "Contoso Retail", "location": "Dallas, TX", "dates": "",
     "start": "2018-06", "end": "2022-02", "current": False, "bullets": ["Wrote the weekly sales report."]},
]


def _reply(**sections):
    header = {"name": "Jane Doe", "title": "", "city": "", "state": "", "country": "", "email": "", "phone": "",
              "work_authorization": "", "github": "", "linkedin": ""} | sections.pop("header", {})
    return {"header": header, "professional_summary": "", "technical_skills": [], "work_experience": [],
            "projects": [], "education": [], "certifications": [], "awards": [], "languages": []} | sections


def _matches(value, schema, path="$"):
    """`value` fits the strict schema exactly: the type of every node, every property present, no extra ones."""
    kind = schema["type"]
    if kind == "object":
        assert isinstance(value, dict), path
        assert set(value) == set(schema["properties"]) == set(schema["required"]), (path, sorted(value))
        assert not any(key.startswith("_") for key in value), path
        for key, sub in schema["properties"].items():
            _matches(value[key], sub, f"{path}.{key}")
    elif kind == "array":
        assert isinstance(value, list), path
        for i, item in enumerate(value):
            _matches(item, schema["items"], f"{path}[{i}]")
    else:
        assert isinstance(value, {"string": str, "boolean": bool}[kind]), path


# ── The headline (§8.3) ──────────────────────────────────────────────────────

def test_1_an_unprinted_headline_becomes_the_most_recent_roles_title():
    reply = _reply(header={"title": "Data Analyst"}, work_experience=ROLES)       # the model picked the oldest role
    source = "Jane Doe\njane@example.com\nPROFESSIONAL SUMMARY\nEight years of data work."
    assert clean_reply(reply, source_text=source)["header"]["title"] == "Senior Data Engineer"


def test_2_a_printed_headline_is_kept_even_when_it_names_an_older_role():
    reply = _reply(header={"title": "Data Analyst"}, work_experience=ROLES)
    source = "Jane Doe\nData Analyst\njane@example.com\nPROFESSIONAL SUMMARY\nEight years of data work."
    assert clean_reply(reply, source_text=source)["header"]["title"] == "Data Analyst"


def test_3_without_the_source_text_the_models_headline_stands():
    reply = _reply(header={"title": "Data Analyst"}, work_experience=ROLES)
    assert clean_reply(reply)["header"]["title"] == "Data Analyst"


# ── Contact details (§8.2) ───────────────────────────────────────────────────

@pytest.mark.parametrize("printed,stored", [("(773) 250-3768", "(773) 250-3768"),
                                            ("+1 (773) 250-3768", "+1 (773) 250-3768"),
                                            ("Phone: 555 123 4567", "555 123 4567")])
def test_4_a_phone_keeps_its_brackets_and_loses_its_label(printed, stored):
    assert clean_reply(_reply(header={"phone": printed}))["header"]["phone"] == stored


def test_5_an_email_loses_its_label():
    assert clean_reply(_reply(header={"email": "Email: a@b.com"}))["header"]["email"] == "a@b.com"


def test_6_a_profile_link_is_a_full_address_or_nothing():
    assert clean_reply(_reply(header={"linkedin": "LinkedIn"}))["header"]["linkedin"] == ""
    assert clean_reply(_reply(header={"linkedin": "linkedin.com/in/x"}))["header"]["linkedin"] == "https://linkedin.com/in/x"


def test_13_city_state_and_country_are_stored_as_given():
    header = clean_reply(_reply(header={"city": "Chicago", "state": "IL", "country": ""}))["header"]
    assert (header["city"], header["state"], header["country"]) == ("Chicago", "IL", "")


# ── Roles, projects, education (§8.2) ────────────────────────────────────────

def test_7_role_dates_print_from_the_iso_pair():
    roles = [ROLES[1] | {"start": "2021-05", "end": "2024-09"}, ROLES[0],
             ROLES[1] | {"start": "", "end": "2025-06", "job_title": "Intern"}]
    dates = [r["dates"] for r in clean_reply(_reply(work_experience=roles))["work_experience"]]
    assert dates == ["May 2021 – Sep 2024", "Mar 2022 – Present", "Jun 2025"]


def test_8_a_role_without_bullets_and_a_blank_education_row_are_dropped():
    blank_school = {"degree": "", "institution": "", "graduation_date": "", "grade": ""}
    school = {"degree": "B.S. Computer Science", "institution": "State University", "graduation_date": "May 2016",
              "grade": ""}
    out = clean_reply(_reply(work_experience=[ROLES[0], ROLES[1] | {"bullets": []}], education=[blank_school, school]))
    assert [r["company"] for r in out["work_experience"]] == ["Northwind Health"]
    assert out["education"] == [school]


def test_14_a_project_keeps_its_dates_and_technologies_apart():
    project = {"name": "Claims Lakehouse", "url": "", "dates": "2023", "technologies": "Databricks, Delta Lake",
               "bullets": ["Designed the medallion layers."]}
    stored = clean_reply(_reply(projects=[project]))["projects"][0]
    assert stored == project and "description" not in stored


# ── Skills, awards, languages (§8.2) ─────────────────────────────────────────

def test_9_each_skill_once_without_merging_by_containment():
    skills = [{"category": "Databases", "skills": "Postgres, SQL, MySQL"},
              {"category": "Cloud", "skills": "PostgreSQL, AWS (ECS, Lambda)"}]
    out = clean_reply(_reply(technical_skills=skills))["technical_skills"]
    items = [item for pair in out for item in pair["skills"].split(", ") if not item.endswith(")")]
    assert items.count("PostgreSQL") == 1                    # "Postgres" respelled and kept once
    assert "SQL" in items and "MySQL" in items               # "SQL" sits inside both, and still stays
    assert any(pair["skills"].endswith("AWS (ECS, Lambda)") for pair in out)    # one item, brackets intact


def test_10_awards_stay_structured_each_once():
    award = {"name": "Dean's List", "issuer": "State University", "date": "May 2016", "detail": "top 5%"}
    repeat = {"name": "dean's  list", "issuer": "State University", "date": "May 2016", "detail": "Top 5%"}
    blank = {"name": "", "issuer": "", "date": "", "detail": ""}
    assert clean_reply(_reply(awards=[award, repeat, blank]))["awards"] == [award]


def test_certifications_are_entries_each_once_by_name_and_issuer():
    """A BenchQ change to the handoff: one string per certification made the model glue its description on."""
    cert = {"name": "Google Cybersecurity Professional Certificate", "issuer": "Google (Coursera)", "date": "",
            "detail": "Threat detection, incident response and SIEM tools."}
    repeat = cert | {"name": "google cybersecurity  professional certificate", "detail": "Other words."}
    blank = {"name": "", "issuer": "Coursera", "date": "", "detail": ""}
    older = "Agentic AI — DeepLearning.AI"                       # the string shape a reply may still send
    assert clean_reply(_reply(certifications=[cert, repeat, blank, older]))["certifications"] == [
        cert, {"name": older, "issuer": "", "date": "", "detail": ""}]


def test_11_languages_are_stored_each_once():
    out = clean_reply(_reply(languages=["English (Native)", "english (native)", "Spanish"]))
    assert out["languages"] == ["English (Native)", "Spanish"]


def test_12_no_awards_and_no_languages_are_empty_lists():
    out = clean_reply(_reply())
    assert (out["awards"], out["languages"]) == ([], [])


# ── The shape (§9) ───────────────────────────────────────────────────────────

@pytest.mark.parametrize("reply", [None, "x", {}], ids=["None", "a string", "an empty dict"])
def test_15_a_broken_reply_still_fits_the_format_with_every_key_empty(reply):
    out = clean_reply(reply)
    _matches(out, BASE_RESUME_SCHEMA)
    assert out["header"]["name"] == "" and out["work_experience"] == []


def test_15_a_full_reply_fits_the_format_exactly():
    reply = _reply(header={"title": "Senior Data Engineer", "city": "Austin", "state": "TX", "email": "jane@example.com",
                           "phone": "(512) 555-0100", "github": "github.com/janedoe"},
                   professional_summary="Accomplished data engineer.", work_experience=ROLES,
                   technical_skills=[{"category": "Languages", "skills": "Python, SQL"}],
                   projects=[{"name": "Lakehouse", "url": "github.com/janedoe/lake", "dates": "2023",
                              "technologies": "Databricks", "bullets": ["Designed it."]}],
                   education=[{"degree": "B.S.", "institution": "State University", "graduation_date": "2016",
                               "grade": ""}],
                   certifications=[{"name": "AWS Certified Data Engineer", "issuer": "Amazon Web Services", "date": "2024",
                                    "detail": ""}], languages=["English"],
                   awards=[{"name": "Dean's List", "issuer": "", "date": "", "detail": ""}])
    out = clean_reply(reply, source_text="Jane Doe\nSenior Data Engineer\nSUMMARY")
    _matches(out, BASE_RESUME_SCHEMA)
    assert list(out) == BASE_RESUME_SCHEMA["required"]                  # the format's own order
    assert out["header"]["github"] == "https://github.com/janedoe"


# ── The tolerant reader (§8.1) ───────────────────────────────────────────────

def test_19_junk_after_the_object_is_ignored():
    assert parse_model_json('{"a":1} junk {"b":') == {"a": 1}
