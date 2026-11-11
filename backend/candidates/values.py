"""How a résumé's stored values are read, the same way when a version is written (`first_base`) and when its autofill
is built (`autofill`), so the two can't drift apart."""


def text(value) -> str:
    """A stored value as trimmed text; nothing (None, "", 0, False) is ""."""
    return str(value or "").strip()


def dicts(value) -> list[dict]:
    """The entries of a stored list that are objects; anything else (a bare string, a number) is skipped."""
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []
