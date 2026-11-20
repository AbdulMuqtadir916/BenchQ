#!/bin/sh
# Container start for the worker (backend/worker.py): the scheduler's own process. Run exactly ONE: every copy would
# run every scheduled job (production layer step 3, docs/team/uzair.md).
# The migration runs under an advisory lock and is a no-op at the newest revision, so the worker and the API may both
# start it: whichever comes second waits, then finds nothing to do, and the worker never starts on an old schema.
set -e
python -m backend.scripts.db_upgrade
exec python -m backend.worker
