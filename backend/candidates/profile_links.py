"""HTTP(S) links accepted in candidate profiles and résumé headers."""
import re
from typing import Annotated

from pydantic import AfterValidator, HttpUrl, TypeAdapter

_BARE_PROFILE = re.compile(r"^(?:www\.)?(?:linkedin\.com|github\.com)/[^\s]", re.IGNORECASE)
_HTTP_URL = TypeAdapter(HttpUrl)


def normalize_profile_link(value: str | None) -> str | None:
    text = (value or "").strip()
    if not text:
        return None
    if _BARE_PROFILE.match(text):
        text = f"https://{text}"
    if len(text) > 500 or not re.match(r"^https?://[^/\\]", text, re.IGNORECASE) or re.search(r"[\s\\]", text):
        raise ValueError("Enter an HTTP or HTTPS link.")
    try:
        _HTTP_URL.validate_python(text)
    except ValueError:
        raise ValueError("Enter an HTTP or HTTPS link.") from None
    return text


ProfileLink = Annotated[str | None, AfterValidator(normalize_profile_link)]
