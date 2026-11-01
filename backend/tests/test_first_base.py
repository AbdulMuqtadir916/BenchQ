"""A new candidate's first base résumé (docs/team/resume-versioning.md §4.2; PR 4): creating a candidate from an upload
writes its base and version 1 in the same transaction, from the corrected form and the parse; any failure saves
nothing; no upload, no base."""
from datetime import timedelta

import pytest

from backend.tests.test_candidates_api import _create, world  # noqa: F401  (the fixture)

PARSE = {
    "header": {"name": "Ravi T", "title": "Java Dev", "city": "Irving", "state": "TX", "country": "USA",
               "email": "ravi@old.test", "phone": "", "work_authorization": "H1B visa",
               "github": "https://github.com/ravi", "linkedin": ""},
    "professional_summary": "The parser's summary.",
    "technical_skills": [{"category": "Languages", "skills": "Java, Go"}],
    "work_experience": [
        {"job_title": "Senior Java Developer", "company": "Capital Payments", "location": "Irving, TX",
         "dates": "Mar 2021 – Present", "start": "2021-03", "end": "", "current": True,
         "bullets": ["Built the payments API.", "Cut latency 40%.", " "]},
        {"job_title": "Java Developer", "company": "Acme", "location": "", "dates": "2018 – 2021", "start": "2018",
         "end": "2021", "current": False, "bullets": ["Wrote the batch jobs."]}],
    "projects": [{"name": "Ledger", "url": "", "dates": "2023", "technologies": "Kafka", "bullets": ["Designed it."]}],
    "education": [{"degree": "B.Tech", "institution": "JNTU", "graduation_date": "2017", "grade": ""}],
    "certifications": [{"name": "AWS Developer", "issuer": "Amazon Web Services", "date": "2022", "detail": ""}],
    "awards": [{"name": "Star Performer", "issuer": "Capital Payments", "date": "2023", "detail": ""}],
    "languages": ["English", "Telugu"],
}


def _upload(test_db, world, parse=PARSE):
    from backend.models.candidates import ResumeParse
    from backend.models.db import utcnow
    row = ResumeParse(firm_id=world["firm"].id, uploaded_by_user_id=world["people"]["fatima"].id, file_name="r.pdf",
                      mime_type="application/pdf", size_bytes=1, content=b"x", parse=parse,
                      expires_at=utcnow() + timedelta(minutes=30))
    test_db.add(row)
    test_db.commit()
    return row


def _rows(test_db, candidate_id):
    from backend.models.candidates import BaseResume
    from backend.models.db import Resume
    return (test_db.query(BaseResume).filter(BaseResume.candidate_id == candidate_id).all(),
            test_db.query(Resume).filter(Resume.candidate_id == candidate_id).all())


def test_a_create_from_an_upload_writes_its_active_base_and_version_1(anonymous_client, test_db, world):
    upload = _upload(test_db, world)
    r = _create(anonymous_client, world, resume_parse_id=str(upload.id), primary_role="Senior Java Developer",
                skills=[{"name": "Java", "family": "Languages", "source": "RESUME_UPLOAD"},
                        {"name": "Spring Boot", "family": None, "source": "MANUAL"}])
    assert r.status_code == 201, r.text
    (base,), (v1,) = _rows(test_db, r.json()["id"])
    assert (base.source, base.resume_parse_id, base.is_active) == ("UPLOAD", upload.id, True)
    assert (base.firm_id, str(base.candidate_id)) == (world["firm"].id, r.json()["id"])
    assert base.created_by_user_id is not None and v1.created_by_user_id == base.created_by_user_id
    assert (v1.base_resume_id, v1.firm_id, v1.category, v1.version, v1.name, v1.is_base, v1.job_id, v1.json_data) == \
        (base.id, world["firm"].id, "BASE", 1, "Base", True, None, {})


