"""The Autofill screen's read and save (07 Q7, Q14, Q15, Q30, Q34, Q40–Q45; docs/02 §8.3): every question with its type,
an edit that stopped applying marked, and one route that changes a version's answers in place, for the rest of its
résumé too unless "Only this job"."""
import re
import uuid

import pytest

from backend.candidates import autofill
from backend.tests.r4_support import make_job
from backend.tests.resume_support import make_version
from backend.tests.test_autofill import CANDIDATE, TODAY, VERSION, _custom, _edit, _open, _stored
from backend.tests.test_candidates_api import world  # noqa: F401  (the fixture)
from backend.tests.test_resume_versions import _candidate, _listing, _save, _url, _v  # noqa: F401

WHY = "Why do you want to work here?"


def _patch(client, world, candidate, version_id, body, who="adnan"):
    return client.patch(_url(world, candidate, f"/{version_id}/autofill"), json=body, headers=world["as"][who])


def _editor(client, world, candidate, version_id, who="adnan") -> dict:
    opened = _open(client, world, candidate, version_id, who, autofill="true", editor="true")
    return {entry.get("key") or entry["question"]: entry for entry in opened["autofill"]}


# ── The read ────────────────────────────────────────────────────────────────

def test_the_editors_read_has_every_question_with_its_type_and_marks_an_edit_that_stopped_applying():
    typed = {"edited": {"address-region": _edit("Texas", "Tex.")}}                  # made over another built answer
    entries = autofill.merged({**CANDIDATE, "notice_period_days": None}, {**VERSION, "autofill": typed}, TODAY,
                              editor=True)
    by_key = {entry["key"]: entry for entry in entries if "key" in entry}
    assert list(by_key) == list(autofill.QUESTIONS) and set(autofill.ANSWER_TYPES) == set(autofill.QUESTIONS)
    assert by_key["notice-period-days"] == {"question": "What is your notice period in days?", "answer": None,
                                            "kind": "FIXED", "key": "notice-period-days", "type": "number"}
    assert by_key["address-region"] == {"question": "Which state do you live in?", "answer": "TX", "kind": "FIXED",
                                        "key": "address-region", "type": "text", "replaced": "Texas"}
    # The extension's read: no empty answers and no types, as before; the mark is there, which it ignores.
    plain = autofill.merged(CANDIDATE, {**VERSION, "autofill": typed}, TODAY)
    assert all("type" not in entry and entry["answer"] is not None for entry in plain)
    assert next(entry for entry in plain if entry.get("key") == "address-region")["replaced"] == "Texas"


def test_the_extensions_read_sends_the_wordings_forms_use_for_a_fixed_question_with_no_field_type():
    plain = {entry["key"]: entry for entry in autofill.merged(CANDIDATE, VERSION, TODAY) if "key" in entry}
    for key in ("visa-transfer", "work-settings", "employment-types"):
        assert plain[key]["also"] == autofill.ALSO[key]
    assert "also" not in plain["full-name"]
    # The Autofill screen's read is as before.
    assert not any("also" in entry for entry in autofill.merged(CANDIDATE, VERSION, TODAY, editor=True) if "key" in entry)


def test_an_added_question_keeps_its_place_and_sends_its_other_wordings():
    typed = {"custom": [_custom("Why us?", "Payments.", also=["What draws you to us?"]), _custom("Shift?", "Night")]}
    entries = autofill.merged(CANDIDATE, {**VERSION, "autofill": typed}, TODAY)
    assert entries[-2:] == [{"question": "Why us?", "answer": "Payments.", "kind": "CUSTOM",
                             "also": ["What draws you to us?"]},
                            {"question": "Shift?", "answer": "Night", "kind": "CUSTOM"}]


# ── What a save may change ──────────────────────────────────────────────────

