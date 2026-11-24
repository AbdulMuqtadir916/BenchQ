"""Loads .env secrets only. All other config lives in the settings DB table."""
import os
from dotenv import load_dotenv

load_dotenv()

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
GMAIL_CLIENT_ID = os.getenv("GMAIL_CLIENT_ID", "")
GMAIL_CLIENT_SECRET = os.getenv("GMAIL_CLIENT_SECRET", "")
GMAIL_REFRESH_TOKEN = os.getenv("GMAIL_REFRESH_TOKEN", "")
# Server secrets come only from the environment (docs/team/uzair.md, step 6): no fallback here. docker-compose.yml sets
# it; unset, the start-up check (backend/startup_checks.py) refuses to start with the variable's name.
DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
# "production" unless told otherwise, so a forgotten setting fails safe: Secure cookies, no API docs, no demo
# seed. docker-compose sets BENCHQ_ENV=development for local work.
# An empty value counts as unset (an `.env` line `BENCHQ_ENV=` must not mean development); any value but these two is
# refused at start (backend/startup_checks.py).
BENCHQ_ENV = (os.getenv("BENCHQ_ENV") or "production").strip().lower() or "production"
IS_PRODUCTION = BENCHQ_ENV == "production"
# The session cookie is Secure in production; browsers drop Secure cookies over plain http://localhost.
# An empty value counts as unset, so `SESSION_COOKIE_SECURE=` can't switch it off in production.
SESSION_COOKIE_SECURE = (os.getenv("SESSION_COOKIE_SECURE")
                         or ("true" if IS_PRODUCTION else "false")).strip().lower() == "true"


def parse_origins(raw: str) -> list[str]:
    """The comma-separated origin list, trimmed and lower-cased (a browser sends an origin lower-case). The one parse
    for the list CORS and the Origin check use (backend/main.py, backend/auth/access.py) and for the start-up check
    that validates it (backend/startup_checks.py)."""
    return [o.strip().lower() for o in raw.split(",") if o.strip()]


def _int_env(name: str, default: int) -> int:
    """An integer setting, read without crashing on import; an invalid value is refused at start by the check."""
    try:
        return int(os.getenv(name, str(default)).strip())
    except ValueError:
        return default


# The app's own origins: CORS, and the Origin check on unsafe requests (07 Q37). Local development has a default;
# production has none, and the start-up check refuses an unset or malformed list.
DEV_ALLOWED_ORIGINS = "http://localhost,http://localhost:3000,http://localhost:80"
ALLOWED_ORIGINS = parse_origins(os.getenv("ALLOWED_ORIGINS") or ("" if IS_PRODUCTION else DEV_ALLOWED_ORIGINS))
PASSWORD_RESET_BASE_URL = (os.getenv("PASSWORD_RESET_BASE_URL") or
                           ("" if IS_PRODUCTION else "http://localhost:3000")).strip().rstrip("/")
# How many proxies in front of the backend append to X-Forwarded-For (the load balancer: 1). The client's address
# is that many entries from the right; anything further left was sent by the client and can be forged.
TRUSTED_PROXY_HOPS = max(0, _int_env("TRUSTED_PROXY_HOPS", 1))

# Candidate-scoped Gmail: separate from the legacy single-account monitor.
CANDIDATE_GMAIL_CLIENT_ID = os.getenv("CANDIDATE_GMAIL_CLIENT_ID", "")
CANDIDATE_GMAIL_CLIENT_SECRET = os.getenv("CANDIDATE_GMAIL_CLIENT_SECRET", "")
CANDIDATE_GMAIL_REDIRECT_URI = os.getenv("CANDIDATE_GMAIL_REDIRECT_URI", "")
CANDIDATE_GMAIL_ENCRYPTION_KEY = os.getenv("CANDIDATE_GMAIL_ENCRYPTION_KEY", "")

CANDIDATE_GMAIL_ENABLED = os.getenv("CANDIDATE_GMAIL_ENABLED", "false").lower() == "true"

# PR 3: real-mail external processing requires both switches and written operational approval.
CANDIDATE_EMAIL_CLASSIFICATION_ENABLED = os.getenv("CANDIDATE_EMAIL_CLASSIFICATION_ENABLED", "false").lower() == "true"
CANDIDATE_EMAIL_REAL_MAIL_APPROVED = os.getenv("CANDIDATE_EMAIL_REAL_MAIL_APPROVED", "false").lower() == "true"
CANDIDATE_EMAIL_PURGE_ENABLED = os.getenv("CANDIDATE_EMAIL_PURGE_ENABLED", "false").lower() == "true"
# PR 4 automatic status updates (OFF by default). All three must be set, and only mail received at or after the
# start time (ISO 8601 with a time zone) is ever executed automatically. Switch on only after PR 4 is merged and
# Undo is verified (OPERATIONS.md, activation checklist).
CANDIDATE_EMAIL_AUTO_STATUS_ENABLED = os.getenv("CANDIDATE_EMAIL_AUTO_STATUS_ENABLED", "false").lower() == "true"
CANDIDATE_EMAIL_AUTOMATION_APPROVED = os.getenv("CANDIDATE_EMAIL_AUTOMATION_APPROVED", "false").lower() == "true"
CANDIDATE_EMAIL_AUTOMATION_START_AT = os.getenv("CANDIDATE_EMAIL_AUTOMATION_START_AT", "")
# How many emails one sweep classifies at once, and how many it takes per sweep. Different emails never share a row
# lock, and an application's status is written under its own row lock, so raising the first only speeds the AI calls.
# CANDIDATE_EMAIL_CLASSIFY_CONCURRENCY=1 restores one-at-a-time.
CANDIDATE_EMAIL_CLASSIFY_CONCURRENCY = max(1, min(8, int(os.getenv("CANDIDATE_EMAIL_CLASSIFY_CONCURRENCY", "4") or 4)))
CANDIDATE_EMAIL_SWEEP_LIMIT = max(1, min(100, int(os.getenv("CANDIDATE_EMAIL_SWEEP_LIMIT", "60") or 60)))
# PR 4 backfills (OFF by default; switch on only after the eligible counts were reviewed, OPERATIONS.md):
# setup recovery requeues emails that failed only because the classifier was not set up; historical classification
# queues retained NOT_QUEUED mail, oldest first, review only.
CANDIDATE_EMAIL_SETUP_RECOVERY_ENABLED = os.getenv("CANDIDATE_EMAIL_SETUP_RECOVERY_ENABLED", "false").lower() == "true"
CANDIDATE_EMAIL_HISTORICAL_ENABLED = os.getenv("CANDIDATE_EMAIL_HISTORICAL_ENABLED", "false").lower() == "true"
CANDIDATE_EMAIL_PURGE_EVALUATED = os.getenv("CANDIDATE_EMAIL_PURGE_EVALUATED", "false").lower() == "true"
# Bind purge evaluation to the exact recorded model/prompt/taxonomy/policy fingerprint.
CANDIDATE_EMAIL_PURGE_EVALUATION_CONFIG_ID = os.getenv("CANDIDATE_EMAIL_PURGE_EVALUATION_CONFIG_ID", "")
