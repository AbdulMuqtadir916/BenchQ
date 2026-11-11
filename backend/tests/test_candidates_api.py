"""The candidates API (docs/candidate-onboarding/06-backend.md PR 4; 07 Q41–Q49): who may add and assign, what each
principal sees, the candidate limit, the kept résumé parse and the ledger."""
from datetime import timedelta

import pytest

from backend.tests.auth_support import make_firm, make_plan, make_user


def _cookie(token):
    return {"cookie": f"bq_session={token}"}


@pytest.fixture
def world(test_db, accounts):
    """Two teams: Fatima manages Adnan and Sneha; Priya manages Vikram. Plus a VIEWER and an inactive BDE."""
    from backend.auth.sessions import start_session
    from backend.models.tenancy import Firm
    firm = test_db.get(Firm, accounts.firm_id)
    people = {
        "fatima": make_user(test_db, firm, email="fatima@acme.test", role="MANAGER", name="Fatima Reddy"),
        "priya": make_user(test_db, firm, email="priya@acme.test", role="MANAGER", name="Priya Shah"),
        "adnan": make_user(test_db, firm, email="adnan@acme.test", role="BDE", name="Adnan Khan"),
        "sneha": make_user(test_db, firm, email="sneha@acme.test", role="BDE", name="Sneha Rao"),
        "vikram": make_user(test_db, firm, email="vikram@acme.test", role="BDE", name="Vikram Desai"),
        "gone": make_user(test_db, firm, email="gone@acme.test", role="BDE", name="Gone Bde", is_active=False),
        "rohan": make_user(test_db, firm, email="rohan@acme.test", role="VIEWER", name="Rohan Kapoor"),
    }
    for bde, manager in (("adnan", "fatima"), ("sneha", "fatima"), ("vikram", "priya"), ("gone", "fatima")):
        people[bde].manager_id = people[manager].id
    test_db.commit()
    cookies = {"owner": _cookie(accounts.firm_token)}
    for who in ("fatima", "priya", "adnan", "vikram", "rohan"):
        token, _ = start_session(test_db, people[who])
        cookies[who] = _cookie(token)
    test_db.commit()
    return {"firm": firm, "people": people, "as": cookies, "db": test_db}


def _body(world, manager="fatima", bde=None, **over):
    people = world["people"]
    return {"full_name": "Ravi Teja", "primary_role": "Java Developer", "email": "Ravi@Example.com", "work_auth": "H1B",
            "phone": "+1 555 0100", "country": "US", "years_experience": 9, "needs_sponsorship": True,
            "needs_transfer": True, "target_roles": ["Java Developer"],
            "employment_types": ["C2C"], "manager_id": str(people[manager].id),
            "bde_id": str(people[bde].id) if bde else None, "skills": [{"name": "Java"}],
            "summary": "Nine years of Java.", **over}


def _upload_for_create(world) -> str:
    """A résumé read, as step 1 leaves it (07 Q58: no candidate without one). Its own bytes, so files never collide."""
    from datetime import timedelta
    import uuid
    from backend.models.candidates import ResumeParse, file_sha256
    from backend.models.db import utcnow
    content = f"%PDF-1.7 test {uuid.uuid4()}".encode()
    row = ResumeParse(firm_id=world["firm"].id, uploaded_by_user_id=world["people"]["fatima"].id, file_name="r.pdf",
                      mime_type="application/pdf", size_bytes=len(content), content=content,
                      content_sha256=file_sha256(content), parse={"header": {}}, expires_at=utcnow() + timedelta(minutes=30))
    world["db"].add(row)
    world["db"].commit()
    return str(row.id)


def _create(client, world, who="owner", **kwargs):
    """A create as the wizard sends it: with a résumé read unless the test passes its own `resume_parse_id`."""
    if "resume_parse_id" not in kwargs:
        kwargs["resume_parse_id"] = _upload_for_create(world)
    elif kwargs["resume_parse_id"] is None:
        kwargs.pop("resume_parse_id")
    return client.post(f"/api/firms/{world['firm'].id}/candidates", json=_body(world, **kwargs), headers=world["as"][who])


