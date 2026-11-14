"""What a job says about who may take it, against the candidate's work authorization (decided 2026-11-14, Q5, Q6).

A search leaves a job out only when its title or description **states** something that rules the candidate out; a
job that says nothing is kept (most say nothing, and missing information never drops a job):

- "no sponsorship"                                       → out for a candidate who needs sponsorship;
- "US citizens only", or a security clearance required   → out for anyone who isn't a US citizen (`USC`);
- "citizens or green card holders only"                  → out for anyone who isn't `USC` or `GC` (a GC EAD holder
                                                            isn't a permanent resident yet);
- "no H-1B transfers"                                    → out for a candidate who needs a transfer.

The candidate's status is the profile's code (`candidates.work_auth`: USC, GC, GC_EAD, H1B, H4_EAD, OPT, CPT, TN) and
its two flags. "No C2C" isn't work authorization, so it isn't here. Written for BenchQ from JobNavigator's patterns
(inspiration only), with word boundaries so "plus citizens only" isn't "US citizens only".
"""
import re

NO_SPONSORSHIP = re.compile(
    r"\b(?:not|unable\s+to|cannot|can't|won't|will\s+not|do\s+not|does\s+not|don't|doesn't|no)\s+"
    r"(?:provide\s+|offer\s+|be\s+able\s+to\s+)?(?:visa\s+|h-?1b\s+)?sponsor"
    r"|\bwithout\s+(?:the\s+need\s+for\s+|requiring\s+|needing\s+)?(?:visa\s+|employer\s+)?sponsorship"
    r"|\b(?:not|never)\s+(?:now\s+or\s+in\s+the\s+future\s+)?(?:require|need)\s+(?:visa\s+|employer\s+)?sponsorship"
    r"|\bsponsorship\s+(?:is\s+)?(?:not\s+(?:available|offered|provided)|unavailable)"
    r"|\bno\s+(?:visa\s+|h-?1b\s+)?sponsorships?\b", re.I)
CITIZENS_ONLY = re.compile(
    r"\b(?:u\.\s?s\.|us|united\s+states)\s+citizens?(?:hip)?\s+(?:only|(?:is\s+)?required)\b"
    r"|\bmust\s+be\s+an?\s+(?:u\.\s?s\.|us|united\s+states)\s+citizen\b"
    r"|\busc\s+(?:only|required)\b"
    r"|\b(?:active|current)\s+(?:secret|top\s+secret|ts/sci|security)\s+clearance"
    r"|\bsecurity\s+clearance\s+(?:is\s+)?required\b", re.I)
GREEN_CARD_ONLY = re.compile(
    r"\b(?:green\s*card|gc)\s+(?:holders?\s+)?(?:only|required)\b"
    r"|\b(?:usc|us\s+citizens?)\s*(?:/|or|and|&)\s*(?:gc|green\s*card)(?:\s+holders?)?\s+only\b", re.I)
NO_TRANSFER = re.compile(
    r"\b(?:no|not|cannot|can't|unable\s+to)\s+(?:accept\s+|consider\s+|do\s+)?(?:h-?1b\s+)?transfers?\b", re.I)

# The reason a job was left out, as the search's counts and the panel name it.
NO_SPONSORSHIP_REASON, CITIZENS_ONLY_REASON = "no_sponsorship", "citizens_only"
GREEN_CARD_ONLY_REASON, NO_TRANSFER_REASON = "citizens_or_green_card_only", "no_transfer"


def ruled_out(text: str, work_auth: str | None, needs_sponsorship: bool, needs_transfer: bool) -> str | None:
    """Why the job's text rules this candidate out, or None when it doesn't (including when it says nothing)."""
    text = text or ""
    status = (work_auth or "").upper()
    if needs_sponsorship and NO_SPONSORSHIP.search(text):
        return NO_SPONSORSHIP_REASON
    if status != "USC" and CITIZENS_ONLY.search(text):
        return CITIZENS_ONLY_REASON
    if status not in ("USC", "GC") and GREEN_CARD_ONLY.search(text):
        return GREEN_CARD_ONLY_REASON
    if needs_transfer and NO_TRANSFER.search(text):
        return NO_TRANSFER_REASON
    return None
