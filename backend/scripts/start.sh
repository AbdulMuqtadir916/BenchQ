#!/bin/sh
# Container start: migrate first (one process, under an advisory lock), then serve.
# Run exactly ONE worker: the scheduler lives inside the API process (docs/integration/07-auth-and-tenancy.md, Q37).
set -e
python -m backend.scripts.db_upgrade
# No uvicorn access log: it prints raw paths, and invite links carry their token there. backend/request_log.py writes
# one line per request with the route pattern instead.
exec uvicorn backend.main:app --host 0.0.0.0 --port 8000 --no-access-log
