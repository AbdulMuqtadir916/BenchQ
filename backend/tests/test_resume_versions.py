"""A candidate's résumé versions and bases through the API (docs/team/resume-versioning.md §4.3, §4.6, §4.7, §6;
PR 5): save, use as base and pick, the BDE's upload, delete / hide / show again, and who may do each (07 Q55)."""
import uuid

import pytest

from backend.models.candidates import file_sha256
from backend.tests.test_candidates_api import _assign, _create, world  # noqa: F401  (the fixture)
from backend.tests.test_first_base import PARSE, _upload


@pytest.fixture
def parser(monkeypatch):
    """The later-upload parser, offline: no text extraction, no model. Counts its calls."""
    from backend.api import routes_candidate_resumes
    from backend.candidates.base_resume import clean_reply
    calls = []

    async def read_resume(text, kind, db, firm_id=None):
        calls.append(firm_id)
        return clean_reply({**PARSE, "header": {**PARSE["header"], "title": "Staff Java Engineer"}})

    monkeypatch.setattr(routes_candidate_resumes, "extract_text", lambda kind, content: "résumé text")
    monkeypatch.setattr(routes_candidate_resumes, "read_resume", read_resume)
    return calls


def _url(world, candidate, tail=""):
    return f"/api/firms/{world['firm'].id}/candidates/{candidate['id']}/resumes{tail}"


ONBOARDING_FILE = b"%PDF-1.7 the onboarding resume"


def _candidate(client, test_db, world, bde=None):
    """A candidate created from an upload by the OWNER (Fatima's team), with or without a BDE: Base 1 v1."""
    upload = _upload(test_db, world)
    upload.content, upload.size_bytes = ONBOARDING_FILE, len(ONBOARDING_FILE)
    upload.content_sha256 = file_sha256(ONBOARDING_FILE)
    test_db.commit()
    r = _create(client, world, resume_parse_id=str(upload.id), bde=bde)
    assert r.status_code == 201, r.text
    return r.json()


def _listing(client, world, candidate, who="owner"):
    r = client.get(_url(world, candidate), headers=world["as"][who])
    assert r.status_code == 200, r.text
    return r.json()


def _v(client, world, candidate, base_number=1, version=1, who="owner"):
    base = _listing(client, world, candidate, who)["bases"][base_number - 1]
    row = next(v for v in base["versions"] if v["version"] == version)
    r = client.get(_url(world, candidate, f"/{row['id']}"), headers=world["as"][who])
    assert r.status_code == 200, r.text
    return r.json()


def _edit(version: dict, **changes) -> dict:
    from backend.candidates.versions import HEADER, SECTIONS
    return {**{k: version[k] for k in (*HEADER, *SECTIONS)}, **changes}


def _save(client, world, candidate, version, who="owner", **changes):
    return client.post(_url(world, candidate, f"/{version['id']}/save"), json=_edit(version, **changes),
                       headers=world["as"][who])


def _pdf(content=b"%PDF-1.7 a later resume"):
    return {"file": ("later.pdf", content, "application/pdf")}


# ── Reading ──────────────────────────────────────────────────────────────────

def test_a_new_candidates_listing_has_its_active_base_and_version_1_with_item_ids(anonymous_client, test_db, world):
    c = _candidate(anonymous_client, test_db, world)
    listing = _listing(anonymous_client, world, c)
    assert [(b["number"], b["source"], b["is_active"], len(b["versions"])) for b in listing["bases"]] == \
        [(1, "UPLOAD", True, 1)]
    v1 = _v(anonymous_client, world, c)
    assert v1["version"] == 1 and v1["category"] == "BASE" and v1["experiences"][0]["bullets"][0]["id"]
    assert listing["tailored"] == []


def test_a_version_outside_the_candidate_is_not_found(anonymous_client, test_db, world):
    c = _candidate(anonymous_client, test_db, world)
    other = _create(anonymous_client, world, email="other@example.com").json()
    v1 = _v(anonymous_client, world, c)
    assert anonymous_client.get(_url(world, other, f"/{v1['id']}"), headers=world["as"]["owner"]).status_code == 404
    assert anonymous_client.get(_url(world, c, f"/{uuid.uuid4()}"), headers=world["as"]["owner"]).status_code == 404


