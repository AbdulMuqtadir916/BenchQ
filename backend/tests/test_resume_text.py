"""A résumé version as text, and the readers that use it (docs/team/resume-versioning.md §4.8; PR 6): job scoring
against each candidate's active base, interview prep, and cover letters reading the columns."""
from types import SimpleNamespace

from backend.candidates.resume_text import resume_text


def _version(**over):
    values = dict(full_name="Asha Rao", title="Senior Java Developer", city="Irving", state="TX", country="USA",
                  email="asha@example.test", phone="", linkedin="https://linkedin.com/in/asha", github="",
                  summary="Nine years of Java.", category="BASE", version=1, name="Base",
                  skills=[{"id": "s1", "category": "Languages", "name": "Java"},
                          {"id": "s2", "category": "Languages", "name": "Go"},
                          {"id": "s3", "category": "", "name": "Kafka"}],
                  experiences=[{"id": "e1", "job_title": "Java Developer", "company": "Capital Payments",
                                "location": "Irving, TX", "dates": "2021 – Present",
                                "bullets": [{"id": "b1", "text": "Built the payments API."}]}],
                  projects=[{"id": "p1", "name": "Ledger", "technologies": "Kafka", "dates": "2023",
                             "bullets": [{"id": "pb1", "text": "Designed it."}]}],
                  educations=[{"id": "d1", "degree": "B.Tech", "institution": "JNTU", "graduation_date": "2017",
                               "grade": ""}],
                  certifications=[{"id": "c1", "name": "AWS Developer", "issuer": "Amazon", "date": "2022",
                                   "detail": ""}],
                  awards=[{"id": "a1", "name": "Star Performer", "issuer": "", "date": "", "detail": "Top 1%"}],
                  languages=[{"id": "l1", "name": "Telugu"}])
    return SimpleNamespace(**{**values, **over})


def test_every_printed_section_is_in_the_text_and_languages_are_not():
    text = resume_text(_version())
    assert text.splitlines()[:3] == ["Asha Rao", "Senior Java Developer",
                                     "asha@example.test | https://linkedin.com/in/asha | Irving, TX, USA"]
    for line in ("## Summary", "Nine years of Java.", "## Experience",
                 "Java Developer at Capital Payments (2021 – Present) — Irving, TX", "- Built the payments API.",
                 "## Skills", "Languages: Java, Go", "Skills: Kafka", "## Education", "B.Tech — JNTU, 2017",
                 "## Projects", "Ledger: Kafka, 2023", "- Designed it.", "## Certifications",
                 "AWS Developer — Amazon — 2022", "## Awards", "Star Performer: Top 1%"):
        assert line in text.splitlines(), line
    assert "Telugu" not in text


def test_empty_sections_are_left_out():
    text = resume_text(_version(summary=None, experiences=[], projects=[], educations=[], certifications=[],
                                awards=[], skills=[]))
    assert "##" not in text


def test_job_scoring_uses_each_candidates_active_base_named_after_them(test_db, accounts):
    """Until the job module: every candidate's workflow résumé, labelled with their name; not their other versions,
    not another firm's, not the platform-wide default (gone)."""
    from backend.analyzer.cv_scorer import _get_resume_texts
    from backend.models.candidates import BaseResume, Candidate
    from backend.models.db import Resume, Setting
    from backend.models.tenancy import Firm
    from backend.tests.auth_support import make_firm, make_user
    firm = test_db.get(Firm, accounts.firm_id)
    manager = make_user(test_db, firm, email="m@acme.test", role="MANAGER")

    def candidate(name, firm_id=firm.id, manager_id=manager.id):
        c = Candidate(firm_id=firm_id, manager_id=manager_id, created_by_user_id=manager_id, full_name=name,
                      work_auth="H1B")
        test_db.add(c)
        test_db.flush()
        base = BaseResume(firm_id=firm_id, candidate_id=c.id, source="PROMOTED", is_active=True,
                          created_by_user_id=manager_id)
        test_db.add(base)
        test_db.flush()
        for n in (1, 2):
            test_db.add(Resume(firm_id=firm_id, candidate_id=c.id, base_resume_id=base.id, category="BASE", version=n,
                               name="Base", full_name=name, summary=f"{name} v{n}", created_by_user_id=manager_id))
        test_db.flush()

    candidate("Asha Rao")
    candidate("Ravi Teja")
    from backend.models.tenancy import Plan
    other = make_firm(test_db, test_db.get(Plan, firm.plan_id), slug="globex", name="Globex")
    candidate("Globex person", other.id, make_user(test_db, other, email="m@globex.test", role="MANAGER").id)
    test_db.add(Setting(key="default_resume_id", value="no-longer-read"))
    test_db.commit()

    texts = _get_resume_texts(test_db, firm.id)
    assert set(texts) == {"Asha Rao", "Ravi Teja"}
    assert "Asha Rao v1" in texts["Asha Rao"] and "v2" not in texts["Asha Rao"]


def test_a_cover_letter_takes_its_header_from_the_version():
    from backend.api.routes_cover_letters import letter_header
    header = letter_header(_version(phone="+1 555 0100", github="github.com/asha"))
    assert header["name"] == "Asha Rao"
    assert [(i["text"], i["url"]) for i in header["contact_items"]] == [
        ("Irving, TX, USA", ""), ("asha@example.test", "mailto:asha@example.test"), ("+1 555 0100", ""),
        ("linkedin.com/in/asha", "https://linkedin.com/in/asha"), ("github.com/asha", "https://github.com/asha")]
