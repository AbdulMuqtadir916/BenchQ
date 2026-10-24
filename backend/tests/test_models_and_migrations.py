"""The models and the migrations agree, and a database Alembic never saw is refused with the fix.

`alembic check` runs on a database built only by migrations: autogenerate must find nothing to add, so a model
change without a revision fails here. (A scratch database, because other tests create throwaway tables in the
shared one.) Before F6 this lived in test_schema_matches_legacy.py, next to the comparison with the old startup path.
"""
import os
import subprocess
import sys
import uuid

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

from backend.tests.scratch_db import _admin_engine, _url_for


@pytest.fixture
def scratch_name():
    name = f"jn_alembic_{uuid.uuid4().hex[:8]}_test"
    admin = _admin_engine()
    with admin.connect() as conn:
        conn.execute(text(f'CREATE DATABASE "{name}"'))
    try:
        yield name
    finally:
        with admin.connect() as conn:
            conn.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        admin.dispose()


def _run(module: str, dbname: str) -> subprocess.CompletedProcess:
    env = {**os.environ, "DATABASE_URL": _url_for(dbname)}
    return subprocess.run([sys.executable, "-m", module], env=env, capture_output=True, text=True)


def test_models_and_migrations_agree(scratch_name):
    done = _run("backend.scripts.db_upgrade", scratch_name)
    assert done.returncode == 0, f"db_upgrade failed:\n{done.stdout}\n{done.stderr}"
    env = {**os.environ, "DATABASE_URL": _url_for(scratch_name)}
    done = subprocess.run([sys.executable, "-m", "alembic", "-c", "backend/alembic.ini", "check"],
                          env=env, capture_output=True, text=True)
    assert done.returncode == 0, f"models and migrations disagree:\n{done.stdout}\n{done.stderr}"


def test_an_empty_database_is_built_by_the_migrations(scratch_name):
    done = _run("backend.scripts.db_upgrade", scratch_name)
    assert done.returncode == 0, f"db_upgrade failed:\n{done.stdout}\n{done.stderr}"
    engine = create_engine(_url_for(scratch_name), poolclass=NullPool)
    try:
        with engine.connect() as conn:
            from backend.db_schema import head_revision
            assert conn.execute(text("SELECT version_num FROM alembic_version")).scalar() == head_revision()
    finally:
        engine.dispose()


def test_a_database_with_tables_but_no_alembic_history_is_refused_with_the_fix(scratch_name):
    """A database the old startup path built and nobody stamped: no rows are touched and the error says what to do."""
    engine = create_engine(_url_for(scratch_name), poolclass=NullPool)
    try:
        with engine.begin() as conn:
            conn.execute(text("CREATE TABLE settings (key text PRIMARY KEY, value text)"))
            conn.execute(text("INSERT INTO settings VALUES ('keep_me', 'yes')"))

        done = _run("backend.scripts.db_upgrade", scratch_name)

        assert done.returncode != 0
        message = done.stderr
        assert "UnstampedDatabaseError" in message and "never stamped" in message
        assert "git checkout" in message and "docker compose down -v" in message
        with engine.connect() as conn:
            tables = {r[0] for r in conn.execute(text(
                "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"))}
            assert tables == {"settings"}, "the refusal must not create or stamp anything"
            assert conn.execute(text("SELECT value FROM settings WHERE key = 'keep_me'")).scalar() == "yes"
    finally:
        engine.dispose()