def test_version_1_takes_the_corrected_form_and_the_parse_for_the_rest(anonymous_client, test_db, world):
    upload = _upload(test_db, world)
    r = _create(anonymous_client, world, resume_parse_id=str(upload.id), primary_role="Senior Java Developer",
                city="Dallas", summary="Corrected summary.", phone="+1 214 555 0100",
                skills=[{"name": "Java", "family": "Languages", "source": "RESUME_UPLOAD"},
                        {"name": "AWS (ECS, Lambda)", "family": "Cloud", "source": "MANUAL"}])
    (_,), (v1,) = _rows(test_db, r.json()["id"])
    # The form, as corrected.
    assert (v1.full_name, v1.title, v1.email, v1.phone, v1.city, v1.summary) == (
        "Ravi Teja", "Senior Java Developer", "ravi@example.com", "+1 214 555 0100", "Dallas", "Corrected summary.")
    assert v1.work_authorization == "H-1B"                      # the form's code, in the app's own label
    assert [(s["category"], s["name"]) for s in v1.skills] == [("Languages", "Java"), ("Cloud", "AWS (ECS, Lambda)")]
    # The parse, for what the form doesn't hold.
    assert (v1.country, v1.github) == ("USA", "https://github.com/ravi")
    assert [(e["job_title"], e["company"], e["current"], [b["text"] for b in e["bullets"]]) for e in v1.experiences] == [
        ("Senior Java Developer", "Capital Payments", True, ["Built the payments API.", "Cut latency 40%."]),
        ("Java Developer", "Acme", False, ["Wrote the batch jobs."])]
    assert [p["name"] for p in v1.projects] == ["Ledger"] and v1.educations[0]["institution"] == "JNTU"
    assert v1.certifications[0] | {"id": "-"} == {"id": "-", "name": "AWS Developer", "issuer": "Amazon Web Services",
                                                  "date": "2022", "detail": ""}
    assert [a["name"] for a in v1.awards] == ["Star Performer"] and [lang["name"] for lang in v1.languages] == [
        "English", "Telugu"]


def test_every_item_has_its_own_id(anonymous_client, test_db, world):
    upload = _upload(test_db, world)
    r = _create(anonymous_client, world, resume_parse_id=str(upload.id))
    (_,), (v1,) = _rows(test_db, r.json()["id"])
    items = (v1.skills + v1.experiences + v1.projects + v1.educations + v1.certifications + v1.awards + v1.languages
             + [b for e in v1.experiences + v1.projects for b in e["bullets"]])
    ids = [item["id"] for item in items]
    assert len(ids) == 13 and len(set(ids)) == len(ids)       # 1 skill, 2 jobs, 1 project, 1 school, 1 cert, 1 award,
                                                               # 2 languages, 4 bullets


def test_no_upload_no_base(anonymous_client, test_db, world):
    r = _create(anonymous_client, world)
    assert r.status_code == 201
    assert _rows(test_db, r.json()["id"]) == ([], [])


def test_other_work_authorization_keeps_the_resumes_own_words(anonymous_client, test_db, world):
    upload = _upload(test_db, world)
    r = _create(anonymous_client, world, resume_parse_id=str(upload.id), work_auth="OTHER")
    (_,), (v1,) = _rows(test_db, r.json()["id"])
    assert v1.work_authorization == "H1B visa"


def test_two_candidates_each_get_their_own_base(anonymous_client, test_db, world):
    for name in ("Ravi Teja", "Asha Rao"):
        upload = _upload(test_db, world)
        assert _create(anonymous_client, world, resume_parse_id=str(upload.id), full_name=name,
                       email=f"{name.split()[0].lower()}@example.com").status_code == 201
    from backend.models.candidates import BaseResume
    assert test_db.query(BaseResume).filter(BaseResume.is_active).count() == 2


def test_a_failure_saves_nothing(anonymous_client, test_db, world, monkeypatch):
    """A version 1 the database refuses (here: a base with a job) rolls back the candidate and the kept parse too."""
    import uuid
    from backend.api import routes_candidates
    from backend.candidates import first_base as fb
    from backend.models.candidates import BaseResume, Candidate, ResumeParse

    def broken(parse_row, candidate, body, user_id):
        base, version = fb.first_base(parse_row, candidate, body, user_id)
        version.job_id = uuid.uuid4()                         # no such job, and a BASE may not have one
        return base, version

    monkeypatch.setattr(routes_candidates, "first_base", broken)
    upload = _upload(test_db, world)
    with pytest.raises(Exception):
        _create(anonymous_client, world, resume_parse_id=str(upload.id))
    test_db.expire_all()
    assert test_db.query(Candidate).filter(Candidate.full_name == "Ravi Teja").count() == 0
    assert test_db.query(BaseResume).count() == 0
    kept = test_db.get(ResumeParse, upload.id)
    assert kept.candidate_id is None and kept.expires_at is not None          # still waiting for a create
