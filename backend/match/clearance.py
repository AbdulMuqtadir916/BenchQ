"""Security clearances, plain code: what a posting requires the candidate to hold already.

A posting needs a clearance when a line naming one says it is active, current, required or must be held; a line
offering "the ability to obtain" one, or a Public Trust (granted after hire), asks for nothing the candidate must hold
already. The 2026-11-08 fit test found 12 of 97 shown jobs needed a clearance the candidate did not hold.
"""
import re

# Held clearances, lowest first. "" (none) is not listed: it is always accepted and ranks below all of these.
CLEARANCES = ("PUBLIC_TRUST", "SECRET", "TOP_SECRET", "TS_SCI", "TS_SCI_POLY")
NAMES = {"": "no clearance", "PUBLIC_TRUST": "Public Trust", "SECRET": "Secret", "TOP_SECRET": "Top Secret",
         "TS_SCI": "TS/SCI", "TS_SCI_POLY": "TS/SCI with polygraph"}

_POLY = re.compile(r"\bpoly(graph)?\b|\bci[- ]poly|full[- ]scope", re.I)
_TS_SCI = re.compile(r"\bts\s*/\s*sci\b|\bts-sci\b|top secret\s*/\s*sci|top secret\s*\(?sci\b", re.I)
_TOP = re.compile(r"\btop secret\b", re.I)
_SECRET = re.compile(r"\bsecret\b", re.I)
_CLEARANCE_WORD = re.compile(r"\bclearance\b|\bcleared\b", re.I)
_MUST = re.compile(r"\b(active|current|must|required|requires|require|possess|hold|holding|cleared|"
                   r"clearance (type|required|requirements?)|with an?)\b", re.I)
_PREFERRED = re.compile(r"prefer|a plus|nice to have|desired|bonus", re.I)
_OBTAINABLE = re.compile(r"(ability|able|eligible|eligibility|willing(ness)?) to obtain|obtain and maintain|"
                         r"or the ability|be obtained|sponsor(ship)? (for|of) (a |the )?clearance", re.I)


def rank(held: str) -> int:
    """0 for none, 1 Public Trust … 5 TS/SCI with polygraph."""
    return CLEARANCES.index(held) + 1 if held in CLEARANCES else 0


def _level(line: str) -> int:
    if _TS_SCI.search(line) or _TOP.search(line):
        if _POLY.search(line):
            return rank("TS_SCI_POLY")
        return rank("TS_SCI") if _TS_SCI.search(line) else rank("TOP_SECRET")
    if _SECRET.search(line) and _CLEARANCE_WORD.search(line):
        return rank("SECRET")
    return 0


def _lines(text: str) -> list:
    return [l for l in re.split(r"\n+|(?<=[.!?;])\s+", text or "") if l.strip()]


def required(title: str, description: str) -> str:
    """The clearance the posting needs the candidate to hold already ("" when none)."""
    need = 0
    if re.search(r"\bcleared\b", title or "", re.I):           # "Cleared Azure DevOps Engineer": at least Secret
        need = max(need, _level(title) or rank("SECRET"))
    need = max(need, _level(title or "") if _CLEARANCE_WORD.search(title or "") else 0)
    if _CLEARANCE_WORD.search(title or "") and not _OBTAINABLE.search(title or ""):    # "... with Security Clearance"
        need = max(need, rank("SECRET"))
    # A label on its own line ("Clearance Required:") reads with the line after it ("TS/SCI w Poly").
    description = re.sub(r"(?im)^([^\n]*clearance[^\n]{0,40}:)[ \t]*\n+[ \t]*", r"\1 ", description or "")
    for line in _lines(description):
        level = _level(line)
        if level and _MUST.search(line) and not _OBTAINABLE.search(line) and not _PREFERRED.search(line):
            need = max(need, level)
    return CLEARANCES[need - 1] if need else ""

