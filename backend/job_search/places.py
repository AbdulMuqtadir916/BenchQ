"""What a candidate's search asks for (decided 2026-11-14): the role, and the places the BDE picks from.

- **The role** is the candidate's target role: the first one (onboarding takes one; a candidate created before that may
  have several, and keeps them: Q1, Q10, Q11). The primary role ("Marketed as") isn't searched.
- **The places**, in the picker's order (Q2, Q12, Q13): the résumé's city and state together ("Austin, TX"; a city
  without its state is ambiguous and doesn't count), then each preferred location, then "Remote" when the candidate's
  work settings include it (a preferred location that says "Remote" is that same place). The same place twice is one.
  The city and state are the résumé's, read like the country (the active base's newest version, `Candidate.city`).

A search sends one place, by its `value`: "City, ST" text, or `REMOTE`. The route accepts only one of the candidate's
own places, never free text.

The modes (decided 2026-11-17, Q122–Q124): how one click searches a place. The picker lists places only, each once
(Zuhair 2026-11-17: no "On-site ·" / "Hybrid ·" choices, as before); a city's mode comes from the candidate's work
settings, set in onboarding and on the details tab (`searched_place`), and the stored place says it:
- "City, ST": **On-site** in that city (LinkedIn, Indeed and freehire.me, all in the city), when the candidate's work
  settings don't include hybrid;
- `HYBRID_PREFIX` + "City, ST": **Hybrid**, the city (LinkedIn, Indeed) plus remote jobs anywhere in the country
  (Indeed, freehire.me), when they include hybrid or say nothing;
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

    def add_city(value: str, kind: str) -> None:
        add(value, value, kind)

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


def wants_hybrid(candidate) -> bool:
    """The candidate takes hybrid work, or says nothing about how they work (Q122)."""
    settings = set(candidate.work_settings or [])
    return "HYBRID" in settings or not settings


def searched_place(candidate, value: str) -> str:
    """The place a click stores and searches: a city with its mode from the work settings (hybrid → `HYBRID_PREFIX`
    + the city), `REMOTE` as it is."""
    return f"{HYBRID_PREFIX}{value}" if value != REMOTE and wants_hybrid(candidate) else value


def label(place: str | None) -> str:
    """How a stored place reads in the history and the Activity entry: the place only, never its mode."""
    if place == REMOTE:
        return "Remote"
    return mode_of(place)[1] or "the whole country"


def mode_of(place: str | None) -> tuple[str, str | None]:
    """("remote", None), ("hybrid", "City, ST") or ("onsite", "City, ST" or None) for a stored place (Q122)."""
    if place == REMOTE:
        return "remote", None
    if place and place.startswith(HYBRID_PREFIX):
        return "hybrid", place[len(HYBRID_PREFIX):]
    return "onsite", place
