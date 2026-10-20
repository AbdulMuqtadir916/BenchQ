"""Schema management: the only way the database schema changes is an Alembic revision.

`upgrade_database()` is called once, before the API process starts (backend/scripts/db_upgrade.py).
`check_schema_at_head()` is called by the API's lifespan and refuses to start on any other schema.
"""
import logging
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, pool, text

from backend.config import DATABASE_URL

logger = logging.getLogger(__name__)

# The revision a database built by the old startup path is stamped with (migrations/versions/0001_baseline.py).
BASELINE_REVISION = "0001"

# Held for the whole upgrade, so two processes starting together cannot both migrate.
_ADVISORY_LOCK_KEY = 7_201_021_001

_ALEMBIC_INI = Path(__file__).resolve().parent / "alembic.ini"


def _config() -> Config:
    return Config(str(_ALEMBIC_INI))


def head_revision() -> str:
    return ScriptDirectory.from_config(_config()).get_current_head()


def current_revision(engine) -> str | None:
    with engine.connect() as conn:
        return MigrationContext.configure(conn).get_current_revision()


def check_schema_at_head() -> None:
    """Fail fast, with the fix in the message, when the database is not at the newest revision."""
    engine = create_engine(DATABASE_URL, poolclass=pool.NullPool)
    try:
        current = current_revision(engine)
    finally:
        engine.dispose()
    head = head_revision()
    if current != head:
        raise RuntimeError(
            f"Database schema is at {current or 'no revision'}, but this code needs {head}. "
            "Run `python -m backend.scripts.db_upgrade` (docker compose runs it before the API starts)."
        )


def upgrade_database() -> None:
    """Bring the database to head. An existing, never-stamped database is repaired and stamped first."""
    engine = create_engine(DATABASE_URL, poolclass=pool.NullPool)
    try:
        with engine.connect() as lock_conn:
            lock_conn.execute(text("SELECT pg_advisory_lock(:k)"), {"k": _ADVISORY_LOCK_KEY})
            try:
                _upgrade_locked(engine)
            finally:
                lock_conn.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": _ADVISORY_LOCK_KEY})
    finally:
        engine.dispose()


def _upgrade_locked(engine) -> None:
    cfg = _config()
    tables = set(inspect(engine).get_table_names())
    if "alembic_version" not in tables and tables:
        # Tables but no history: a database the old startup path built. Bring it to the baseline end
        # state (idempotent on one that is already there), then stamp; never re-create.
        logger.info("Existing unversioned database: running the legacy bootstrap, then stamping %s.",
                    BASELINE_REVISION)
        from backend.migrations import legacy_bootstrap
        legacy_bootstrap.run()
        command.stamp(cfg, BASELINE_REVISION)
    command.upgrade(cfg, "head")
