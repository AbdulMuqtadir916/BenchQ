"""What production refuses to start with (docs/team/uzair.md, step 6): server secrets come only from the environment,
and BenchQ's own stored credentials (the AI key, candidate Gmail tokens) are encrypted with a key from the environment.
The JobNavigator leftover settings secrets (`linkedin_password`, `jobright_password` and the like, plain
`Setting.value`) are not; they are on Abdul's clean-up list.

`check_production_config(env, role)` is pure: it reads the mapping it is given (`os.environ`), opens no database and
reloads no module, and returns the problems, one line each, naming the variable, never its value. `require_config`
raises them as one RuntimeError. It runs before anything else in every start: `python -m backend.scripts.check_config`
in the start scripts (before the migration), `backend/scripts/db_upgrade.py`, the API's lifespan (role `api`) and the
worker's start (role `worker`).

Two kinds of problem:
- **invalid** in any environment: `BENCHQ_ENV` not `production` or `development`, `DATABASE_URL` unset,
  `TRUSTED_PROXY_HOPS` not a whole number, the candidate Gmail key not a Fernet key while Gmail is on;
- **insecure** in production only (`BENCHQ_ENV` unset or `production`): the rest below.

Demo accounts are not refused here (an OWNER could invite a `*.benchq.test` address and stop every firm at the next
restart): in production no invite goes to a testing domain and no account on one signs in (backend/auth/invites.py).
"""
import re
from collections.abc import Mapping
from urllib.parse import parse_qs, unquote, urlsplit

ROLES = ("api", "worker")

# An origin the app may be called from: the site over https, or the extension by its 32-letter id (Chrome's ids use the
# letters a to p). Compared lower-case; nothing else: no `*`, `null`, http, path or trailing slash. A port only if it
# isn't 443: a browser leaves the default port out of the Origin it sends, so `:443` would never match. No leading
# zero and no port 0 either: a browser sends `:81`, never `:00081`.
_LABEL = r"[a-z0-9](?:[a-z0-9-]*[a-z0-9])?"
_HTTPS_ORIGIN = re.compile(rf"https://{_LABEL}(?:\.{_LABEL})*(?::([1-9]\d{{0,4}}))?")
_EXTENSION_ORIGIN = re.compile(r"chrome-extension://[a-p]{32}")
# The password docker-compose and the old fallback use for local Postgres.
_DEFAULT_DB_PASSWORD = "password"


def _get(env: Mapping, name: str) -> str:
    return (env.get(name) or "").strip()


def is_production(env: Mapping) -> bool:
    return (_get(env, "BENCHQ_ENV") or "production").lower() == "production"


def _is_true(env: Mapping, name: str) -> bool:
    return _get(env, name).lower() == "true"


def _origin_of(url: str) -> str | None:
    """`scheme://host[:port]` of `url`, or None when it has none or doesn't parse (`https://[` raises in urlsplit)."""
    try:
        parts = urlsplit(url)
    except ValueError:
        return None
    if not parts.scheme or not parts.netloc:
        return None
    return f"{parts.scheme}://{parts.netloc}".lower()


def _database_password(url: str) -> str | None:
    """The password the driver would use, decoded as SQLAlchemy and libpq decode it (`%70assword` is `password`):
    the URL's, or else a `?password=` query parameter. None when there is none. Raises ValueError for a URL that
    doesn't parse."""
    parts = urlsplit(url)
    if parts.password is not None:
        return unquote(parts.password)
    query = parse_qs(parts.query).get("password")
    return query[-1] if query else None


def valid_origin(origin: str) -> bool:
    """One entry of ALLOWED_ORIGINS, as production takes it."""
    match = _HTTPS_ORIGIN.fullmatch(origin)
    if match:
        return match.group(1) is None or (1 <= int(match.group(1)) <= 65535 and int(match.group(1)) != 443)
    return _EXTENSION_ORIGIN.fullmatch(origin) is not None


def _fernet_problem(name: str, value: str, skip_empty: bool) -> str | None:
    """Why `value` isn't a comma-separated list of Fernet keys (newest first), or None. `skip_empty` mirrors the
    reader: backend/ai/secrets.py skips empty entries, backend/inbox/google_oauth.py doesn't."""
    from cryptography.fernet import Fernet

    keys = [k.strip() for k in value.split(",")]
    if skip_empty:
        keys = [k for k in keys if k]
    if not value or not keys:
        return f"{name} is not set"
    try:
        for key in keys:
            Fernet(key.encode("ascii"))
    except (ValueError, UnicodeEncodeError):
        return f"{name} is not a valid Fernet key (or comma-separated list of them)"
    return None


