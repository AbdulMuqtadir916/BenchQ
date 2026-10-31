"""Loads .env secrets only. All other config lives in the settings DB table."""
import os
from dotenv import load_dotenv

load_dotenv()

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
GMAIL_CLIENT_ID = os.getenv("GMAIL_CLIENT_ID", "")
GMAIL_CLIENT_SECRET = os.getenv("GMAIL_CLIENT_SECRET", "")
GMAIL_REFRESH_TOKEN = os.getenv("GMAIL_REFRESH_TOKEN", "")
CANDIDATE_GMAIL_CLIENT_ID = os.getenv("CANDIDATE_GMAIL_CLIENT_ID", "")
CANDIDATE_GMAIL_CLIENT_SECRET = os.getenv("CANDIDATE_GMAIL_CLIENT_SECRET", "")
CANDIDATE_GMAIL_REDIRECT_URI = os.getenv("CANDIDATE_GMAIL_REDIRECT_URI", "")
CANDIDATE_GMAIL_ENCRYPTION_KEY = os.getenv("CANDIDATE_GMAIL_ENCRYPTION_KEY", "")
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
CANDIDATE_EMAIL_CLASSIFICATION_ENABLED = os.getenv("CANDIDATE_EMAIL_CLASSIFICATION_ENABLED", "true").strip().lower() == "true"
CANDIDATE_EMAIL_AUTO_STATUS_ENABLED = os.getenv("CANDIDATE_EMAIL_AUTO_STATUS_ENABLED", "true").strip().lower() == "true"
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
# How many proxies in front of the backend append to X-Forwarded-For (the load balancer: 1). The client's address
# is that many entries from the right; anything further left was sent by the client and can be forged.
TRUSTED_PROXY_HOPS = max(0, int(os.getenv("TRUSTED_PROXY_HOPS", "1")))
