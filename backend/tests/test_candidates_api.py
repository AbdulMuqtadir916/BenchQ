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
    return {"firm": firm, "people": people, "as": cookies}


def _body(world, manager="fatima", bde=None, **over):
    people = world["people"]
    return {"full_name": "Ravi Teja", "primary_role": "Java Developer", "email": "Ravi@Example.com", "work_auth": "H1B",
            "employment_types": ["C2C"], "manager_id": str(people[manager].id),
            "bde_id": str(people[bde].id) if bde else None, "skills": [{"name": "Java", "source": "RESUME_UPLOAD"}],
            "summary": "Nine years of Java.", **over}


def _create(client, world, who="owner", **kwargs):
    return client.post(f"/api/firms/{world['firm'].id}/candidates", json=_body(world, **kwargs), headers=world["as"][who])


def _list(client, world, who):
    return {c["full_name"] for c in client.get(f"/api/firms/{world['firm'].id}/candidates", headers=world["as"][who]).json()}


# ── Creating ─────────────────────────────────────────────────────────────────

def test_the_owner_hands_a_candidate_to_a_manager_and_nothing_is_verified(anonymous_client, test_db, world):
    from backend.models.tenancy import LedgerEntry
    r = _create(anonymous_client, world, handoff_note="  Prefers banking.  ")
    assert r.status_code == 201, r.text
    c = r.json()
    assert (c["manager_id"], c["bde_id"], c["status"], c["email"]) == (str(world["people"]["fatima"].id), None,
                                                                       "ON_BENCH", "ravi@example.com")
    assert not {"persona", "skills", "summary_state"} & set(c)            # the Record's now (migration 0015)
    assert c["target_roles"] == ["Java Developer"]
    entries = test_db.query(LedgerEntry).filter(LedgerEntry.entity_id == c["id"]).order_by(LedgerEntry.created_at).all()
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


def test_a_candidate_without_a_resume_file_gets_a_manual_base_and_a_record_from_the_form(anonymous_client, test_db, world):
    """Migration 0015: every candidate has a base; with no file its v1 holds what the form holds, and each item is an
    UNVERIFIED claim with no evidence."""
    from backend.models.candidates import BaseResume, Claim
    from backend.models.db import Resume
    c = _create(anonymous_client, world, city="Dallas", state="TX").json()
    (base,) = test_db.query(BaseResume).filter(BaseResume.candidate_id == c["id"]).all()
    assert (base.source, base.resume_parse_id, base.is_active) == ("MANUAL", None, True)
    (v1,) = test_db.query(Resume).filter(Resume.base_resume_id == base.id).all()
    assert (v1.category, v1.version, v1.full_name, v1.title, v1.email) == ("BASE", 1, "Ravi Teja", "Java Developer",
                                                                            "ravi@example.com")
    assert (v1.summary, v1.city, v1.state, v1.country, v1.github) == ("Nine years of Java.", "Dallas", "TX", None, None)
    assert v1.experiences == [] and v1.educations == [] and v1.projects == []
    claims = test_db.query(Claim).filter(Claim.candidate_id == c["id"]).all()
    assert {(k.entity_type, k.text, k.state, k.entity_ref, k.evidence_id) for k in claims} == {
        ("summary", "Nine years of Java.", "UNVERIFIED", v1.summary_id, None),
        ("skill", "Java", "UNVERIFIED", v1.skills[0]["id"], None)}
    assert {k.source for k in claims if k.entity_type == "skill"} == {"RESUME_UPLOAD"}     # the form's own source
    assert {k.source for k in claims if k.entity_type == "summary"} == {"MANUAL"}


def test_a_candidate_with_a_resume_file_gets_an_upload_base_and_claims_sharing_one_evidence_row(anonymous_client, test_db,
                                                                                                world):
    from backend.models.candidates import BaseResume, Claim, Evidence
    row = _parse(test_db, world)
    c = _create(anonymous_client, world, resume_parse_id=str(row.id)).json()
    (base,) = test_db.query(BaseResume).filter(BaseResume.candidate_id == c["id"]).all()
    assert (base.source, base.resume_parse_id) == ("UPLOAD", row.id)
    (evidence,) = test_db.query(Evidence).filter(Evidence.candidate_id == c["id"]).all()
    assert (evidence.resume_parse_id, evidence.source, evidence.excerpt) == (row.id, "RESUME_UPLOAD", None)
    claims = test_db.query(Claim).filter(Claim.candidate_id == c["id"]).all()
    assert claims and {k.state for k in claims} == {"UNVERIFIED"} and {k.evidence_id for k in claims} == {evidence.id}
    assert {k.source for k in claims if k.entity_type == "summary"} == {"RESUME_UPLOAD"}


