"""The search country from the candidate's résumé country (decided 2026-11-10): the active base's newest version
(`Candidate.country`, backend/candidates/profile.py). Free text from the parser or the BDE, so it is matched to a code;
empty or unknown is refused, never defaulted to the US (no default country, PR 7)."""
import re

SEARCH_COUNTRIES = ("us", "ca", "in")

_NAMES = {
    "us": ("us", "usa", "united states", "united states of america", "america"),
    "ca": ("ca", "can", "canada"),
    "in": ("in", "ind", "india", "bharat"),
}
_LOOKUP = {name: code for code, names in _NAMES.items() for name in names}


def search_country(value) -> str | None:
    """`us`, `ca`, `in`, or None when `value` is empty or not one of them."""
    if not isinstance(value, str):
        return None
    key = re.sub(r"\s+", " ", value.replace(".", "").strip().lower())
    return _LOOKUP.get(key)