# ── Saving ───────────────────────────────────────────────────────────────────

def test_a_save_is_the_next_version_keeping_ids_and_giving_new_items_one(anonymous_client, test_db, world):
    c = _candidate(anonymous_client, test_db, world)
    v1 = _v(anonymous_client, world, c)
    skills = [*v1["skills"], {"category": "Cloud", "name": "AWS"}]
    r = _save(anonymous_client, world, c, v1, summary="A sharper summary.", skills=skills)
    assert r.status_code == 201, r.text
    v2 = r.json()
    assert (v2["version"], v2["summary"], v2["notice"]) == (2, "A sharper summary.", None)
    assert [s["id"] for s in v2["skills"][:-1]] == [s["id"] for s in v1["skills"]]
    assert v2["skills"][-1]["id"] not in {s["id"] for s in v1["skills"]}
    assert _v(anonymous_client, world, c)["summary"] == v1["summary"]        # v1 never changes


def test_a_save_that_changes_nothing_or_names_an_unknown_item_is_refused(anonymous_client, test_db, world):
    c = _candidate(anonymous_client, test_db, world)
    v1 = _v(anonymous_client, world, c)
    r = _save(anonymous_client, world, c, v1)
    assert (r.status_code, r.json()["detail"]) == (400, "No changes to save.")
    r = _save(anonymous_client, world, c, v1, skills=[{"id": str(uuid.uuid4()), "category": "", "name": "Go"}])
    assert r.status_code == 400 and "doesn't have" in r.json()["detail"]


@pytest.mark.parametrize("field", ["full_name", "email"])
def test_a_save_without_the_name_or_email_in_the_header_is_refused_naming_it(anonymous_client, test_db, world, field):
    c = _candidate(anonymous_client, test_db, world)
    v1 = _v(anonymous_client, world, c)
    for blank in ("", "   ", None):
        r = _save(anonymous_client, world, c, v1, summary="A different summary.", **{field: blank})
        assert r.status_code == 422 and field in {part for e in r.json()["detail"] for part in e["loc"]}


def test_two_saves_from_the_same_version_are_both_kept_and_the_second_is_told(anonymous_client, test_db, world):
    c = _candidate(anonymous_client, test_db, world)
    v1 = _v(anonymous_client, world, c)
    first = _save(anonymous_client, world, c, v1, summary="One edit.").json()
    second = _save(anonymous_client, world, c, v1, summary="Another edit.").json()
    assert (first["version"], first["notice"]) == (2, None)
    assert second["version"] == 3
    assert second["notice"] == "v2 was saved while you were editing; your v3 doesn't include those changes."


def test_a_changed_item_gets_a_new_id_and_the_old_versions_keep_theirs(anonymous_client, test_db, world):
    """An id stands for one exact text (§3.4, §4.5): the edited job gets a new id, while v1 still holds the old id.
    The job left as it was keeps its id."""
    c = _candidate(anonymous_client, test_db, world)
    v1 = _v(anonymous_client, world, c)
    changed, kept = v1["experiences"]
    r = _save(anonymous_client, world, c, v1, experiences=[{**changed, "company": "Capital Payments Inc"}, kept])
    assert r.status_code == 201, r.text
    v2 = r.json()
    assert v2["experiences"][0]["id"] != changed["id"] and v2["experiences"][1]["id"] == kept["id"]
    assert _v(anonymous_client, world, c)["experiences"][0]["id"] == changed["id"]            # v1 untouched


def test_a_changed_added_or_removed_bullet_gives_its_job_a_new_id(anonymous_client, test_db, world):
    """A job's id covers its bullets: any bullet change makes the job new text, so it gets a new id (only the
    changed bullet gets one too); v1's job stays as it was."""
    c = _candidate(anonymous_client, test_db, world)
    v1 = _v(anonymous_client, world, c)
    job = v1["experiences"][0]
    bullet, *rest = job["bullets"]
    edits = [[{**bullet, "text": "Led a team of 40."}, *rest], [*job["bullets"], {"text": "A new bullet."}], rest]
    for bullets in edits:
        r = _save(anonymous_client, world, c, v1, experiences=[{**job, "bullets": bullets}, *v1["experiences"][1:]])
        assert r.status_code == 201, r.text
        saved = r.json()["experiences"][0]
        assert saved["id"] != job["id"]
        assert [b["id"] for b in saved["bullets"] if b["text"] == rest[0]["text"]] == [rest[0]["id"]]   # unchanged


