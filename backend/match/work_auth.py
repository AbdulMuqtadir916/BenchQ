"""What a posting says about who may take it: no visa sponsorship, citizens only, citizens or green-card holders only,
no H-1B transfers, no C2C or third parties. Plain patterns read from the title and description.

A candidate's status may be free text ("US Citizen", "Green Card", "H1B") or a code (BenchQ's USC, GC, GC_EAD, H1B,
H4_EAD, OPT, CPT, TN). A GC EAD holder is not yet a permanent resident, so "citizens or green card only" excludes them.
No imports from the rest of the project, so a copy of it carries no other module along.
"""
import re

# BenchQ (2026-11-14): word boundaries ("casino sponsor" is no "no sponsor"), "don't"/"doesn't" and curly apostrophes,
# and "sponsorship unavailable": the wordings BenchQ's first rules caught (job search part 3).
NO_SPONSORSHIP = re.compile(
    r"\b(not|unable to|cannot|can['’]t|won['’]t|will not|do not|does not|don['’]t|doesn['’]t|no)\s+(provide\s+|offer\s+)?"
    r"(visa\s+)?sponsor|\bwithout\s+(the\s+need\s+for\s+|requiring\s+|needing\s+)?(visa\s+)?sponsorship|"
    r"\b(not|never)\s+(now\s+or\s+in\s+the\s+future\s+)?(require|need)\s+(visa\s+)?sponsorship|"
    r"\bsponsorship\s+(is\s+)?(not\s+(available|offered|provided)|unavailable)|\bno\s+(visa\s+)?sponsorship", re.I)
# BenchQ (2026-11-14): "US" starts a word, so "plus citizens only" isn't "US citizens only".
CITIZENS_ONLY = re.compile(
    r"\b(u\.?s\.?|united states)\s+citizens?(hip)?\s+(only|required|is required)|"
    r"\bmust\s+be\s+(an?\s+)?(u\.?s\.?|united states)\s+citizen|"
    r"\b(u\.?s\.?|united states)\s+citizenship\s+(is\s+)?(required|mandatory)|\brequires?\s+(u\.?s\.?|united states)\s+citizenship|"
    r"citizenship\s+required\s*:\s*yes|"
    r"\b(u\.?s\.?|united states)\s+citizenship\b[^.\n]{0,100}\b(is|are)\s+required|"
    r"(active|current)\s+(secret|top secret|ts/sci|security)\s+clearance|security\s+clearance\s+(is\s+)?required", re.I)
GREEN_CARD_ONLY = re.compile(
    r"(green\s*card|gc)\s+(holders?\s+)?(only|required)|(usc|us\s+citizens?)\s*(/|or|and)\s*(gc|green\s*card)\s+only", re.I)
NO_C2C = re.compile(r"(?:no|not\s+open\s+to|not\s+accepting|cannot\s+accept|will\s+not\s+accept)\s+(c2c|corp[\s-]*to[\s-]*corp|third[\s-]*part(y|ies)|1099)|\bw-?2\s+(?:contract\s+|position\s+|role\s+|employment\s+|candidates?\s+)?only\b|\bonly\s+(?:on\s+)?w-?2\b", re.I)
# "H-1B transfer candidates are encouraged", "H1B transfers welcome": no new petition, but a transfer is taken.
TRANSFER_WELCOME = re.compile(r"h-?1b\s+transfers?\s+(?:candidates\s+)?(?:are\s+|is\s+)?(?:welcome|encouraged|accepted|considered|ok|okay|fine)"
                              r"|(?:accept|consider|welcome)s?\s+h-?1b\s+transfers?", re.I)
# BenchQ (2026-11-14): word boundaries, "can't", and "unable to consider transfers".
NO_TRANSFER = re.compile(r"\b(no|not|cannot|can['’]t|unable to)\s+(accept\s+|consider\s+)?(h-?1b\s+)?transfers?", re.I)


def is_citizen(work_auth: str) -> bool:
    return bool(re.search(r"citizen|\busc\b", work_auth or "", re.I))


def is_green_card(work_auth: str) -> bool:
    """A permanent resident: "Green Card", "GC", "permanent resident", "LPR"; not "GC_EAD" or "GC EAD"."""
    text = work_auth or ""
    if re.search(r"\bgc[\s_-]*ead\b", text, re.I):
        return False
    return bool(re.search(r"green|\bgc\b|permanent resident|\blpr\b", text, re.I))