@pytest.mark.parametrize("edit, add, message", [
    ({"no-such-key": "x"}, {}, "No question has the key 'no-such-key'."),
    ({"work-history": []}, {}, "Change it in the résumé itself."),
    ({"pay-rate": "ninety"}, {}, "it takes a number"),
    ({"pay-rate": True}, {}, "it takes a number"),
    ({"visa-sponsorship": "Yes"}, {}, "it takes yes or no"),
    ({"start-date": "2026-02-30"}, {}, "it takes a date (YYYY-MM-DD)"),
    ({"skills": [" ", ""]}, {}, "it takes a list of up to 100 short texts"),
    ({"summary": " "}, {}, "it takes text"),
    ({}, {"what is your FULL name": "Someone Else"}, "is one of BenchQ's own questions: change its answer instead."),
    ({}, {"Why us?": " "}, "is text, up to 4000 characters."),
    ({}, {}, "Nothing to save."),
])
def test_a_change_that_cant_be_kept_is_refused(edit, add, message):
    with pytest.raises(autofill.Refused, match=re.escape(message)):
        autofill.checked_change(edit, [], add, [])


def test_a_change_is_kept_as_the_answers_are_written():
    change = autofill.checked_change({"pay-rate": 95.0, "skills": [" Java ", "", "Go"], "summary": "  Nine years. "},
                                     ["github-url", "github-url"], {" Why us? ": " Payments. "}, [" Shift? "])
    assert change == {"edit": {"pay-rate": 95, "skills": ["Java", "Go"], "summary": "Nine years."},
                      "reset": ["github-url"], "add": {"Why us?": "Payments."}, "remove": ["Shift?"]}
    with pytest.raises(autofill.Refused, match="both changed and reset"):
        autofill.checked_change({"pay-rate": 90}, ["pay-rate"], {}, [])


# ── The route ───────────────────────────────────────────────────────────────

def test_an_edit_is_saved_in_place_over_the_built_answer_it_was_shown_and_a_reset_takes_it_back(anonymous_client,
                                                                                                 test_db, world):
    c = _candidate(anonymous_client, test_db, world, bde="adnan")
    v1 = _v(anonymous_client, world, c, who="adnan")
    title = _editor(anonymous_client, world, c, v1["id"])["professional-title"]["answer"]
    body = {"edit": {"professional-title": "Lead Engineer"}, "built": {"professional-title": title}}
    r = _patch(anonymous_client, world, c, v1["id"], body)
    assert r.status_code == 200, r.text
    edited = next(entry for entry in r.json()["autofill"] if entry.get("key") == "professional-title")
    assert (edited["kind"], edited["answer"], edited["built"], r.json()["changed"]) == ("EDITED", "Lead Engineer",
                                                                                        title, 1)
    assert _stored(test_db, v1["id"]).autofill == {"edited": {"professional-title": _edit("Lead Engineer", title)},
                                                   "custom": []}
    assert [len(base["versions"]) for base in _listing(anonymous_client, world, c, "adnan")["bases"]] == [1]
    r = _patch(anonymous_client, world, c, v1["id"], {"reset": ["professional-title"]})
    assert _editor(anonymous_client, world, c, v1["id"])["professional-title"]["kind"] == "FIXED"
    assert _stored(test_db, v1["id"]).autofill == {}


def test_an_edit_over_an_answer_the_user_didnt_see_is_refused(anonymous_client, test_db, world):
    c = _candidate(anonymous_client, test_db, world, bde="adnan")
    v1 = _v(anonymous_client, world, c, who="adnan")
    stale = {"edit": {"professional-title": "Lead Engineer"}, "built": {"professional-title": "Not what it is now"}}
    assert _patch(anonymous_client, world, c, v1["id"], stale).status_code == 409
    r = _patch(anonymous_client, world, c, v1["id"], {"edit": {"professional-title": "Lead Engineer"}})
    assert (r.status_code, r.json()["detail"]) == (400, "Send the built answer you were shown for professional-title.")
    r = _patch(anonymous_client, world, c, v1["id"], {"edit": {"work-history": []}, "built": {"work-history": None}})
    assert r.status_code == 400
    assert _patch(anonymous_client, world, c, v1["id"], {"add": {}, "surprise": 1}).status_code == 422
    assert _stored(test_db, v1["id"]).autofill == {}


