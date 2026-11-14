"""The Mads tailor's last step, in code: every bullet checked against its own role.

A tool, technique or number a bullet names must be stated by that role's own lines in the résumé (its title, employer
and bullets). The résumé's skills list does not count, nor does another role: a tool listed only under skills, a
number from another job, or a narrower name than the role uses ("EKS" where the role says "Kubernetes") is
unsupported. An unsupported item of a list is taken out of the list; otherwise the bullet goes back to the role's
résumé bullet most like it, or is dropped when that bullet is already in the copy.

The checks are the focused copy's (focused_tailor_checks); only what a bullet may draw on is narrower here.
"""
import difflib
import json

from backend.resume_tailor import resume_bits as rs
from backend.resume_tailor.copy_builder import _bullets_of, _roles
from backend.resume_tailor.checks import _with_the_unsupported_items_taken_out, unsupported_in

TAKEN_OUT, PUT_BACK, DROPPED = "taken out of the list", "back to the résumé's bullet", "dropped"


def checked_against_each_role(draft: dict, base: dict) -> tuple:
    """(the draft with every bullet its role supports, what was changed and why)."""
    draft = json.loads(json.dumps(draft or {}))
    roles = _roles(base or {})
    vocabulary = rs._resume_vocabulary(base or {})
    changes = []
    for entry in draft.get("experience") or []:
        number = entry.get("role_number") if isinstance(entry, dict) else None
        if not isinstance(number, int) or not 1 <= number <= len(roles):
            continue
        base_bullets = _bullets_of(roles[number - 1])
        role = {key: value for key, value in roles[number - 1].items() if key != "suggested_bullets"}
        what_the_role_states = json.dumps({**role, "bullets": base_bullets}, ensure_ascii=False)
        kept = []
        for bullet in entry.get("bullets") or []:
            text = rs._text(bullet).strip()
            if not text:
                continue
            checked, change = _checked(text, base_bullets, what_the_role_states, vocabulary, kept)
            if change:
                changes.append({"role_number": number, **change})
            if checked:
                kept.append(checked)
        entry["bullets"] = kept
    return draft, changes


def _checked(text: str, base_bullets: list, what_the_role_states: str, vocabulary: set, kept: list) -> tuple:
    """(the bullet as its role supports it, or "" to drop it; the change made, or None)."""
    prose = " ".join(base_bullets)
    unsupported = unsupported_in(text, what_the_role_states, vocabulary, {}, prose=prose)
    if not unsupported:
        return text, None
    change = {"was": text, "unsupported": unsupported}
    shorter = _with_the_unsupported_items_taken_out(text, unsupported, what_the_role_states, vocabulary, {}, prose)
    if shorter:
        return shorter, {**change, "now": shorter, "action": TAKEN_OUT}
    closest = difflib.get_close_matches(text, base_bullets, 1, 0.0)
    if closest and closest[0] not in kept:
        return closest[0], {**change, "now": closest[0], "action": PUT_BACK}
    return "", {**change, "now": "", "action": DROPPED}
