#!/bin/sh
# Container start: migrate first (one process, under an advisory lock), then serve.
# Run exactly ONE worker: the scheduler lives inside the API process (docs/integration/07-auth-and-tenancy.md, Q37).
set -e
python -m backend.scripts.db_upgrade
exec uvicorn backend.main:app --host 0.0.0.0 --port 8000