def test_the_record_has_a_claim_for_every_item_but_languages(test_db, default_firm):
    from backend.candidates.record import write_record
    from backend.models.candidates import Candidate, Claim
    from backend.models.tenancy import DEFAULT_FIRM_ID
    from backend.tests.resume_support import make_version
    row = make_version(test_db, DEFAULT_FIRM_ID, full_name="Asha", summary="A summary.", summary_id="sum-1",
                       experiences=[{"id": "e1", "job_title": "Dev", "company": "Acme", "dates": "2020-2024",
                                     "bullets": [{"id": "b1", "text": "Built it."}, {"id": "b2", "text": "Shipped it."}]}],
                       projects=[{"id": "p1", "name": "Tool", "technologies": "Go", "bullets": [{"id": "pb1", "text": "Wrote it."}]}],
                       educations=[{"id": "d1", "degree": "BSc", "institution": "Uni", "graduation_date": "2019"}],
                       certifications=[{"id": "c1", "name": "AWS", "issuer": "Amazon", "date": "2022"}],
                       awards=[{"id": "a1", "name": "Best", "issuer": "Acme", "date": "2023"}],
                       languages=[{"id": "l1", "name": "English"}],
                       skills=[{"id": "s1", "category": "core", "name": "Python"}])
    candidate = test_db.get(Candidate, row.candidate_id)
    version = test_db.get(type(row), row.id)
    assert write_record(test_db, candidate, version) == 10
    got = {(k.entity_type, k.entity_ref) for k in test_db.query(Claim).filter(Claim.candidate_id == candidate.id)}
    assert got == {("summary", "sum-1"), ("skill", "s1"), ("experience", "e1"), ("experience", "b1"),
                   ("experience", "b2"), ("project", "p1"), ("project", "pb1"), ("education", "d1"),
                   ("certificate", "c1"), ("award", "a1")}                       # none for the language
    assert {k.state for k in test_db.query(Claim)} == {"UNVERIFIED"}


def test_industries_and_deal_breakers_are_flat_columns(anonymous_client, world):
    c = _create(anonymous_client, world, preferred_industries=[" fintech ", ""], deal_breakers=["no travel"]).json()
    assert (c["preferred_industries"], c["deal_breakers"]) == (["fintech"], ["no travel"])
    plain = _create(anonymous_client, world).json()
    assert (plain["preferred_industries"], plain["deal_breakers"]) == ([], [])


# ── Sponsorship: what was entered wins, else it follows the work authorization ─

@pytest.mark.parametrize("auth,sponsor,transfer", [("H1B", True, True), ("OPT", True, False), ("TN", True, False),
                                                   ("GC", False, False), ("USC", False, False), ("OTHER", None, False)])
def test_sponsorship_is_worked_out_from_the_work_authorization_when_not_entered_and_unknown_for_other(anonymous_client, world, auth, sponsor,
                                                                                transfer):
    c = _create(anonymous_client, world, work_auth=auth).json()
    assert (c["needs_sponsorship"], c["needs_transfer"]) == (sponsor, transfer)


def test_an_entered_sponsorship_wins_over_the_rule(anonymous_client, world):
    c = _create(anonymous_client, world, work_auth="OTHER", needs_sponsorship=True, needs_transfer=False).json()
    assert (c["needs_sponsorship"], c["needs_transfer"]) == (True, False)
    c = _create(anonymous_client, world, work_auth="H1B", needs_sponsorship=False, needs_transfer=False).json()
    assert (c["needs_sponsorship"], c["needs_transfer"]) == (False, False)