def test_the_summary_is_an_item_too(anonymous_client, test_db, world):
    """The summary has an id (0011): unchanged it's kept; changed it's new."""
    c = _candidate(anonymous_client, test_db, world)
    v1 = _v(anonymous_client, world, c)
    assert v1["summary_id"]
    same = _save(anonymous_client, world, c, v1, title="A new headline").json()
    assert same["summary_id"] == v1["summary_id"]
    edited = _save(anonymous_client, world, c, v1, summary="A different pitch.").json()
    assert edited["summary_id"] not in (None, v1["summary_id"])
    assert _save(anonymous_client, world, c, v1, summary=None).json()["summary_id"] is None


# ── Use as base, pick ────────────────────────────────────────────────────────

def test_use_as_base_copies_the_version_into_a_new_active_base_once(anonymous_client, test_db, world):
    c = _candidate(anonymous_client, test_db, world)
    v1 = _v(anonymous_client, world, c)
    v2 = _save(anonymous_client, world, c, v1, summary="Edited.").json()
    r = anonymous_client.post(_url(world, c, f"/{v2['id']}/use-as-base"), headers=world["as"]["owner"])
    assert r.status_code == 200, r.text
    base2 = r.json()
    assert (base2["number"], base2["source"], base2["is_active"], base2["promoted_from_resume_id"]) == \
        (2, "PROMOTED", True, v2["id"])
    again = anonymous_client.post(_url(world, c, f"/{v2['id']}/use-as-base"), headers=world["as"]["owner"]).json()
    assert again["id"] == base2["id"]                                          # no second copy
    listing = _listing(anonymous_client, world, c)
    assert [b["is_active"] for b in listing["bases"]] == [False, True]
    assert listing["bases"][0]["versions"][1]["promoted_to_base_id"] == base2["id"]
    copy = _v(anonymous_client, world, c, base_number=2)
    assert (copy["summary"], [s["id"] for s in copy["skills"]]) == ("Edited.", [s["id"] for s in v2["skills"]])


def test_picking_a_bases_version_1_moves_the_active_base_and_copies_nothing(anonymous_client, test_db, world):
    c = _candidate(anonymous_client, test_db, world)
    v1 = _v(anonymous_client, world, c)
    v2 = _save(anonymous_client, world, c, v1, summary="Edited.").json()
    anonymous_client.post(_url(world, c, f"/{v2['id']}/use-as-base"), headers=world["as"]["owner"])
    r = anonymous_client.post(_url(world, c, f"/{v1['id']}/use-as-base"), headers=world["as"]["owner"])
    assert (r.status_code, r.json()["number"], r.json()["is_active"]) == (200, 1, True)
    listing = _listing(anonymous_client, world, c)
    assert [b["is_active"] for b in listing["bases"]] == [True, False]
    assert [len(b["versions"]) for b in listing["bases"]] == [2, 1]


# ── Who (07 Q55) ─────────────────────────────────────────────────────────────

def test_before_a_bde_the_owner_and_manager_change_it_and_nobody_deletes_or_uploads(anonymous_client, test_db, world,
                                                                                    parser):
    c = _candidate(anonymous_client, test_db, world)
    v1 = _v(anonymous_client, world, c)
    assert _save(anonymous_client, world, c, v1, "fatima", summary="The manager's edit.").status_code == 201
    assert _save(anonymous_client, world, c, v1, "rohan", summary="A viewer's edit.").status_code == 403
    assert anonymous_client.post(_url(world, c, "/upload"), files=_pdf(),
                                 headers=world["as"]["fatima"]).status_code == 403
    v2 = _v(anonymous_client, world, c, version=2)
    assert anonymous_client.delete(_url(world, c, f"/{v2['id']}"), headers=world["as"]["owner"]).status_code == 403
    assert parser == []


