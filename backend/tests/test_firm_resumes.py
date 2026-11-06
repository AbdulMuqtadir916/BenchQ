"""The firm's résumés across candidates (résumé versioning PR 7): the Resume Builder list and opening a version by its
id alone, read-only, in the principal's scope (07 Q47)."""
import uuid

from backend.tests.test_candidates_api import _create, world  # noqa: F401  (the fixture)


def _make(client, world, name, manager="fatima", bde=None):
    r = _create(client, world, full_name=name, email=f"{name.lower().replace(' ', '.')}@example.test",
                manager=manager, bde=bde)
    assert r.status_code == 201, r.text
    return r.json()


def _shelf(client, world, who):
    r = client.get(f"/api/firms/{world['firm'].id}/resumes", headers=world["as"][who])
    assert r.status_code == 200, r.text
    return r.json()


def _owners(shelf) -> set[str]:
    return {b["candidate_id"] for b in shelf["bases"]}


def test_the_list_holds_every_candidate_in_scope_with_their_bases_and_no_content(anonymous_client, world):
    adnans = _make(anonymous_client, world, "Adnans Candidate", bde="adnan")
    queued = _make(anonymous_client, world, "Queued Candidate")
    vikrams = _make(anonymous_client, world, "Vikrams Candidate", manager="priya", bde="vikram")
    everyone = {adnans["id"], queued["id"], vikrams["id"]}

    assert _owners(_shelf(anonymous_client, world, "owner")) == everyone
    assert _owners(_shelf(anonymous_client, world, "rohan")) == everyone          # a VIEWER sees the firm
    assert _owners(_shelf(anonymous_client, world, "fatima")) == {adnans["id"], queued["id"]}
    assert _owners(_shelf(anonymous_client, world, "priya")) == {vikrams["id"]}
    assert _owners(_shelf(anonymous_client, world, "adnan")) == {adnans["id"]}

    shelf = _shelf(anonymous_client, world, "owner")
    base = next(b for b in shelf["bases"] if b["candidate_id"] == adnans["id"])
    assert (base["number"], base["source"], base["is_active"]) == (1, "MANUAL", True)
    [v1] = base["versions"]
    assert (v1["version"], v1["category"], v1["candidate_id"], v1["base_resume_id"]) == (1, "BASE", adnans["id"], base["id"])
    assert "summary" not in v1 and "experiences" not in v1                    # the list never carries content
    assert "title" in v1                                                      # only the headline, to name the base
    assert shelf["tailored"] == []


def test_a_version_opens_by_its_id_with_its_content_only_in_scope(anonymous_client, world):
    vikrams = _make(anonymous_client, world, "Vikrams Candidate", manager="priya", bde="vikram")
    [base] = [b for b in _shelf(anonymous_client, world, "owner")["bases"] if b["candidate_id"] == vikrams["id"]]
    version_id = base["versions"][0]["id"]
    url = f"/api/firms/{world['firm'].id}/resumes/{version_id}"

    r = anonymous_client.get(url, headers=world["as"]["vikram"])
    assert r.status_code == 200, r.text
    assert (r.json()["candidate_id"], r.json()["full_name"], r.json()["summary"]) == \
        (vikrams["id"], "Vikrams Candidate", "Nine years of Java.")
    assert anonymous_client.get(url, headers=world["as"]["owner"]).status_code == 200
    # Outside the principal's scope: the same 404 as a version that exists nowhere.
    assert anonymous_client.get(url, headers=world["as"]["fatima"]).status_code == 404
    assert anonymous_client.get(url, headers=world["as"]["adnan"]).status_code == 404
    missing = f"/api/firms/{world['firm'].id}/resumes/00000000-0000-0000-0000-000000000000"
    assert anonymous_client.get(missing, headers=world["as"]["owner"]).status_code == 404


def test_a_deleted_version_is_not_found(anonymous_client, test_db, world):
    from backend.models.db import Resume, utcnow
    c = _make(anonymous_client, world, "Some Candidate", bde="adnan")
    [base] = [b for b in _shelf(anonymous_client, world, "owner")["bases"] if b["candidate_id"] == c["id"]]
    row = test_db.get(Resume, uuid.UUID(base["versions"][0]["id"]))
    row.deleted_at = utcnow()
    test_db.commit()
    url = f"/api/firms/{world['firm'].id}/resumes/{row.id}"
    assert anonymous_client.get(url, headers=world["as"]["owner"]).status_code == 404
    shelf = _shelf(anonymous_client, world, "owner")
    assert all(v["id"] != str(row.id) for b in shelf["bases"] for v in b["versions"])