def test_an_added_question_said_again_in_other_words_changes_its_answer_and_can_be_removed(anonymous_client, test_db,
                                                                                          world):
    c = _candidate(anonymous_client, test_db, world, bde="adnan")
    v1 = _v(anonymous_client, world, c, who="adnan")
    assert _patch(anonymous_client, world, c, v1["id"], {"add": {WHY: "Payments."}}).status_code == 200
    assert _patch(anonymous_client, world, c, v1["id"], {"add": {"why do you WANT to work here": "Fintech."}}
                  ).status_code == 200
    assert _stored(test_db, v1["id"]).autofill["custom"] == [_custom(WHY, "Fintech.")]
    r = _patch(anonymous_client, world, c, v1["id"], {"remove": [WHY]})
    assert WHY not in {entry["question"] for entry in r.json()["autofill"]}
    assert _stored(test_db, v1["id"]).autofill == {}


def test_a_save_reaches_the_rest_of_the_resume_that_answers_the_same_unless_only_this_job(anonymous_client, test_db,
                                                                                          world):
    from backend.models.candidates import Candidate
    from backend.models.tenancy import LedgerEntry
    c = _candidate(anonymous_client, test_db, world, bde="adnan")
    v1 = _v(anonymous_client, world, c, who="adnan")
    v2 = _save(anonymous_client, world, c, v1, "adnan", summary="An edited summary.").json()       # the newest
    candidate = test_db.get(Candidate, uuid.UUID(c["id"]))
    a, b = (make_version(test_db, world["firm"].id, candidate=candidate, category="TAILORED", job_id=make_job(test_db).id,
                         full_name="Ravi Teja") for _ in range(2))
    test_db.commit()
    a_id, b_id = str(a.id), str(b.id)

    # A new question goes to every job: the base's newest version and each tailored résumé, never the older v1.
    r = _patch(anonymous_client, world, c, v2["id"], {"add": {WHY: "Payments."}})
    assert r.json()["changed"] == 3
    custom = lambda version_id: (_stored(test_db, version_id).autofill or {}).get("custom")    # noqa: E731
    assert [custom(v) for v in (v2["id"], a_id, b_id, v1["id"])] == [[_custom(WHY, "Payments.")]] * 3 + [None]

    # "Only this job" keeps an answer to one; a later save for all jobs leaves it, and updates the ones that matched.
    assert _patch(anonymous_client, world, c, b_id, {"add": {WHY: "Their stack."}, "only_this": True}
                  ).json()["changed"] == 1
    assert _patch(anonymous_client, world, c, v2["id"], {"add": {WHY: "Fintech."}}).json()["changed"] == 2
    assert [custom(v)[0]["answer"] for v in (v2["id"], a_id, b_id)] == ["Fintech.", "Fintech.", "Their stack."]

    # A fixed answer reaches the tailored résumés over their own built answer, which is what `over` keeps there.
    title = _editor(anonymous_client, world, c, v2["id"])["professional-title"]["answer"]
    r = _patch(anonymous_client, world, c, v2["id"], {"edit": {"professional-title": "Lead Engineer"},
                                                      "built": {"professional-title": title}})
    assert r.status_code == 200, r.text
    assert _editor(anonymous_client, world, c, a_id)["professional-title"]["answer"] == "Lead Engineer"

    # One activity entry per save: the questions, never the answers.
    test_db.expire_all()
    last = test_db.query(LedgerEntry).filter(LedgerEntry.entity_id == v2["id"]).order_by(LedgerEntry.created_at.desc()).first()
    assert '"What is your professional title?"' in last.summary and "Lead Engineer" not in last.summary


def test_only_the_bde_who_changes_the_resume_saves(anonymous_client, test_db, world):
    c = _candidate(anonymous_client, test_db, world, bde="adnan")
    v1 = _v(anonymous_client, world, c, who="adnan")
    body = {"add": {WHY: "Payments."}}
    assert _patch(anonymous_client, world, c, v1["id"], body, who="owner").status_code == 403    # a BDE has it (Q55)
    assert _patch(anonymous_client, world, c, v1["id"], body, who="rohan").status_code == 403    # a viewer reads
    assert _patch(anonymous_client, world, c, v1["id"], body, who="vikram").status_code == 404   # not in their scope
    assert _patch(anonymous_client, world, c, uuid.uuid4(), body).status_code == 404
    assert _stored(test_db, v1["id"]).autofill == {}
