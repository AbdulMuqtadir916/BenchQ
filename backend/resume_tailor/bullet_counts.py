"""How many bullets each role gets in a tailored résumé (Zuhair 2026-11-17: 6, 4, then 3 for each older role; replaces
the handoff's ranges 4-6, 3-4, 2-3, under which the model often gave an older role 2).

The prompts ask for the counts and the verify step cuts a role that is over; the model can't add a bullet through an
edit, so this runs after the fact gate: a role over its count keeps its first bullets (the draft puts the most relevant
first), and a role under it gets that role's own unused bullets from the résumé, those naming more of the posting's
keywords first. A role whose résumé lines hold fewer keeps what it has. Nothing here writes a word the résumé doesn't.
"""
import re

from backend.resume_tailor import resume_bits as rs
from backend.resume_tailor.copy_builder import _bullets_of, _roles

FIRST_ROLES = (6, 4)           # the most recent role, then the previous one
OLDER_ROLE = 3                 # each older role
_WORDS = re.compile(r"[a-z0-9+#]+")
# A résumé bullet is one the draft already rewrote when this share of its content words (4+ letters) is in one draft
# bullet: a rewrite keeps the tools and the nouns.
SAME_CLAIM = 0.5


def wanted(role_number: int) -> int:
    """The bullets role `role_number` gets (1 is the most recent)."""
    return FIRST_ROLES[role_number - 1] if 1 <= role_number <= len(FIRST_ROLES) else OLDER_ROLE


def _words(text: str) -> set:
    return {word for word in _WORDS.findall(text.lower()) if len(word) >= 4}


def _already_said(candidate: str, kept: list) -> bool:
    words = _words(candidate)
    return bool(words) and any(len(words & _words(bullet)) / len(words) >= SAME_CLAIM for bullet in kept)


def to_count(draft: dict, base: dict, keywords=()) -> tuple:
    """(the draft with each role at its count where the résumé allows, how many bullets were added). `keywords` are the
    posting's (the analysis step's), to pick the most relevant of a role's unused bullets."""
    roles = _roles(base or {})
    terms = [str(k).lower() for k in keywords if str(k).strip()]
    added = 0
    for entry in draft.get("experience") or []:
        number = entry.get("role_number") if isinstance(entry, dict) else None
        if not isinstance(number, int) or not 1 <= number <= len(roles):
            continue
        unused = [rs._text(b).strip() for b in _bullets_of(roles[number - 1]) if rs._text(b).strip()]
        bullets = [b for b in (entry.get("bullets") or []) if rs._text(b).strip()]
        if len(bullets) > wanted(number):
            entry["bullets"] = bullets[:wanted(number)]
            continue
        want = min(wanted(number), len(unused))      # never more bullets than the role's résumé holds
        ranked = sorted(enumerate(unused), key=lambda pair: (-sum(term in pair[1].lower() for term in terms), pair[0]))
        for _, bullet in ranked:
            if len(bullets) >= want:
                break
            if not _already_said(bullet, [rs._text(b) for b in bullets]):
                bullets.append(bullet)
                added += 1
        entry["bullets"] = bullets
    return draft, added
