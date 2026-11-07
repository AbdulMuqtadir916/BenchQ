"""Loads .env secrets only. All other config lives in the settings DB table."""
import os
from dotenv import load_dotenv

load_dotenv()

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
GMAIL_CLIENT_ID = os.getenv("GMAIL_CLIENT_ID", "")
GMAIL_CLIENT_SECRET = os.getenv("GMAIL_CLIENT_SECRET", "")
GMAIL_REFRESH_TOKEN = os.getenv("GMAIL_REFRESH_TOKEN", "")
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://jobnavigator:password@db:5432/jobnavigator")
# "production" unless told otherwise, so a forgotten setting fails safe: Secure cookies, no API docs, no demo
# seed. docker-compose sets BENCHQ_ENV=development for local work.
BENCHQ_ENV = os.getenv("BENCHQ_ENV", "production").strip().lower()
IS_PRODUCTION = BENCHQ_ENV == "production"
# The session cookie is Secure in production; browsers drop Secure cookies over plain http://localhost.
SESSION_COOKIE_SECURE = os.getenv("SESSION_COOKIE_SECURE", "true" if IS_PRODUCTION else "false").lower() == "true"
# The app's own origins: CORS, and the Origin check on unsafe requests (07 Q37).
ALLOWED_ORIGINS = [o.strip() for o in os.getenv(
    "ALLOWED_ORIGINS", "http://localhost,http://localhost:3000,http://localhost:80").split(",") if o.strip()]
PASSWORD_RESET_BASE_URL = (os.getenv("PASSWORD_RESET_BASE_URL") or
                           ("" if IS_PRODUCTION else "http://localhost:3000")).strip().rstrip("/")
# How many proxies in front of the backend append to X-Forwarded-For (the load balancer: 1). The client's address
# is that many entries from the right; anything further left was sent by the client and can be forged.
TRUSTED_PROXY_HOPS = max(0, int(os.getenv("TRUSTED_PROXY_HOPS", "1")))

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
