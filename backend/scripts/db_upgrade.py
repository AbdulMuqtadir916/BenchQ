"""Bring the database to the newest Alembic revision. Run before the API starts:

    python -m backend.scripts.db_upgrade

The Dockerfile CMD does this. A fresh database is built by the migrations; an existing one that has no
`alembic_version` yet is repaired and stamped at the baseline (backend/db_schema.py).
"""
import logging

from backend.db_schema import upgrade_database


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    upgrade_database()
    logging.getLogger(__name__).info("Database schema is up to date.")


if __name__ == "__main__":
    main()