def _list(client, world, who):
    return {c["full_name"] for c in client.get(f"/api/firms/{world['firm'].id}/candidates", headers=world["as"][who]).json()}


# ── Creating ─────────────────────────────────────────────────────────────────

def test_the_owner_hands_a_candidate_to_a_manager(anonymous_client, test_db, world):
    from backend.models.tenancy import ActivityEntry
    r = _create(anonymous_client, world, handoff_note="  Prefers banking.  ")
    assert r.status_code == 201, r.text
    c = r.json()
    assert (c["manager_id"], c["bde_id"], c["status"], c["email"]) == (str(world["people"]["fatima"].id), None,
                                                                       "ON_BENCH", "ravi@example.com")
    assert not {"persona", "skills", "summary_state"} & set(c)            # the active base's now (migration 0015)
    assert c["target_roles"] == ["Java Developer"]
    entries = test_db.query(ActivityEntry).filter(ActivityEntry.entity_id == c["id"]).order_by(ActivityEntry.created_at).all()
    assert [(e.action, e.summary, e.note) for e in entries] == [
        ("CREATE", "Added Ravi Teja", None), ("ASSIGN", "Handed to Fatima Reddy", "Prefers banking.")]


def test_the_owner_assigns_a_manager_and_one_of_their_bdes(anonymous_client, world):
    assert _create(anonymous_client, world, bde="adnan").json()["bde_id"] == str(world["people"]["adnan"].id)
    assert _create(anonymous_client, world, bde="vikram").status_code == 403      # Priya's BDE
    assert _create(anonymous_client, world, bde="gone").status_code == 403        # inactive
    assert _create(anonymous_client, world, manager="adnan").status_code == 403   # not a manager


def test_a_manager_adds_only_for_a_bde_of_their_own_team(anonymous_client, world):
    assert _create(anonymous_client, world, who="fatima", bde="sneha").status_code == 201
    assert _create(anonymous_client, world, who="fatima", bde="vikram", manager="priya").status_code == 403
    assert _create(anonymous_client, world, who="fatima").status_code == 403       # no BDE (Q41)


def test_a_bde_and_a_viewer_never_add(anonymous_client, world):
    assert _create(anonymous_client, world, who="adnan", bde="adnan").status_code == 403
    assert _create(anonymous_client, world, who="rohan").status_code == 403


def test_another_firms_people_are_not_found(anonymous_client, test_db, world):
    other = make_user(test_db, make_firm(test_db, make_plan(test_db, name="Other"), slug="other"),
                      email="m@other.test", role="MANAGER")
    test_db.commit()
    r = anonymous_client.post(f"/api/firms/{world['firm'].id}/candidates", headers=world["as"]["owner"],
                              json={**_body(world), "manager_id": str(other.id)})
    assert r.status_code == 404


def test_the_fields_are_checked(anonymous_client, world):
    for over in ({"email": "ravi[at]example.com"}, {"rate_min": 90, "rate_target": 85}):
        assert _create(anonymous_client, world, **over).status_code == 400, over
    for over in ({"work_auth": "H1-B"}, {"years_experience": 212}, {"full_name": ""}):
        assert _create(anonymous_client, world, **over).status_code == 422, over


def test_a_candidate_is_never_added_without_a_resume(anonymous_client, test_db, world):
    """07 Q58 (Abdul, 2026-11-06): no résumé read, no candidate."""
    from backend.models.candidates import Candidate
    before = test_db.query(Candidate).count()
    r = _create(anonymous_client, world, resume_parse_id=None)
    assert r.status_code == 400 and "résumé" in r.json()["detail"]
    assert test_db.query(Candidate).count() == before


