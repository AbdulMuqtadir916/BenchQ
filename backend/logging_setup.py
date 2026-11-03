"""One logging setup for the backend (docs/team/uzair.md §1, step 4a).

Every module keeps its own `logger = logging.getLogger("jobnavigator.…")`. Its records travel up to the root logger,
and `configure_logging()` puts the one handler there: what a line looks like (JSON in production, text locally), the
request or run it belongs to, and what is masked. Libraries log the same way (uvicorn, SQLAlchemy, httpx), so their
lines pass through it too. Each program calls it once at startup: the API (`backend/main.py`) and the scripts.

    BENCHQ_ENV   production → JSON lines, anything else → text
    LOG_FORMAT   json | text, overrides the above
    LOG_LEVEL    DEBUG | INFO (default) | WARNING | ERROR

Masking is a safety net, not permission: log ids, route patterns, counts and timings, never a name, an email, a
phone number, résumé or email text, a password, a token or a key (CLAUDE.md). The canary test
(`backend/tests/test_logging_canary.py`) plants such values in real requests and fails if one reaches the log.
"""
import contextvars
import json
import logging
import os
import re
import sys
import traceback
from datetime import datetime, timezone

# Which request or background run the current code is serving. Set by backend/request_log.py and
# backend/job_monitor.py; asyncio copies both into tasks started from there.
request_id: contextvars.ContextVar[str | None] = contextvars.ContextVar("request_id", default=None)
run_id: contextvars.ContextVar[str | None] = contextvars.ContextVar("run_id", default=None)

_HANDLER_MARK = "_benchq_handler"
# Set on an exception the request log already wrote with its request id; uvicorn's second copy is dropped.
LOGGED_MARK = "_benchq_logged"


# ── Masking ──────────────────────────────────────────────────────────────────
_UUID = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")
_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.([A-Za-z]{2,})")
_BEARER = re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]+")
_JWT = re.compile(r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+")
_API_KEY = re.compile(r"\bsk-[A-Za-z0-9_-]{10,}")
_SECRET_FIELD = re.compile(
    r"(?i)\b(password|passwd|pwd|token|secret|api[_-]?key|access_token|refresh_token|client_secret|authorization"
    r"|cookie|bq_session)(\"?'?\s*[:=]\s*\"?'?)[^\s\"'&,;)}\]]+")
# A Postgres error repeats the row's values ("Key (email)=(…) already exists"); a Pydantic one repeats the input.
_PG_DETAIL = re.compile(r"DETAIL:[^\n]*")
_PG_PARAMETERS = re.compile(r"\[parameters: [^\n]*")
_INPUT_VALUE = re.compile(r"input_value=.*?(?=, input_type=|\]\n|$)", re.MULTILINE)
# Tokens, hashes and keys: a long run of word characters with letters and digits in it. UUIDs are ids, kept.
_LONG = re.compile(r"[A-Za-z0-9_-]{32,}")

REDACTED = "[redacted]"


def _long_string(match: re.Match) -> str:
    text = match.group(0)
    if _UUID.fullmatch(text) or not re.search(r"\d", text) or not re.search(r"[A-Za-z]", text):
        return text
    return REDACTED


def redact(text: str) -> str:
    """Mask what looks like a secret or contact detail in a log line."""
    if not text:
        return text
    text = _PG_DETAIL.sub(f"DETAIL: {REDACTED}", text)
    text = _PG_PARAMETERS.sub(f"[parameters: {REDACTED}]", text)
    text = _INPUT_VALUE.sub(f"input_value={REDACTED}", text)
    text = _BEARER.sub(f"Bearer {REDACTED}", text)
    text = _JWT.sub(REDACTED, text)
    text = _API_KEY.sub(REDACTED, text)
    text = _SECRET_FIELD.sub(lambda m: f"{m.group(1)}{m.group(2)}{REDACTED}", text)
    text = _EMAIL.sub(lambda m: f"{m.group(0)[0]}***@***.{m.group(1)}", text)
    return _LONG.sub(_long_string, text)


# ── Exceptions ───────────────────────────────────────────────────────────────
def _safe_message(exc: BaseException) -> str:
    """An exception's message without the values it carries: a database error becomes its type, SQLSTATE and
    statement (no parameters, no DETAIL); a validation error keeps where and why, not the input."""
    from pydantic import ValidationError
    from sqlalchemy.exc import StatementError

    if isinstance(exc, StatementError):
        orig = exc.orig
        code = getattr(orig, "pgcode", None)
        statement = " ".join((exc.statement or "").split())[:300]
        return f"{type(orig).__name__ if orig else 'error'}" + (f" SQLSTATE {code}" if code else "") + \
            (f" on: {statement}" if statement else "")
    if hasattr(exc, "pgcode") and hasattr(exc, "pgerror"):               # a driver error raised directly
        return f"SQLSTATE {exc.pgcode}"
    if isinstance(exc, ValidationError):
        problems = "; ".join(f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}"
                             for e in exc.errors(include_input=False, include_url=False))
        return f"{exc.error_count()} validation error(s) for {exc.title}: {problems}"
    return str(exc)