def test_once_a_bde_is_assigned_only_that_bde_changes_it(anonymous_client, test_db, world):
    c = _candidate(anonymous_client, test_db, world, bde="adnan")
    v1 = _v(anonymous_client, world, c)
    for who in ("owner", "fatima"):
        r = _save(anonymous_client, world, c, v1, who, summary="Not theirs any more.")
        assert r.status_code == 403 and "BDE" in r.json()["detail"], who
        assert _listing(anonymous_client, world, c, who)["bases"]                # they still view it
    assert _save(anonymous_client, world, c, v1, "vikram", summary="Another team.").status_code == 404
    assert _save(anonymous_client, world, c, v1, "adnan", summary="The BDE's edit.").status_code == 201


def test_a_reassigned_candidates_new_bde_takes_over_and_the_old_one_loses_it(anonymous_client, test_db, world):
    c = _candidate(anonymous_client, test_db, world, bde="adnan")
    v1 = _v(anonymous_client, world, c)
    v2 = _save(anonymous_client, world, c, v1, "adnan", summary="The first BDE's edit.").json()
    assert _assign(anonymous_client, world, "owner", c, "priya", "vikram").status_code == 200
    assert _save(anonymous_client, world, c, v2, "adnan", summary="Too late.").status_code == 404
    v3 = _save(anonymous_client, world, c, v2, "vikram", summary="The new BDE's edit.").json()
    assert v3["version"] == 3 and v3["created_by_user_id"] != v2["created_by_user_id"]


# ── Upload ───────────────────────────────────────────────────────────────────

def test_the_bdes_upload_is_a_new_active_base_from_the_parse_and_the_profile_stays(anonymous_client, test_db, world,
                                                                                  parser):
    c = _candidate(anonymous_client, test_db, world, bde="adnan")
    r = anonymous_client.post(_url(world, c, "/upload"), files=_pdf(), headers=world["as"]["adnan"])
    assert r.status_code == 201, r.text
    assert (r.json()["number"], r.json()["source"], r.json()["is_active"]) == (2, "UPLOAD", True)
    v1 = _v(anonymous_client, world, c, base_number=2, who="adnan")
    assert v1["title"] == "Staff Java Engineer" and [s["name"] for s in v1["skills"]] == ["Java", "Go"]
    profile = anonymous_client.get(f"/api/firms/{world['firm'].id}/candidates/{c['id']}",
                                   headers=world["as"]["owner"]).json()
    assert profile["primary_role"] == c["primary_role"]
    assert parser == [world["firm"].id]


def test_the_ledger_and_the_profile_take_the_new_active_bases_name(anonymous_client, test_db, world, parser):
    """Abdul's PR 7 review #3: the name read from the old base isn't reused once the active base changes (07 Q57)."""
    from backend.models.tenancy import LedgerEntry
    c = _candidate(anonymous_client, test_db, world, bde="adnan")         # the form's name: Ravi Teja
    assert anonymous_client.post(_url(world, c, "/upload"), files=_pdf(), headers=world["as"]["adnan"]).status_code == 201
    profile_url = f"/api/firms/{world['firm'].id}/candidates/{c['id']}"
    assert anonymous_client.get(profile_url, headers=world["as"]["owner"]).json()["full_name"] == "Ravi T"   # the file's
    upload = test_db.query(LedgerEntry).filter(LedgerEntry.candidate_id == uuid.UUID(c["id"]),
                                               LedgerEntry.action == "CREATE", LedgerEntry.entity_type == "resume") \
        .order_by(LedgerEntry.created_at.desc()).first()
    assert upload.entity_label == "Ravi T · Base 2"
    # A save on the active base that changes the name: its ledger entry carries the new one.
    v1 = _v(anonymous_client, world, c, base_number=2, who="adnan")
    assert _save(anonymous_client, world, c, v1, "adnan", full_name="Ravi Teja Kumar").status_code == 201
    saved = test_db.query(LedgerEntry).filter(LedgerEntry.candidate_id == uuid.UUID(c["id"]),
                                              LedgerEntry.action == "UPDATE").order_by(LedgerEntry.created_at.desc()).first()
    assert saved.entity_label == "Ravi Teja Kumar · Base 2 v2"


