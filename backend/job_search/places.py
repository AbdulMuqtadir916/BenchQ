"""What a candidate's search asks for (decided 2026-11-14): the role, and the places the BDE picks from.

- **The role** is the candidate's target role: the first one (onboarding takes one; a candidate created before that may
  have several, and keeps them: Q1, Q10, Q11). The primary role ("Marketed as") isn't searched.
- **The places**, in the picker's order (Q2, Q12, Q13): the résumé's city and state together ("Austin, TX"; a city
  without its state is ambiguous and doesn't count), then each preferred location, then "Remote" when the candidate's
  work settings include it (a preferred location that says "Remote" is that same place). The same place twice is one.
  The city and state are the résumé's, read like the country (the active base's newest version, `Candidate.city`).

A search sends one place, by its `value`: "City, ST" text, or `REMOTE`. The route accepts only one of the candidate's
own places, never free text.

The modes (decided 2026-11-17, Q122–Q124): a place's value says how one click searches:
- "City, ST": **On-site** in that city (LinkedIn, Indeed and freehire.me, all in the city);
- `HYBRID_PREFIX` + "City, ST": **Hybrid**, the city (LinkedIn, Indeed) plus remote jobs anywhere in the country
  (Indeed, freehire.me); listed when the candidate's work settings include hybrid;
- `REMOTE`: **Remote**, anywhere in the country (Indeed, freehire.me; LinkedIn's public search can't ask for remote).
"""
import re

from backend.job_search.providers.base import REMOTE

COUNTRY_NAMES = {"us": "the US", "ca": "Canada", "in": "India"}
HYBRID_PREFIX = "hybrid:"
_SPACES = re.compile(r"\s+")
_REMOTE_WORDS = re.compile(r"^(remote|anywhere|work from home|wfh)\b", re.I)


def _line(value) -> str:
    return _SPACES.sub(" ", value).strip() if isinstance(value, str) else ""


def search_role(candidate) -> str | None:
    """The candidate's first target role, or None."""
    return next((role for role in (_line(r) for r in candidate.target_roles or []) if role), None)


def search_titles(candidate) -> list[str]:
    """The role a search asks for, split into its titles the way Match reads a title (decided 2026-11-16, Q69): "|"
    separates titles, "GenAI / LLM Engineer" is "GenAI Engineer" or "LLM Engineer"; at most 4. One title: [it]."""
    from backend.match.job_quality import split_title
    role = search_role(candidate)
    return split_title(role) if role else []


def places(candidate, country: str | None) -> list[dict]:
    """The candidate's places for the picker: `{value, label, kind}` with kind `home`, `preferred` or `remote`."""
    out: list[dict] = []
    seen: set[str] = set()

    def add(value: str, label: str, kind: str) -> None:
        key = value.lower()
        if key not in seen:
            seen.add(key)
            out.append({"value": value, "label": label, "kind": kind})

    settings = set(candidate.work_settings or [])
    # Hybrid: when the candidate takes it, or says nothing about how they work (Q122).
    wants_hybrid = "HYBRID" in settings or not settings

    def add_city(value: str, kind: str) -> None:
        add(value, f"On-site · {value}", kind)
        if wants_hybrid:
            add(f"{HYBRID_PREFIX}{value}", f"Hybrid · {value} + remote", "hybrid")

    city, state = _line(candidate.city), _line(candidate.state)
    if city and state:
        add_city(f"{city}, {state}", "home")
    wants_remote = "REMOTE" in settings
    for preferred in (_line(p) for p in candidate.preferred_locations or []):
        if _REMOTE_WORDS.match(preferred):
            wants_remote = True
        elif preferred:
            add_city(preferred[:100], "preferred")
    if wants_remote:
        add(REMOTE, f"Remote (anywhere in {COUNTRY_NAMES.get(country or '', 'the country')})", "remote")
    return out


def pick(candidate, country: str | None, value: str) -> dict | None:
    """The candidate's place whose value is `value` (any letter case), or None when it isn't one of theirs."""
    wanted = _line(value).lower()
    return next((place for place in places(candidate, country) if place["value"].lower() == wanted), None)


def label(place: str | None) -> str:
    """How a stored place reads in the history and the Activity entry."""
    if place == REMOTE:
        return "Remote"
    mode, city = mode_of(place)
    return f"Hybrid · {city}" if mode == "hybrid" else (place or "the whole country")


def mode_of(place: str | None) -> tuple[str, str | None]:
    """("remote", None), ("hybrid", "City, ST") or ("onsite", "City, ST" or None) for a stored place (Q122)."""
    if place == REMOTE:
        return "remote", None
    if place and place.startswith(HYBRID_PREFIX):
        return "hybrid", place[len(HYBRID_PREFIX):]
    return "onsite", place