def test_changing_the_work_authorization_works_sponsorship_out_again_unless_entered(anonymous_client, world):
    c = _create(anonymous_client, world, work_auth="GC", bde="adnan").json()
    url = f"/api/firms/{world['firm'].id}/candidates/{c['id']}"
    mine = world["as"]["adnan"]
    r = anonymous_client.patch(url, json={"work_auth": "H1B"}, headers=mine).json()
    assert (r["needs_sponsorship"], r["needs_transfer"]) == (True, True)
    r = anonymous_client.patch(url, json={"work_auth": "USC"}, headers=mine).json()
    assert (r["needs_sponsorship"], r["needs_transfer"]) == (False, False)
    r = anonymous_client.patch(url, json={"work_auth": "OTHER", "needs_sponsorship": True}, headers=mine).json()
    assert (r["needs_sponsorship"], r["needs_transfer"]) == (True, False)
    r = anonymous_client.patch(url, json={"rate_target": 80}, headers=mine).json()           # no work_auth change: kept
    assert r["needs_sponsorship"] is True
    r = anonymous_client.patch(url, json={"work_auth": "OPT", "needs_sponsorship": None}, headers=mine).json()
    assert (r["needs_sponsorship"], r["needs_transfer"]) == (True, False)                  # null counts as not entered
    r = anonymous_client.patch(url, json={"work_auth": "OTHER"}, headers=mine).json()
    assert (r["needs_sponsorship"], r["needs_transfer"]) == (None, False)                  # no rule for Other: unknown


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
    from backend.models.tenancy import LedgerEntry
    c = _create(anonymous_client, world, bde="adnan").json()
    r = _assign(anonymous_client, world, "owner", c, "priya", note="Over to you.")
    assert (r.json()["manager_id"], r.json()["bde_id"]) == (str(world["people"]["priya"].id), None)
    last = test_db.query(LedgerEntry).filter(LedgerEntry.entity_id == c["id"]).order_by(LedgerEntry.created_at.desc()).first()
    assert (last.action, last.summary, last.note) == ("ASSIGN", "Handed to Priya Shah (from Adnan Khan)", "Over to you.")
    assert _list(anonymous_client, world, "priya") == {"Ravi Teja"} and _list(anonymous_client, world, "adnan") == set()


def test_a_manager_moves_only_between_their_own_bdes(anonymous_client, world):
    c = _create(anonymous_client, world, bde="adnan").json()
    assert _assign(anonymous_client, world, "fatima", c, "fatima", "sneha").json()["bde_id"] == str(world["people"]["sneha"].id)
    assert _assign(anonymous_client, world, "fatima", c, "priya", "vikram").status_code == 403
    assert _assign(anonymous_client, world, "priya", c, "priya", "vikram").status_code == 404     # not in her scope
    assert _assign(anonymous_client, world, "adnan", c, "fatima", "adnan").status_code == 403     # a BDE never


def test_an_unchanged_assignment_writes_nothing(anonymous_client, test_db, world):
    from backend.models.tenancy import LedgerEntry
    c = _create(anonymous_client, world, bde="adnan").json()
    _assign(anonymous_client, world, "owner", c, "fatima", "adnan")
    assert test_db.query(LedgerEntry).filter(LedgerEntry.entity_id == c["id"], LedgerEntry.action == "ASSIGN").count() == 1


# ── Editing ──────────────────────────────────────────────────────────────────

def test_a_bde_edits_the_facts_of_their_own_candidate(anonymous_client, world):
    mine = _create(anonymous_client, world, bde="adnan").json()
    theirs = _create(anonymous_client, world, manager="priya", bde="vikram").json()
    url = f"/api/firms/{world['firm'].id}/candidates"
    r = anonymous_client.patch(f"{url}/{mine['id']}", json={"rate_target": 85, "rate_min": 70}, headers=world["as"]["adnan"])
    assert (r.status_code, r.json()["rate_target"]) == (200, 85.0)
    assert anonymous_client.patch(f"{url}/{mine['id']}", json={"rate_min": 90},
                                  headers=world["as"]["adnan"]).status_code == 400
    assert anonymous_client.patch(f"{url}/{theirs['id']}", json={"rate_target": 85},
                                  headers=world["as"]["adnan"]).status_code == 404
    assert anonymous_client.patch(f"{url}/{mine['id']}", json={"rate_target": 85},
                                  headers=world["as"]["rohan"]).status_code == 403