def test_a_profile_whose_active_resume_names_no_country_reads_none_never_us(anonymous_client, test_db, world):
    """Abdul's PR 7 review #5: no country is invented; the profile shows what the active résumé says, or none."""
    c = _candidate(anonymous_client, test_db, world)
    assert _save(anonymous_client, world, c, _v(anonymous_client, world, c), country="").status_code == 201
    profile = anonymous_client.get(f"/api/firms/{world['firm'].id}/candidates/{c['id']}", headers=world["as"]["owner"])
    assert profile.json()["country"] is None


def test_the_same_file_again_is_answered_with_its_base_without_reading_it(anonymous_client, test_db, world, parser):
    c = _candidate(anonymous_client, test_db, world, bde="adnan")
    anonymous_client.post(_url(world, c, "/upload"), files=_pdf(), headers=world["as"]["adnan"])
    r = anonymous_client.post(_url(world, c, "/upload"), files=_pdf(), headers=world["as"]["adnan"])
    assert r.status_code == 409
    assert r.json()["detail"]["message"] == "This résumé is already Base 2." and not r.json()["detail"]["hidden"]
    r = anonymous_client.post(_url(world, c, "/upload"), files=_pdf(ONBOARDING_FILE), headers=world["as"]["adnan"])
    assert r.json()["detail"]["message"] == "This résumé is already Base 1."      # the onboarding file
    assert len(parser) == 1


# ── Delete, hide, show again ─────────────────────────────────────────────────

def test_a_bde_deletes_their_unused_version_but_never_v1_or_an_owners(anonymous_client, test_db, world):
    c = _candidate(anonymous_client, test_db, world)
    v1 = _v(anonymous_client, world, c)
    owners_v2 = _save(anonymous_client, world, c, v1, summary="The owner's edit.").json()
    _assign(anonymous_client, world, "owner", c, "fatima", "adnan")
    bdes_v3 = _save(anonymous_client, world, c, owners_v2, "adnan", summary="The BDE's edit.").json()
    as_bde = world["as"]["adnan"]
    preview = anonymous_client.get(_url(world, c, f"/{bdes_v3['id']}/removal"), headers=as_bde).json()
    assert preview["outcome"] == "DELETE"
    for row, why in ((v1, "Version 1 is the base itself"), (owners_v2, "added by an owner or manager")):
        r = anonymous_client.delete(_url(world, c, f"/{row['id']}"), headers=as_bde)
        assert r.status_code == 409 and why in r.json()["detail"]
    assert anonymous_client.delete(_url(world, c, f"/{bdes_v3['id']}"), headers=as_bde).status_code == 200
    assert [v["version"] for v in _listing(anonymous_client, world, c)["bases"][0]["versions"]] == [1, 2]
    # Soft delete: out of sight, still stored. Opening it is "not found"; its number is never reused.
    from backend.models.db import Resume
    row = test_db.get(Resume, uuid.UUID(bdes_v3["id"]))
    assert row is not None and row.deleted_at is not None and row.summary == "The BDE's edit."
    assert anonymous_client.get(_url(world, c, f"/{bdes_v3['id']}"), headers=as_bde).status_code == 404
    again = _save(anonymous_client, world, c, owners_v2, "adnan", summary="Saved after the delete.").json()
    assert again["version"] == 4
    assert [v["version"] for v in _listing(anonymous_client, world, c)["bases"][0]["versions"]] == [1, 2, 4]