def test_a_candidate_with_a_resume_file_gets_an_upload_base(anonymous_client, test_db, world):
    from backend.models.candidates import BaseResume
    row = _parse(test_db, world)
    c = _create(anonymous_client, world, resume_parse_id=str(row.id)).json()
    (base,) = test_db.query(BaseResume).filter(BaseResume.candidate_id == c["id"]).all()
    assert (base.source, base.resume_parse_id) == ("UPLOAD", row.id)


def test_industries_and_deal_breakers_are_flat_columns(anonymous_client, world):
    c = _create(anonymous_client, world, preferred_industries=[" fintech ", ""], deal_breakers=["no travel"]).json()
    assert (c["preferred_industries"], c["deal_breakers"]) == (["fintech"], ["no travel"])
    plain = _create(anonymous_client, world).json()
    assert (plain["preferred_industries"], plain["deal_breakers"]) == ([], [])


# ── Mandatory fields: the backend checks they were sent and works nothing out ─

MANDATORY = ["full_name", "primary_role", "email", "phone", "country", "years_experience", "work_auth",
             "needs_sponsorship", "needs_transfer", "employment_types", "target_roles", "manager_id"]


def _without(world, field):
    body = _body(world)
    body.pop(field)
    return body


@pytest.mark.parametrize("field", MANDATORY)
def test_a_create_without_a_mandatory_field_is_refused_naming_the_field(anonymous_client, world, field):
    r = anonymous_client.post(f"/api/firms/{world['firm'].id}/candidates", json=_without(world, field),
                              headers=world["as"]["owner"])
    assert r.status_code == 422
    assert [e["loc"][-1] for e in r.json()["detail"]] == [field]


@pytest.mark.parametrize("field,blank", [("full_name", "   "), ("primary_role", ""), ("phone", " "), ("country", ""),
                                         ("employment_types", []), ("target_roles", []), ("target_roles", ["  "])])
def test_a_blank_or_empty_mandatory_field_is_refused(anonymous_client, world, field, blank):
    r = _create(anonymous_client, world, **{field: blank})
    assert r.status_code == 422 and field in {part for e in r.json()["detail"] for part in e["loc"]}


@pytest.mark.parametrize("field", ["needs_sponsorship", "needs_transfer", "years_experience"])
def test_a_null_mandatory_field_is_refused(anonymous_client, world, field):
    r = _create(anonymous_client, world, **{field: None})
    assert r.status_code == 422


def test_sponsorship_and_transfer_are_stored_as_sent_whatever_the_work_authorization(anonymous_client, world):
    c = _create(anonymous_client, world, work_auth="H1B", needs_sponsorship=False, needs_transfer=False).json()
    assert (c["needs_sponsorship"], c["needs_transfer"]) == (False, False)          # nothing is worked out or checked
    c = _create(anonymous_client, world, work_auth="USC", needs_sponsorship=True, needs_transfer=True).json()
    assert (c["needs_sponsorship"], c["needs_transfer"]) == (True, True)
    assert c["country"] == "US" and c["phone"] == "+1 555 0100" and c["years_experience"] == 9


def test_a_new_work_authorization_in_an_edit_must_carry_both_values(anonymous_client, world):
    c = _create(anonymous_client, world, work_auth="GC", needs_sponsorship=False, needs_transfer=False, bde="adnan").json()
    url = f"/api/firms/{world['firm'].id}/candidates/{c['id']}"
    mine = world["as"]["fatima"]                 # the candidate's manager (07 Q56: the profile isn't the BDE's)
    r = anonymous_client.patch(url, json={"work_auth": "H1B"}, headers=mine)
    assert r.status_code == 400 and "needs_sponsorship and needs_transfer" in r.json()["detail"]
    r = anonymous_client.patch(url, json={"work_auth": "H1B", "needs_sponsorship": True}, headers=mine)
    assert r.status_code == 400 and "needs_transfer" in r.json()["detail"]
    r = anonymous_client.patch(url, json={"work_auth": "H1B", "needs_sponsorship": True, "needs_transfer": True}, headers=mine)
    assert r.status_code == 200 and (r.json()["needs_sponsorship"], r.json()["needs_transfer"]) == (True, True)
    # The same work authorization again needs nothing; an entered value is kept; a null is refused.
    assert anonymous_client.patch(url, json={"work_auth": "H1B", "rate_target": 80}, headers=mine).status_code == 200
    assert anonymous_client.patch(url, json={"needs_sponsorship": False}, headers=mine).json()["needs_sponsorship"] is False
    for field in ("needs_sponsorship", "needs_transfer"):
        assert anonymous_client.patch(url, json={field: None}, headers=mine).status_code == 400


