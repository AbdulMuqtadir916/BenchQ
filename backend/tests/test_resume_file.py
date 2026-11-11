"""The file behind an uploaded résumé (07 Q49, docs/02 §8.2): an uploaded base's version 1 is served as it was uploaded,
for the extension to attach to a form; every other version has none."""
import uuid

from backend.tests.test_candidates_api import world  # noqa: F401  (the fixture)
from backend.tests.test_resume_versions import ONBOARDING_FILE, _candidate, _pdf, _save, _url, _v, parser  # noqa: F401

LATER_FILE = b"%PDF-1.7 a later resume"


def _file(client, world, candidate, resume_id, who="owner"):
    return client.get(_url(world, candidate, f"/{resume_id}/file"), headers=world["as"][who])


def test_an_uploads_first_version_is_its_file_as_uploaded(anonymous_client, test_db, world, parser):
    c = _candidate(anonymous_client, test_db, world, bde="adnan")
    r = _file(anonymous_client, world, c, _v(anonymous_client, world, c, who="adnan")["id"], who="adnan")
    assert r.status_code == 200, r.text
    assert (r.content, r.headers["content-type"], r.headers["cache-control"]) == (ONBOARDING_FILE, "application/pdf",
                                                                                 "no-store")
    upload = anonymous_client.post(_url(world, c, "/upload"), files=_pdf(LATER_FILE), headers=world["as"]["adnan"])
    assert upload.status_code == 201, upload.text
    r = _file(anonymous_client, world, c, _v(anonymous_client, world, c, base_number=2, who="adnan")["id"], who="adnan")
    assert r.content == LATER_FILE
    assert r.headers["content-disposition"] == "attachment; filename*=UTF-8''later.pdf"


def test_an_edited_version_and_a_base_made_from_it_have_no_file(anonymous_client, test_db, world):
    c = _candidate(anonymous_client, test_db, world)
    v1 = _v(anonymous_client, world, c)
    assert _save(anonymous_client, world, c, v1, summary="An edited summary.").status_code == 201
    v2 = _v(anonymous_client, world, c, version=2)
    assert _file(anonymous_client, world, c, v2["id"]).status_code == 404
    assert _file(anonymous_client, world, c, v1["id"]).content == ONBOARDING_FILE
    promoted = anonymous_client.post(_url(world, c, f"/{v2['id']}/use-as-base"), headers=world["as"]["owner"])
    assert promoted.status_code == 200, promoted.text
    r = _file(anonymous_client, world, c, _v(anonymous_client, world, c, base_number=2)["id"])
    assert (r.status_code, r.json()["detail"]) == (404, "This version has no uploaded file.")


def test_out_of_scope_and_unknown_versions_are_not_found(anonymous_client, test_db, world):
    c = _candidate(anonymous_client, test_db, world, bde="adnan")
    v1 = _v(anonymous_client, world, c)
    assert _file(anonymous_client, world, c, v1["id"], who="vikram").status_code == 404   # another manager's BDE
    assert _file(anonymous_client, world, c, uuid.uuid4()).status_code == 404