def format_exception(exc: BaseException) -> str:
    """The traceback, oldest exception first, each ending in its safe message."""
    chain, seen, current = [], set(), exc
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        chain.append(current)
        current = current.__cause__ or (None if current.__suppress_context__ else current.__context__)
    parts = []
    for i, item in enumerate(reversed(chain)):
        if i:
            parts.append("\nDuring handling of the above exception, another exception occurred:\n\n")
        parts.append("Traceback (most recent call last):\n")
        parts.extend(traceback.format_tb(item.__traceback__))
        name = type(item).__qualname__
        module = type(item).__module__
        parts.append(f"{name if module == 'builtins' else f'{module}.{name}'}: {_safe_message(item)}\n")
    return redact("".join(parts).rstrip("\n"))


# ── Filters and formatters ───────────────────────────────────────────────────
class _Context(logging.Filter):
    """Stamps every record with the request or run it belongs to, and drops uvicorn's second copy of an error the
    request log already wrote."""

    def filter(self, record: logging.LogRecord) -> bool:
        if record.name.startswith("uvicorn") and record.exc_info and getattr(record.exc_info[1], LOGGED_MARK, False):
            return False
        record.request_id = request_id.get()
        record.run_id = run_id.get()
        return True


def _message(record: logging.LogRecord) -> str:
    try:
        return redact(record.getMessage())
    except Exception:                                    # a broken format string must not lose the line
        return redact(f"{record.msg!r} {record.args!r}")


def _exception(record: logging.LogRecord) -> str | None:
    if record.exc_info and record.exc_info[1] is not None:
        return format_exception(record.exc_info[1])
    if record.stack_info:
        return redact(record.stack_info)
    return None


# Fields of the access line that its message already says (backend/request_log.py); the text format skips them.
_IN_MESSAGE = {"method", "route", "status", "duration_ms"}


class TextFormatter(logging.Formatter):
    """For a person reading the terminal: time, level, logger, message, then the ids."""

    def format(self, record: logging.LogRecord) -> str:
        when = datetime.fromtimestamp(record.created).strftime("%Y-%m-%d %H:%M:%S") + f".{int(record.msecs):03d}"
        line = f"{when} {record.levelname:<7} {record.name}  {_message(record)}"
        extras = {k: v for k, v in (getattr(record, "fields", None) or {}).items() if k not in _IN_MESSAGE}
        ids = [("req", getattr(record, "request_id", None)), ("run", getattr(record, "run_id", None)),
               *extras.items()]
        line += "".join(f"  {k}={v}" for k, v in ids if v is not None)
        exc = _exception(record)
        return f"{line}\n{exc}" if exc else line


class JsonFormatter(logging.Formatter):
    """One JSON object per line, for the log collector to filter on."""

    def format(self, record: logging.LogRecord) -> str:
        entry = {
            "time": datetime.fromtimestamp(record.created, timezone.utc).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "message": _message(record),
        }
        for key in ("request_id", "run_id"):
            if getattr(record, key, None) is not None:
                entry[key] = getattr(record, key)
        entry.update(getattr(record, "fields", None) or {})
        exc = _exception(record)
        if exc:
            entry["exc_info"] = exc
        return json.dumps(entry, default=str, ensure_ascii=False)


# ── Setup ────────────────────────────────────────────────────────────────────
def configure_logging() -> logging.Handler:
    """Install the one handler on the root logger, replacing a previous call's. Other handlers (pytest's capture)
    are left alone. Returns the handler."""
    from backend.config import IS_PRODUCTION

    fmt = os.getenv("LOG_FORMAT", "").strip().lower() or ("json" if IS_PRODUCTION else "text")
    level = os.getenv("LOG_LEVEL", "INFO").strip().upper()

    handler = logging.StreamHandler(sys.stdout)
    setattr(handler, _HANDLER_MARK, True)
    handler.setFormatter(JsonFormatter() if fmt == "json" else TextFormatter())
    handler.addFilter(_Context())          # on the handler: a filter on the root logger misses child loggers' records

    root = logging.getLogger()
    for old in [h for h in root.handlers if getattr(h, _HANDLER_MARK, False)]:
        root.removeHandler(old)
    root.addHandler(handler)
    root.setLevel(level if level in logging.getLevelNamesMapping() else "INFO")

    # uvicorn installs its own handlers before it imports the app; send its lines through ours instead. Its access
    # log is replaced by backend/request_log.py, which writes the route pattern, never the raw path with its tokens.
    for name in ("uvicorn", "uvicorn.error"):
        logging.getLogger(name).handlers = []
        logging.getLogger(name).propagate = True
    access = logging.getLogger("uvicorn.access")
    access.handlers = []
    access.propagate = False
    access.disabled = True

    # httpx logs every request URL at INFO, and the Telegram API carries the bot token in the path (R4-T5-03).
    # SQLAlchemy logs every statement at INFO and the rows it read at DEBUG: with LOG_LEVEL=DEBUG that is people's
    # data. Its warnings still come through.
    for noisy in ("httpx", "httpcore", "sqlalchemy"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    return handler


def installed_handler() -> logging.Handler | None:
    """The handler configure_logging() installed, if any (the canary test reads what it writes)."""
    return next((h for h in logging.getLogger().handlers if getattr(h, _HANDLER_MARK, False)), None)