def test_a_sent_version_is_refused_with_what_uses_it(anonymous_client, test_db, world):
    from backend.models.db import Application, Job
    c = _candidate(anonymous_client, test_db, world, bde="adnan")
    v1 = _v(anonymous_client, world, c)
    v2 = _save(anonymous_client, world, c, v1, "adnan", summary="Sent.").json()
    job = Job(external_id="v-sent", title="Java Dev", company="Acme", url="https://jobs.example.test/s", source="manual")
    test_db.add(job)
    test_db.flush()
    test_db.add(Application(firm_id=world["firm"].id, job_id=job.id, status="applied", candidate_id=uuid.UUID(c["id"]),
                            resume_id=uuid.UUID(v2["id"])))
    test_db.commit()
    r = anonymous_client.delete(_url(world, c, f"/{v2['id']}"), headers=world["as"]["adnan"])
    assert (r.status_code, r.json()["detail"]) == (409, "Can't delete v2: used by 1 live application.")


def test_a_bdes_unused_base_is_soft_deleted_and_the_same_file_restores_it_and_a_used_one_is_hidden(
        anonymous_client, test_db, world, parser):
    from backend.models.candidates import BaseResume, ResumeParse
    from backend.models.db import Application, Job, Resume
    c = _candidate(anonymous_client, test_db, world, bde="adnan")
    as_bde = world["as"]["adnan"]
    base2 = anonymous_client.post(_url(world, c, "/upload"), files=_pdf(), headers=as_bde).json()
    base3 = anonymous_client.post(_url(world, c, "/upload"), files=_pdf(b"%PDF third"), headers=as_bde).json()
    assert base3["is_active"]
    # The active base can't go; Base 1 holds the owner's upload.
    for base, why in ((base3, "Pick another base first"), (_listing(anonymous_client, world, c)["bases"][0],
                                                          "an owner or manager added")):
        r = anonymous_client.delete(_url(world, c, f"/bases/{base['id']}"), headers=as_bde)
        assert r.status_code == 409 and why in r.json()["detail"]
    # Base 2 has an edit of the BDE's (v2); it's unused, so deleting it is allowed.
    base2_v1 = next(b for b in _listing(anonymous_client, world, c)["bases"] if b["id"] == base2["id"])["versions"][0]
    v2_body = anonymous_client.get(_url(world, c, f"/{base2_v1['id']}"), headers=as_bde).json()
    assert _save(anonymous_client, world, c, v2_body, "adnan", summary="An edit of Base 2.").status_code == 201
    # Base 2, unused: soft deleted with its versions. Nothing is removed from the tables; the upload stays.
    assert anonymous_client.delete(_url(world, c, f"/bases/{base2['id']}"), headers=as_bde).json()["outcome"] == "DELETE"
    assert test_db.get(BaseResume, uuid.UUID(base2["id"])).deleted_at is not None
    assert test_db.query(ResumeParse).filter(ResumeParse.id == uuid.UUID(base2["resume_parse_id"])).count() == 1
    gone = test_db.query(Resume).filter(Resume.base_resume_id == uuid.UUID(base2["id"])).all()
    assert len(gone) == 2 and all(row.deleted_at is not None for row in gone)
    assert base2["id"] not in [b["id"] for b in _listing(anonymous_client, world, c)["bases"]]
    # The same file again: the base comes back from what was stored (no new read), v1 only, active, as any upload is.
    calls = len(parser)
    again = anonymous_client.post(_url(world, c, "/upload"), files=_pdf(), headers=as_bde)
    assert again.status_code == 201 and again.json()["restored"] is True and again.json()["id"] == base2["id"]
    assert len(parser) == calls and again.json()["is_active"]
    restored = next(b for b in _listing(anonymous_client, world, c)["bases"] if b["id"] == base2["id"])
    assert [v["version"] for v in restored["versions"]] == [1]
    # Later edits stay deleted, and their numbers aren't reused: the next save from v1 is v3.
    v1_body = anonymous_client.get(_url(world, c, f"/{restored['versions'][0]['id']}"), headers=as_bde).json()
    assert _save(anonymous_client, world, c, v1_body, "adnan", summary="After the restore.").json()["version"] == 3
    # A used base: hidden, still listed with archived_at; re-uploading its file offers to show it; show again.
    # Base 3 (the third file), inactive after the restore made Base 2 active again.
    third = next(b for b in _listing(anonymous_client, world, c)["bases"] if b["id"] == base3["id"])
    v1 = third["versions"][0]
    job = Job(external_id="v-used", title="Java Dev", company="Acme", url="https://jobs.example.test/u", source="manual")
    test_db.add(job)
    test_db.flush()
    test_db.add(Application(firm_id=world["firm"].id, job_id=job.id, status="applied", candidate_id=uuid.UUID(c["id"]),
                            resume_id=uuid.UUID(v1["id"])))
    test_db.commit()
    r = anonymous_client.delete(_url(world, c, f"/bases/{base3['id']}"), headers=as_bde)
    assert r.json()["outcome"] == "HIDE" and r.json()["message"].startswith("Used by 1 live application. Base 3 will be hidden")
    hidden = next(b for b in _listing(anonymous_client, world, c)["bases"] if b["id"] == base3["id"])
    assert hidden["archived_at"] is not None
    r = anonymous_client.post(_url(world, c, "/upload"), files=_pdf(b"%PDF third"), headers=as_bde)
    assert r.status_code == 409 and r.json()["detail"] == {"message": "This résumé is Base 3 (hidden). Show it again?",
                                                           "base_resume_id": base3["id"], "hidden": True}
    shown = anonymous_client.post(_url(world, c, f"/bases/{base3['id']}/show"), headers=as_bde).json()
    assert (shown["archived_at"], shown["is_active"]) == (None, False)
    picked = anonymous_client.post(_url(world, c, f"/{v1['id']}/use-as-base"), headers=as_bde).json()
    assert picked["is_active"]


