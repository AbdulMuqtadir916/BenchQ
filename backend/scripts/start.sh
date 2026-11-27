#!/bin/sh
# Container start for the API: migrate first (one process, under an advisory lock), then serve.
# The scheduler is not in this process: it runs in the worker (start_worker.sh, production layer step 3).
set -e
# The settings first (backend/startup_checks.py): a misconfigured deploy stops before the migration changes anything.
python -m backend.scripts.check_config --role api
python -m backend.scripts.db_upgrade
# No uvicorn access log: it prints raw paths, and invite links carry their token there. backend/request_log.py writes
# one line per request with the route pattern instead. No `server` header: it names the server and its version.
exec uvicorn backend.main:app --host 0.0.0.0 --port 8000 --no-access-log --no-server-header
