"""Whether an uploaded résumé is the candidate's (07 Q69, decided 2026-11-18).

Every upload after the candidate is added, whoever makes it, is checked on the file's own text (the extracted text,
OCR included) before the AI reads it: a refused file never reaches the parser. The candidate's name and email are the
ones fixed when they were added (07 Q68).

- **Email:** the candidate's email is among the email addresses in the text, case aside.
- **Name:** the first and last words of the candidate's name are words of the text: case, accents and punctuation
  aside, in any order; middle names may be missing or initials ("Ravi Reddy" is "Ravi Kumar Reddy"; "R. K. Reddy" isn't).
  Words inside an email address don't count: "ravi.reddy@…" alone isn't the name.

The email decides what the refusal says. A missing email or name is named; a résumé with someone else's email is only
"not this candidate's", never which part differs:

    no email in the text    name found      → "should contain the candidate's email"
    no email in the text    name not found  → "should contain the candidate's name and email"
    someone else's email    either          → not this candidate's
    the candidate's email   name not found  → "should contain the candidate's name"
    the candidate's email   name found      → accepted

Pure: no database, no logging (the caller logs the outcome's code with ids only, never the text or the name).
"""
import re
import unicodedata

MISSING_EMAIL = "The résumé should contain the candidate's email."
MISSING_NAME = "The résumé should contain the candidate's name."
MISSING_BOTH = "The résumé should contain the candidate's name and email."
NOT_THEIRS = "This résumé isn't for this candidate. Please upload this candidate's résumé."

_EMAIL = re.compile(r"[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}")
_NOT_WORD = re.compile(r"[^0-9a-z]+")


def _plain(text: str) -> str:
    """Lowercase, accents off ("José" is "jose"), anything but letters and digits a space."""
    decomposed = unicodedata.normalize("NFKD", text or "")
    return _NOT_WORD.sub(" ", "".join(ch for ch in decomposed if not unicodedata.combining(ch)).lower())


def name_words(full_name: str) -> list[str]:
    """The words the text must hold: the name's first and last (one, for a one-word name)."""
    words = _plain(full_name).split()
    return list(dict.fromkeys([words[0], words[-1]])) if words else []


def emails_in(text: str) -> set[str]:
    return {found.strip(".").lower() for found in _EMAIL.findall(text or "")}


def check(text: str, full_name: str, email: str | None) -> tuple[str, str | None]:
    """(code, message): `("ok", None)` when the résumé is the candidate's; otherwise a code for the log ("no_email",
    "no_name", "no_name_or_email", "not_theirs") and the message the person sees."""
    found = emails_in(text)
    words = set(_plain(_EMAIL.sub(" ", text or "")).split())    # the name from the text, never from an email address
    wanted = name_words(full_name)
    has_name = bool(wanted) and all(word in words for word in wanted)
    if not found:
        return ("no_email", MISSING_EMAIL) if has_name else ("no_name_or_email", MISSING_BOTH)
    if (email or "").strip().lower() not in found:
        return "not_theirs", NOT_THEIRS
    return ("ok", None) if has_name else ("no_name", MISSING_NAME)