def check_production_config(env: Mapping, role: str) -> list[str]:
    """The settings this process must not start with, one line each, naming the variable and never its value."""
    if role not in ROLES:
        raise ValueError(f"role must be one of {ROLES}")
    from backend.config import parse_origins

    problems: list[str] = []
    benchq_env = _get(env, "BENCHQ_ENV").lower()
    if benchq_env not in ("", "production", "development"):
        problems.append("BENCHQ_ENV must be production or development (unset means production)")
    production = is_production(env)

    # ── Every process, every environment ──
    database_url = _get(env, "DATABASE_URL")
    if not database_url:
        problems.append("DATABASE_URL is not set")
    hops_raw = _get(env, "TRUSTED_PROXY_HOPS")
    hops: int | None = 1
    if hops_raw:
        try:
            hops = int(hops_raw)
        except ValueError:
            hops = None
            problems.append("TRUSTED_PROXY_HOPS is not a whole number")
    gmail_enabled = _is_true(env, "CANDIDATE_GMAIL_ENABLED")
    if gmail_enabled:
        problem = _fernet_problem("CANDIDATE_GMAIL_ENCRYPTION_KEY", _get(env, "CANDIDATE_GMAIL_ENCRYPTION_KEY"),
                                  skip_empty=False)
        if problem:
            problems.append(problem)
    if not production:
        return problems

    # ── Production, every process ──
    if database_url:
        # Production uses password authentication only (Abdul, 2026-11-23: EC2 now, RDS planned), so no password, an
        # empty one or the local default is never right. No test or CI run uses SQLite (conftest forces Postgres), so
        # nothing is exempt. The URL and the password are never in the message.
        try:
            password = _database_password(database_url)
        except ValueError:
            problems.append("DATABASE_URL is not a valid URL")
        else:
            if not password:
                problems.append("DATABASE_URL has no database password")
            elif password == _DEFAULT_DB_PASSWORD:
                problems.append("DATABASE_URL uses the local default database password")
    problem = _fernet_problem("AI_SETTINGS_ENCRYPTION_KEY", _get(env, "AI_SETTINGS_ENCRYPTION_KEY"), skip_empty=True)
    if problem:
        problems.append(problem)
    redirect = _get(env, "CANDIDATE_GMAIL_REDIRECT_URI")
    if gmail_enabled:
        for name in ("CANDIDATE_GMAIL_CLIENT_ID", "CANDIDATE_GMAIL_CLIENT_SECRET"):
            if not _get(env, name):
                problems.append(f"{name} is not set while CANDIDATE_GMAIL_ENABLED is true")
        if not redirect.lower().startswith("https://"):
            problems.append("CANDIDATE_GMAIL_REDIRECT_URI must be an https:// URL while CANDIDATE_GMAIL_ENABLED is "
                            "true")
    if role != "api":
        return problems

    # ── Production, the API ──
    origins = parse_origins(_get(env, "ALLOWED_ORIGINS"))
    if not origins:
        problems.append("ALLOWED_ORIGINS is not set")
    elif not all(valid_origin(o) for o in origins):
        problems.append("ALLOWED_ORIGINS has an entry that isn't exactly https://host[:port] or "
                        "chrome-extension://<32-letter id> (no *, null, http, path or trailing slash)")
    secure = _get(env, "SESSION_COOKIE_SECURE")
    if secure and secure.lower() != "true":
        problems.append("SESSION_COOKIE_SECURE must be true (or unset)")
    if hops == 0:
        problems.append("TRUSTED_PROXY_HOPS is 0: behind the proxy every client would share one rate-limit count")
    elif hops is not None and hops < 0:
        problems.append("TRUSTED_PROXY_HOPS is negative")
    reset_url = _get(env, "PASSWORD_RESET_BASE_URL").rstrip("/")
    if not reset_url.lower().startswith("https://"):
        problems.append("PASSWORD_RESET_BASE_URL must be the frontend's public https:// address")
    else:
        _origin_problem(problems, "PASSWORD_RESET_BASE_URL", reset_url, origins)
    if gmail_enabled and redirect.lower().startswith("https://"):
        _origin_problem(problems, "CANDIDATE_GMAIL_REDIRECT_URI", redirect, origins)
    return problems


def _origin_problem(problems: list[str], name: str, url: str, origins: list[str]) -> None:
    """An https:// setting whose origin must be one of ALLOWED_ORIGINS; a URL that doesn't parse is named, never
    shown."""
    origin = _origin_of(url)
    if origin is None:
        problems.append(f"{name} is not a valid URL")
    elif origin not in origins:
        problems.append(f"{name}'s origin is not in ALLOWED_ORIGINS")


def require_config(role: str, env: Mapping | None = None) -> None:
    """Raise one RuntimeError listing every problem `check_production_config` finds; nothing when there are none.
    Reads `os.environ` after `backend.config` loaded backend/.env into it."""
    import os

    import backend.config  # noqa: F401  (loads backend/.env into the environment, as every reader sees it)

    problems = check_production_config(os.environ if env is None else env, role)
    if problems:
        raise RuntimeError(f"Refusing to start the {role}: fix these settings (backend/.env.example, "
                           f"\"Production: required\"):\n- " + "\n- ".join(problems))

