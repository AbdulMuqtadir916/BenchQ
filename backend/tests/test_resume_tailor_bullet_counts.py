"""Bullets a role gets in a tailored résumé (backend/resume_tailor/bullet_counts.py; Zuhair 2026-11-17): 6, 4, then 3
for each older role. A role over its count keeps its first bullets; a short one gets its own unused résumé bullets,
the most relevant to the posting first, never one the draft already says in other words; a role whose résumé holds
fewer keeps what it has. And a database seeded with the old ranges gets the new wording, unless someone edited it.
Every résumé line is made up."""
from backend.resume_tailor import bullet_counts, prompts, settings

ROLES = [("Lead", 9), ("Engineer", 7), ("Developer", 5), ("Analyst", 2)]
BASE = {"experience": [{"title": title, "company": f"Co {i}", "start": "2018-01", "end": "", "bullets": [
    f"{title} task {n}: built pipeline {n} with Python." if n != 3 else f"{title} task 3: tuned Kafka streams for alerts."
    for n in range(1, count + 1)]} for i, (title, count) in enumerate(ROLES)]}


def _draft(*counts):
    return {"experience": [{"role_number": number, "bullets": [f"Rewritten point {number}.{n} about delivery."
                                                               for n in range(count)]}
                           for number, count in enumerate(counts, start=1)]}


def test_the_counts_are_6_4_then_3():
    assert [bullet_counts.wanted(n) for n in (1, 2, 3, 4, 9)] == [6, 4, 3, 3, 3]


def test_a_role_over_its_count_keeps_its_first_bullets():
    draft, added = bullet_counts.to_count(_draft(8, 4, 3, 2), BASE)
    assert [len(e["bullets"]) for e in draft["experience"]] == [6, 4, 3, 2] and added == 0
    assert draft["experience"][0]["bullets"][-1] == "Rewritten point 1.5 about delivery."


def test_a_short_role_gets_its_own_resume_bullets_most_relevant_first():
    """The older role had 2 (the handoff's ranges allowed it): it gets a third from its own résumé lines."""
    draft, added = bullet_counts.to_count(_draft(6, 4, 2, 2), BASE, keywords=["Kafka"])
    third = draft["experience"][2]["bullets"]
    assert len(third) == 3 and added == 1
    assert third[-1] == "Developer task 3: tuned Kafka streams for alerts."       # names the posting's keyword
    assert all(b in BASE["experience"][2]["bullets"] for b in third[2:])          # only that role's own lines
    assert len(draft["experience"][3]["bullets"]) == 2                            # its résumé holds only 2


def test_a_resume_bullet_the_draft_already_rewrote_is_not_added_again():
    draft = {"experience": [{"role_number": 3, "bullets": ["Developer task 3: tuned Kafka streams for alerts quickly.",
                                                           "Rewritten point."]}]}
    topped, added = bullet_counts.to_count(draft, BASE, keywords=["Kafka"])
    bullets = topped["experience"][0]["bullets"]
    assert added == 1 and "Developer task 3: tuned Kafka streams for alerts." not in bullets


def test_the_prompts_ask_for_the_counts():
    assert "Exactly 6 bullets for the most recent role, 4 for the previous one and 3 for each older role" in prompts.CV_RULES
    assert "4-6" not in prompts.CV_RULES and "2-3 a role" not in prompts.REVISE_PROMPT
    assert "exactly 6 for the most recent role" in prompts.VERIFY_PROMPT


def test_a_database_seeded_with_the_ranges_gets_the_counts_but_an_edit_stays(test_db):
    from backend.models.db import Setting
    rules = settings.PROMPT_ROWS["cv_rules"]
    revise = settings.PROMPT_ROWS["revise"]
    for key in (rules, revise):
        test_db.query(Setting).filter(Setting.key == key).delete()
    test_db.add(Setting(key=rules, value=settings._as_before(settings.DEFAULT_SETTINGS[rules][0])))
    test_db.add(Setting(key=revise, value="An owner's own revise prompt {writing_style} {cv_rules} {part_b} {draft} "
                                          "{resume} {posting}"))
    test_db.commit()
    changed = settings.upgrade_stored_defaults(test_db)
    test_db.commit()
    assert rules in changed and revise not in changed
    assert test_db.query(Setting).filter(Setting.key == rules).one().value == settings.DEFAULT_SETTINGS[rules][0]
    assert settings.upgrade_stored_defaults(test_db) == []                         # idempotent