def test_the_list_marks_what_an_owner_or_manager_made_so_the_bde_gets_no_delete_there(anonymous_client, test_db, world):
    c = _candidate(anonymous_client, test_db, world, bde="adnan")          # created by the owner: Base 1 v1 is theirs
    v1 = _v(anonymous_client, world, c, who="adnan")
    assert _save(anonymous_client, world, c, v1, "adnan", summary="The BDE's version.").status_code == 201
    [base] = _listing(anonymous_client, world, c, "adnan")["bases"]
    assert base["made_by_lead"] is True                                     # the same rule as base_removal
    by_version = {v["version"]: v["made_by_lead"] for v in base["versions"]}
    assert by_version == {1: True, 2: False}                               # the BDE's v2 stays deletable


def test_picking_a_version_whose_promoted_base_was_deleted_brings_that_base_back(anonymous_client, test_db, world):
    from backend.models.candidates import BaseResume
    c = _candidate(anonymous_client, test_db, world, bde="adnan")
    as_bde = world["as"]["adnan"]
    v1 = _v(anonymous_client, world, c)
    v2 = _save(anonymous_client, world, c, v1, "adnan", summary="A pitch worth a base.").json()
    base2 = anonymous_client.post(_url(world, c, f"/{v2['id']}/use-as-base"), headers=as_bde).json()     # promoted, active
    assert anonymous_client.post(_url(world, c, f"/{v1['id']}/use-as-base"), headers=as_bde).json()["number"] == 1
    assert anonymous_client.delete(_url(world, c, f"/bases/{base2['id']}"), headers=as_bde).json()["outcome"] == "DELETE"
    assert test_db.get(BaseResume, uuid.UUID(base2["id"])).deleted_at is not None
    again = anonymous_client.post(_url(world, c, f"/{v2['id']}/use-as-base"), headers=as_bde)
    assert again.status_code == 200 and again.json()["id"] == base2["id"] and again.json()["is_active"]
    assert len(_listing(anonymous_client, world, c)["bases"]) == 2            # no third copy: the same base is back
    from backend.models.tenancy import LedgerEntry
    last = test_db.query(LedgerEntry).filter(LedgerEntry.entity_id == base2["id"]).order_by(LedgerEntry.created_at.desc()).first()
    assert last.summary == "Restored Base 2 (its v1) by using Base 1 v2 again; the workflow uses it"   # not "the same file"


# ── Races: forced at the same time, with the candidate row held by another session ──────────────────────────

def _in_thread(call):
    import threading
    out = {}
    thread = threading.Thread(target=lambda: out.setdefault("response", call()))
    thread.start()
    return thread, out


