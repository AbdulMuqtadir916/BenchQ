"""The upload's name-and-email check (backend/candidates/identity_check.py; 07 Q69, decided 2026-11-18). Pure."""
import pytest

from backend.candidates.identity_check import MISSING_BOTH, MISSING_EMAIL, MISSING_NAME, NOT_THEIRS, check, name_words


def test_the_name_is_its_first_and_last_words():
    assert name_words("Ravi Kumar Reddy") == ["ravi", "reddy"]
    assert name_words("  José   Ñúñez ") == ["jose", "nunez"]
    assert name_words("Madhuri") == ["madhuri"]
    assert name_words("") == []


@pytest.mark.parametrize("text,expected", [
    ("Ravi Reddy · ravi@example.com", ("ok", None)),                          # the middle name may be missing
    ("REDDY, Ravi K. — RAVI@EXAMPLE.COM", ("ok", None)),                      # case and order aside
    ("R. K. Reddy · ravi@example.com", ("no_name", MISSING_NAME)),            # an initial isn't the first name
    ("Contact: ravi.reddy@example.com", ("not_theirs", NOT_THEIRS)),         # another address
    ("Ravi Reddy, Dallas", ("no_email", MISSING_EMAIL)),
    ("Senior Java Developer", ("no_name_or_email", MISSING_BOTH)),
    ("ravi.reddy.cv@example.com ravi@example.com", ("no_name", MISSING_NAME)),   # an address's words aren't the name
])
def test_the_email_decides_what_the_refusal_says(text, expected):
    assert check(text, "Ravi Kumar Reddy", "Ravi@Example.com") == expected


def test_accents_dont_matter():
    assert check("JOSE NUNEZ\njose@example.com", "José Núñez", "jose@example.com") == ("ok", None)
