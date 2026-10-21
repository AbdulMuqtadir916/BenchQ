"""FROZEN. The schema bootstrap that ran at every startup before Alembic (docs/integration/07, F1).

It is kept for exactly two uses:
  1. `db_schema.upgrade_database()` runs it once on a database that has tables but no `alembic_version`
     (an existing dev database), to bring it to the baseline end state before stamping it.
  2. `tests/test_schema_matches_legacy.py` builds a database this way and checks that the Alembic baseline
     produces the same schema.

Do not add to it. Every schema change from now on is an Alembic revision (docs/integration/README.md,
"Schema changes"). Delete this module, and the code it calls, once every dev database is stamped.

The DDL itself still lives where it always did (`models.db.create_tables`, `seed.run_migrations`,
`seed.migrate_h1b_to_visa_cache`) so their tests keep running; nothing else may call them.
"""
from backend.models.db import SessionLocal, create_tables
from backend.seed import migrate_h1b_to_visa_cache, run_migrations


def run() -> None:
    """Build or repair the schema the way the old startup did, against the app's own database."""
    create_tables()
    db = SessionLocal()
    try:
        run_migrations(db)
        migrate_h1b_to_visa_cache(db)
    finally:
        db.close()


if __name__ == "__main__":
    run()
