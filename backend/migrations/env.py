"""Alembic environment. The URL comes from backend.config.DATABASE_URL (the app's own setting),
so a migration always runs against the database the backend would use."""
from alembic import context
from sqlalchemy import create_engine, pool

from backend.config import DATABASE_URL
from backend.models.db import Base

target_metadata = Base.metadata


def _compare_server_default(context, inspected_column, metadata_column, inspected_default,
                            metadata_default, rendered_metadata_default):
    """Postgres reports nextval('seq') as nextval('seq'::regclass); that is the same default, not drift.
    None means "use Alembic's own comparison"."""
    if isinstance(inspected_default, str) and isinstance(rendered_metadata_default, str):
        if inspected_default.replace("::regclass", "") == rendered_metadata_default:
            return False
    return None


def run_migrations_offline() -> None:
    context.configure(url=DATABASE_URL, target_metadata=target_metadata, literal_binds=True,
                      compare_type=True, compare_server_default=_compare_server_default)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    # A caller (db_upgrade.py, tests) may pass its own connection through config.attributes.
    connection = context.config.attributes.get("connection")
    if connection is not None:
        _run(connection)
        return
    engine = create_engine(DATABASE_URL, poolclass=pool.NullPool)
    with engine.connect() as connection:
        _run(connection)


def _run(connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata,
                      compare_type=True, compare_server_default=_compare_server_default)
    with context.begin_transaction():
        context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