# ── The résumé parse ─────────────────────────────────────────────────────────

def _parse(test_db, world, minutes=30):
    from backend.models.candidates import ResumeParse
    from backend.models.db import utcnow
    row = ResumeParse(firm_id=world["firm"].id, uploaded_by_user_id=world["people"]["fatima"].id, file_name="r.pdf",
                      mime_type="application/pdf", size_bytes=1, content=b"x", parse={"header": {}},
                      expires_at=utcnow() + timedelta(minutes=minutes))
    test_db.add(row)
    test_db.commit()
    return row


def test_a_create_keeps_its_parse_once(anonymous_client, test_db, world):
    row = _parse(test_db, world)
    c = _create(anonymous_client, world, resume_parse_id=str(row.id)).json()
    test_db.refresh(row)
    assert (str(row.candidate_id), row.expires_at) == (c["id"], None)
    again = _create(anonymous_client, world, resume_parse_id=str(row.id))
    assert again.status_code == 404 and again.json()["detail"] == "That résumé read has expired. Upload it again."
    expired = _parse(test_db, world, minutes=-1)
    assert _create(anonymous_client, world, resume_parse_id=str(expired.id)).status_code == 404


# ── The candidate limit (Q45) ────────────────────────────────────────────────

def test_assigning_a_bde_is_blocked_at_the_limit_and_a_queue_never_is(anonymous_client, test_db, world):
    world["firm"].candidate_limit = 1
    test_db.commit()
    assert _create(anonymous_client, world, bde="adnan").status_code == 201
    r = _create(anonymous_client, world, bde="sneha")
    assert r.status_code == 409
    assert r.json()["detail"] == ("Your plan allows 1 assigned candidate; 1 is assigned. "
                                  "Hand this candidate to a manager instead, or free a slot.")
    queued = _create(anonymous_client, world).json()                            # to the queue: never blocked
    r = anonymous_client.post(f"/api/firms/{world['firm'].id}/candidates/{queued['id']}/assign", headers=world["as"]["owner"],
                              json={"manager_id": queued["manager_id"], "bde_id": str(world["people"]["sneha"].id)})
    assert r.status_code == 409


# ── Reading, in scope (Q47) ──────────────────────────────────────────────────

def test_each_principal_sees_their_scope(anonymous_client, world):
    _create(anonymous_client, world, full_name="Adnan's", bde="adnan")
    _create(anonymous_client, world, full_name="Queued")
    vik = _create(anonymous_client, world, full_name="Vikram's", manager="priya", bde="vikram").json()
    everyone = {"Adnan's", "Queued", "Vikram's"}
    assert _list(anonymous_client, world, "owner") == everyone
    assert _list(anonymous_client, world, "rohan") == everyone
    assert _list(anonymous_client, world, "fatima") == {"Adnan's", "Queued"}
    assert _list(anonymous_client, world, "priya") == {"Vikram's"}
    assert _list(anonymous_client, world, "adnan") == {"Adnan's"}
    url = f"/api/firms/{world['firm'].id}/candidates/{vik['id']}"
    assert anonymous_client.get(url, headers=world["as"]["fatima"]).status_code == 404
    assert anonymous_client.get(url, headers=world["as"]["vikram"]).status_code == 200


