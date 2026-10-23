"""F4: a firm user never sees another firm's rows. Lists leave them out, and a path id of another firm answers 404,
the same as a missing row (docs/integration/07-auth-and-tenancy.md F4, principle 4). F7's isolation test covers
every route; these are the cases this PR scoped."""
import pytest

from backend.models.db import Application, CoverLetter, Interview, Job, Resume
from backend.tests.auth_support import make_firm, make_plan


@pytest.fixture
def other_firm_rows(test_db, accounts):
    """A job with an application, an interview, a résumé and a cover letter in firm "globex", not the signed-in
    user's firm ("acme")."""
    other = make_firm(test_db, make_plan(test_db, name="Other plan"), slug="globex").id
    job = Job(external_id="ext-other", title="Engineer", company="Globex", url="https://g.test", source="manual")
    test_db.add(job)
    test_db.flush()
    app = Application(firm_id=other, job_id=job.id, status="applied")
    test_db.add(app)
    test_db.flush()
    interview = Interview(firm_id=other, application_id=app.id, what="Screen")
    resume = Resume(firm_id=other, name="Other base", is_base=True, json_data={"header": {"name": "B"}})
    letter = CoverLetter(firm_id=other, name="Other letter", job_id=job.id, json_data={})
    test_db.add_all([interview, resume, letter])
    test_db.commit()
    return {"job": job, "app": app, "interview": interview, "resume": resume, "letter": letter}


def test_lists_leave_out_another_firms_rows(api_client, other_firm_rows):
    assert api_client.post("/api/resumes", json={"name": "Mine"}).status_code == 201
    assert [r["name"] for r in api_client.get("/api/resumes").json()] == ["Mine"]
    assert api_client.get("/api/applications").json()["total"] == 0
    assert api_client.get("/api/cover-letters").json() == []
    assert api_client.get("/api/stats").json()["total_applications"] == 0
    assert api_client.get("/api/stats/sankey").json() == []


@pytest.mark.parametrize("method, path", [
    ("GET", "/api/resumes/{resume}"),
    ("PATCH", "/api/resumes/{resume}"),
    ("DELETE", "/api/resumes/{resume}"),
    ("GET", "/api/resumes/{resume}/preview"),
    ("GET", "/api/cover-letters/{letter}"),
    ("PATCH", "/api/cover-letters/{letter}"),
    ("DELETE", "/api/cover-letters/{letter}"),
    ("PATCH", "/api/applications/{app}"),
    ("DELETE", "/api/applications/{app}"),
    ("POST", "/api/applications/{app}/interviews"),
    ("PATCH", "/api/applications/interviews/{interview}"),
    ("DELETE", "/api/applications/interviews/{interview}"),
    ("GET", "/api/applications/{app}/prep"),
])
def test_another_firms_row_is_not_found(api_client, other_firm_rows, method, path):
    ids = {name: str(row.id) for name, row in other_firm_rows.items()}
    body = {"what": "Panel"} if path.endswith("/interviews") else {}
    resp = api_client.request(method, path.format(**ids), json=body if method != "GET" else None)
    assert resp.status_code == 404, resp.text


def test_bulk_actions_report_another_firms_rows_as_not_found(api_client, other_firm_rows, test_db):
    app_id = str(other_firm_rows["app"].id)
    moved = api_client.post("/api/applications/bulk-update", json={"ids": [app_id], "status": "interview"})
    assert moved.json()["not_found"] == [app_id]
    deleted = api_client.post("/api/applications/bulk-delete", json={"ids": [app_id]})
    assert deleted.json()["not_found"] == [app_id]
    test_db.expire_all()
    assert test_db.get(Application, other_firm_rows["app"].id).status == "applied"


def test_a_copy_or_tailor_cannot_start_from_another_firms_resume(api_client, other_firm_rows):
    resume, job = str(other_firm_rows["resume"].id), str(other_firm_rows["job"].id)
    assert api_client.post("/api/resumes/copy", json={"base_resume_id": resume, "job_id": job}).status_code == 404
    assert api_client.post("/api/resumes/tailor", json={"base_resume_id": resume, "job_id": job}).status_code == 404
    letter = api_client.post("/api/cover-letters/generate", json={"resume_id": resume, "job_id": job})
    assert letter.status_code == 404