# The work statuses a posting may list, compound names first ("GC EAD" before "GC", "H4 EAD" before "EAD").
_STATUS_FORMS = (
    ("GC_EAD", r"gc[\s-]*ead|ead[\s-]*gc"), ("H4_EAD", r"h-?4(?:\s*ead)?"), ("L2_EAD", r"l-?2(?:\s*ead)?"),
    ("J2_EAD", r"j-?2(?:\s*ead)?"), ("OPT", r"(?:stem\s*)?opt(?:\s*ead)?"), ("CPT", r"cpt(?:\s*ead)?"),
    ("H1B", r"h-?1-?b(?:\s*visa)?(?:\s*transfers?)?"), ("TN", r"tn\s*visa|tn(?=\s*(?:,|\.|\)|$|and|or|only))"), ("E3", r"e-?3\s*visa"),
    ("USC", r"usc|u\.?s\.?\s*citizens?(?:hip)?|united\s+states\s+citizens?(?:hip)?|citizens?"),
    ("GC", r"gc|green\s*cards?(?:\s*holders?)?|permanent\s+residents?|lpr"), ("EAD", r"ead"))
_STATUS = re.compile("|".join(f"(?P<{code}>\\b(?:{form})\\b)" for code, form in _STATUS_FORMS), re.I)
_STATUS_LIST = rf"(?:{'|'.join(form for _, form in _STATUS_FORMS)})(?:\s*(?:,|&|/|\||and|or)\s*(?:{'|'.join(form for _, form in _STATUS_FORMS)}))*"
_EXCLUDED = re.compile(rf"\b(?:no|not|except|excluding)\s+(?:for\s+)?({_STATUS_LIST})\b", re.I)
_CLAUSES = re.compile(r"\n+|(?<=[.!?])\s+(?=[A-Z])")
_ONLY = re.compile(r"\bonly\b|\bvisa\s*(?:status)?\s*:|\bwork\s+authori[sz]ation\s*:", re.I)
_SOFT = re.compile(r"prefer|a plus|nice to have|desired|bonus|regardless|without regard|equal opportunity", re.I)


def _statuses(text: str) -> set:
    return {m.lastgroup for m in _STATUS.finditer(text or "")}


def status_lists(text: str) -> tuple:
    """(accepted, excluded): the statuses a posting says it takes only ("Only US citizens and Greencard holders"), and
    the ones it rules out ("No OPT & CPT"). accepted is None when the posting gives no such list."""
    accepted, excluded = None, set()
    for clause in _CLAUSES.split(text or ""):
        if _SOFT.search(clause):
            continue
        for m in _EXCLUDED.finditer(clause):
            if not re.search(r"transfer", m.group(0), re.I):      # "No H1B transfers" is NO_TRANSFER's rule
                excluded |= _statuses(m.group(1))
        rest = _EXCLUDED.sub(" ", clause)
        only = _ONLY.search(rest)
        if not only:
            continue
        near = rest[max(0, only.start() - 90): only.end() + 120]
        found = _statuses(near)
        if found == {"TN"} and not re.search(r"\btn\s*(?:visa|status)", near, re.I):   # "Nashville, TN only": a state
            found = set()
        if found:
            accepted = (accepted or set()) | found
    # Staffing shorthand: statuses joined by "/" or "|" name the only ones taken ("USC/GC", "C2C USC/GC").
    for m in _SLASH_LIST.finditer(text or ""):
        found = _statuses(m.group(0))
        if len(found) >= 2 and found <= {"USC", "GC", "GC_EAD"}:     # "H1B/OPT welcome" is not a closed list
            accepted = (accepted or set()) | found
    return accepted, excluded


_SLASH_TOKEN = r"(?:usc|(?:u\.?s\.?\s*)?citizens?|gc(?:[\s-]*ead)?|green\s*card|h-?1-?b|h-?4(?:\s*ead)?|l-?2(?:\s*ead)?|opt(?:\s*ead)?|cpt|tn|ead)"
_SLASH_LIST = re.compile(rf"\b{_SLASH_TOKEN}(?:\s*[/|]\s*{_SLASH_TOKEN})+\b", re.I)


def status_code(work_auth: str) -> str:
    text = (work_auth or "").upper().replace("-", "_").replace(" ", "_")
    if is_citizen(work_auth):
        return "USC"
    if re.search(r"GC_?EAD", text):
        return "GC_EAD"
    if is_green_card(work_auth):
        return "GC"
    for code in ("H4_EAD", "L2_EAD", "J2_EAD", "OPT", "CPT", "TN", "E3"):
        if code in text:
            return code
    return "H1B" if re.search(r"H_?1_?B", text) else text


def accepts(accepted: set, work_auth: str) -> bool:
    code = status_code(work_auth)
    # BenchQ (2026-11-14): a US citizen takes a job open to green-card holders ("Green card holders only").
    return code in accepted or (code in {"GC_EAD", "H4_EAD", "L2_EAD", "J2_EAD", "OPT"} and "EAD" in accepted) or \
        (code == "USC" and "GC" in accepted) or (code == "GC" and "USC" in accepted and False)


def corp_to_corp_only(employment_labels) -> bool:
    """Whether every employment type the candidate takes is C2C or 1099 (so "no C2C" rules the job out)."""
    labels = [re.sub(r"[^a-z0-9]", "", str(label).lower()) for label in employment_labels or ()]
    return bool(labels) and all(label in ("c2c", "1099", "teen99", "corptocorp") for label in labels)