# ── Reassigning (Q43) ────────────────────────────────────────────────────────

def _assign(client, world, who, candidate, manager, bde=None, note=None):
    people = world["people"]
    return client.post(f"/api/firms/{world['firm'].id}/candidates/{candidate['id']}/assign", headers=world["as"][who],
                       json={"manager_id": str(people[manager].id), "bde_id": str(people[bde].id) if bde else None,
                             "note": note})


def test_the_owner_moves_a_candidate_across_teams_into_the_new_queue(anonymous_client, test_db, world):
    from backend.models.tenancy import ActivityEntry
    c = _create(anonymous_client, world, bde="adnan").json()
    r = _assign(anonymous_client, world, "owner", c, "priya", note="Over to you.")
    assert (r.json()["manager_id"], r.json()["bde_id"]) == (str(world["people"]["priya"].id), None)
    last = test_db.query(ActivityEntry).filter(ActivityEntry.entity_id == c["id"]).order_by(ActivityEntry.created_at.desc()).first()
    assert (last.action, last.summary, last.note) == ("ASSIGN", "Handed to Priya Shah (from Adnan Khan)", "Over to you.")
    assert _list(anonymous_client, world, "priya") == {"Ravi Teja"} and _list(anonymous_client, world, "adnan") == set()


def test_a_manager_moves_only_between_their_own_bdes(anonymous_client, world):
    c = _create(anonymous_client, world, bde="adnan").json()
    assert _assign(anonymous_client, world, "fatima", c, "fatima", "sneha").json()["bde_id"] == str(world["people"]["sneha"].id)
    assert _assign(anonymous_client, world, "fatima", c, "priya", "vikram").status_code == 403
    assert _assign(anonymous_client, world, "priya", c, "priya", "vikram").status_code == 404     # not in her scope
    assert _assign(anonymous_client, world, "adnan", c, "fatima", "adnan").status_code == 403     # a BDE never


def test_an_unchanged_assignment_writes_nothing(anonymous_client, test_db, world):
    from backend.models.tenancy import ActivityEntry
    c = _create(anonymous_client, world, bde="adnan").json()
    _assign(anonymous_client, world, "owner", c, "fatima", "adnan")
    assert test_db.query(ActivityEntry).filter(ActivityEntry.entity_id == c["id"], ActivityEntry.action == "ASSIGN").count() == 1


# ── Editing ──────────────────────────────────────────────────────────────────

def test_the_owner_and_manager_edit_the_profile_and_the_bde_does_not(anonymous_client, world):
    """07 Q56: the profile (submission facts) is the owner's and the candidate's manager's; the BDE edits résumés."""
    mine = _create(anonymous_client, world, bde="adnan").json()
    theirs = _create(anonymous_client, world, manager="priya", bde="vikram").json()
    url = f"/api/firms/{world['firm'].id}/candidates"
    r = anonymous_client.patch(f"{url}/{mine['id']}", json={"rate_target": 85, "rate_min": 70}, headers=world["as"]["fatima"])
    assert (r.status_code, r.json()["rate_target"]) == (200, 85.0)
    assert anonymous_client.patch(f"{url}/{mine['id']}", json={"rate_min": 90},
                                  headers=world["as"]["fatima"]).status_code == 400
    assert anonymous_client.patch(f"{url}/{theirs['id']}", json={"rate_target": 85},
                                  headers=world["as"]["fatima"]).status_code == 404     # another manager's candidate
    assert anonymous_client.patch(f"{url}/{theirs['id']}", json={"rate_target": 86},
                                  headers=world["as"]["owner"]).status_code == 200      # the owner: every candidate
    for who in ("adnan", "rohan"):                                                     # the BDE, the viewer
        assert anonymous_client.patch(f"{url}/{mine['id']}", json={"rate_target": 85},
                                      headers=world["as"][who]).status_code == 403
