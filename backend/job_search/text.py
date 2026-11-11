"""Text helpers shared by the providers: HTML to plain text, safe links, and the JSON a row may store."""
import html
import math
import re

from backend.models.db import sanitize_text

_BLOCK_END = re.compile(r"(?i)</(p|div|li|h[1-6]|tr|ul|ol)>")
_BR = re.compile(r"(?i)<br\s*/?>")


def html_to_text(value) -> str:
    """A description's HTML as plain text: newlines at block ends only, so inline markup doesn't split words. The same
    rule as the old freehire.me scraper (backend/scraper/sources/freehire.py `_strip_html`)."""
    if not isinstance(value, str) or not value:
        return ""
    s = _BR.sub("\n", value)
    s = _BLOCK_END.sub("\n", s)
    try:
        from bs4 import BeautifulSoup
        text = BeautifulSoup(s, "html.parser").get_text()
    except Exception:
        text = html.unescape(re.sub(r"<[^>]+>", " ", s))
    text = re.sub(r"[ \t\r\f\v]+\n", "\n", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def safe_url(value) -> str | None:
    """An http(s) link, or None: never javascript:, data: or a relative path."""
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value if re.match(r"(?i)^https?://[^\s/]+", value) and len(value) <= 2048 else None


_CONTROL = re.compile(r"[\x00-\x1f\x7f-\x9f]")
_CONTROL_BUT_LINES = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]")


def typed_text(value: str, multiline: bool = False) -> str:
    """Text a person typed into a request (a search's role): refused when it holds a control character, NUL included,
    so the request is a 422 before anything is written (Postgres refuses \\u0000; Abdul's review, P2). Accents and
    other scripts pass. `multiline` lets tab and line breaks through."""
    if (_CONTROL_BUT_LINES if multiline else _CONTROL).search(value):
        raise ValueError("no control characters")
    return value


def clean_str(value) -> str | None:
    if not isinstance(value, str):
        return None
    value = sanitize_text(value).strip()
    return value or None


def clean_json(value, depth: int = 0):
    """`value` with every string's control characters removed (Postgres refuses \\u0000 in JSONB, and a C0 byte can
    abort the insert), keys as strings. Nesting deeper than 20 is dropped."""
    if depth > 20:
        return None
    if isinstance(value, str):
        return sanitize_text(value)
    if isinstance(value, dict):
        return {sanitize_text(str(k)): clean_json(v, depth + 1) for k, v in value.items()}
    if isinstance(value, list):
        return [clean_json(v, depth + 1) for v in value]
    if isinstance(value, float):
        return value if math.isfinite(value) else None     # JSONB has no NaN or Infinity
    if isinstance(value, (int, bool)) or value is None:
        return value
    return sanitize_text(str(value))
