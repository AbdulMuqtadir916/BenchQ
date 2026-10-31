"""Redact direct contact details and credentials before sending email text to the model provider."""
import re

PATTERNS = (
    (re.compile(r"https?://[^\s<>\"']+", re.I), "[link removed]"),
    (re.compile(r"(?im)^\s*(?:password|passwd|passcode|temporary password|access token|api key|client secret|secret key)\s*[:=].+$"), "[credential removed]"),
    (re.compile(r"(?im)^\s*(?:email|e-mail|phone(?: number)?|mobile|home address|mailing address|address)\s*[:=].+$"), "[contact removed]"),
    (re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.I), "[email removed]"),
    (re.compile(r"(?<!\w)(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}(?!\w)"), "[phone removed]"),
)


def redact_sensitive_text(value: str) -> str:
    for pattern, replacement in PATTERNS:
        value = pattern.sub(replacement, value)
    return value[:100_000]