def _wait_until_blocked(db) -> None:
    """Until some request is waiting on a lock (the candidate row this session holds)."""
    import time
    from sqlalchemy import text
    for _ in range(200):
        if db.execute(text("SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() "
                           "AND wait_event_type = 'Lock'")).scalar():
            return
        time.sleep(0.05)
    raise AssertionError("the request never waited for the candidate's lock")


def _hold(db, candidate):
    from backend.models.candidates import Candidate
    return db.query(Candidate).filter(Candidate.id == uuid.UUID(candidate["id"])).with_for_update().one()


def test_a_managers_save_arriving_as_a_bde_is_assigned_is_refused(anonymous_client, test_db, world):
    c = _candidate(anonymous_client, test_db, world)
    v1 = _v(anonymous_client, world, c)
    row = _hold(test_db, c)
    thread, out = _in_thread(lambda: _save(anonymous_client, world, c, v1, "fatima", summary="Just in time?"))
    _wait_until_blocked(test_db)
    row.bde_id = world["people"]["adnan"].id
    test_db.commit()
    thread.join(30)
    assert out["response"].status_code == 403


def test_two_saves_at_once_are_v2_and_v3(anonymous_client, test_db, world):
    from backend.candidates import versions
    from backend.models.db import Resume
    from backend.models.tenancy import User
    c = _candidate(anonymous_client, test_db, world)
    v1 = _v(anonymous_client, world, c)
    candidate = _hold(test_db, c)
    thread, out = _in_thread(lambda: _save(anonymous_client, world, c, v1, "fatima", summary="Second."))
    _wait_until_blocked(test_db)
    source = test_db.get(Resume, uuid.UUID(v1["id"]))
    versions.save_version(test_db, test_db.get(User, world["people"]["fatima"].id), candidate, source,
                          {**versions.content_of(source), "summary": "First."})
    test_db.commit()
    thread.join(30)
    assert out["response"].status_code == 201
    assert (out["response"].json()["version"], bool(out["response"].json()["notice"])) == (3, True)


def test_two_promotes_of_one_version_at_once_make_one_base(anonymous_client, test_db, world):
    from backend.candidates import versions
    from backend.models.db import Resume
    from backend.models.tenancy import User
    c = _candidate(anonymous_client, test_db, world)
    v2 = _save(anonymous_client, world, c, _v(anonymous_client, world, c), summary="Edited.").json()
    candidate = _hold(test_db, c)
    thread, out = _in_thread(lambda: anonymous_client.post(_url(world, c, f"/{v2['id']}/use-as-base"),
                                                           headers=world["as"]["fatima"]))
    _wait_until_blocked(test_db)
    base = versions.use_as_base(test_db, test_db.get(User, world["people"]["fatima"].id), candidate,
                                test_db.get(Resume, uuid.UUID(v2["id"])))
    test_db.commit()
    thread.join(30)
    assert out["response"].json()["id"] == str(base.id)
    assert len(_listing(anonymous_client, world, c)["bases"]) == 2


def test_two_uploads_of_one_file_at_once_make_one_base(anonymous_client, test_db, world, parser):
    from backend.candidates import versions
    from backend.models.candidates import ResumeParse
    from backend.models.tenancy import User
    c = _candidate(anonymous_client, test_db, world, bde="adnan")
    content = b"%PDF-1.7 a later resume"
    candidate = _hold(test_db, c)
    thread, out = _in_thread(lambda: anonymous_client.post(_url(world, c, "/upload"), files=_pdf(content),
                                                           headers=world["as"]["adnan"]))
    _wait_until_blocked(test_db)
    adnan = test_db.get(User, world["people"]["adnan"].id)
    row = ResumeParse(firm_id=world["firm"].id, uploaded_by_user_id=adnan.id, candidate_id=candidate.id,
                      file_name="later.pdf", mime_type="application/pdf", size_bytes=len(content), content=content,
                      parse=PARSE)
    test_db.add(row)
    test_db.flush()
    versions.upload_base(test_db, adnan, candidate, row)
    test_db.commit()
    thread.join(30)
    assert out["response"].status_code == 409
    assert out["response"].json()["detail"]["message"] == "This résumé is already Base 2."
    assert len(_listing(anonymous_client, world, c)["bases"]) == 2
