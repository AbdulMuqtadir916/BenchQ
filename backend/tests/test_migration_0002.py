"""Revision 0002 widens tracer_links.token from VARCHAR(10) to VARCHAR(16).

routes_resumes mints secrets.token_urlsafe(8) (11 characters) for a link with no job short_id; at the
baseline's VARCHAR(10) Postgres refused every one. These tests take a scratch database that really is at
0001 (as every dev database stamped by F1 is), upgrade it, and check the column, the rows and the way back.
"""
import os
import secrets
import subprocess
import sys
import uuid

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import DataError
from sqlalchemy.pool import NullPool

from backend.tests.test_schema_matches_legacy import _admin_engine, _url_for

_TOKEN_TYPE = """
    SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid WHERE c.relname = 'tracer_links' AND a.attname = 'token'"""


@pytest.fixture
def scratch_db():
    name = f"jn_0002_{uuid.uuid4().hex[:8]}_test"
    admin = _admin_engine()
    with admin.connect() as conn:
        conn.execute(text(f'CREATE DATABASE "{name}"'))
    engine = create_engine(_url_for(name), poolclass=NullPool)
    try:
        yield name, engine
    finally:
        engine.dispose()
        with admin.connect() as conn:
            conn.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        admin.dispose()


def _alembic(dbname: str, *args: str) -> subprocess.CompletedProcess:
    env = {**os.environ, "DATABASE_URL": _url_for(dbname)}
    return subprocess.run([sys.executable, "-m", "alembic", "-c", "backend/alembic.ini", *args],
                          env=env, capture_output=True, text=True)


def _ok(done: subprocess.CompletedProcess) -> None:
    assert done.returncode == 0, f"alembic failed:\n{done.stdout}\n{done.stderr}"


def _insert_link(engine, token: str) -> None:
    with engine.begin() as conn:
        conn.execute(text(
            "INSERT INTO tracer_links (id, token, destination_url, source_label) VALUES (:id, :t, 'https://x.test', 'web')"),
            {"id": uuid.uuid4(), "t": token})


def test_the_baseline_refuses_a_minted_token(scratch_db):
    """Pins the bug 0002 fixes, so this test file can't pass against a database that never had it."""
    name, engine = scratch_db
    _ok(_alembic(name, "upgrade", "0001"))
    with pytest.raises(DataError):
        _insert_link(engine, secrets.token_urlsafe(8))


def test_upgrade_widens_the_column_and_keeps_the_rows(scratch_db):
    name, engine = scratch_db
    _ok(_alembic(name, "upgrade", "0001"))
    _insert_link(engine, "abcdefghij")

    _ok(_alembic(name, "upgrade", "0002"))

    with engine.connect() as conn:
        assert conn.execute(text(_TOKEN_TYPE)).scalar() == "character varying(16)"
        assert conn.execute(text("SELECT token FROM tracer_links")).scalars().all() == ["abcdefghij"]
    minted = secrets.token_urlsafe(8)
    assert len(minted) == 11
    _insert_link(engine, minted)


def test_downgrade_returns_to_the_baseline_and_refuses_to_cut_tokens(scratch_db):
    name, engine = scratch_db
    _ok(_alembic(name, "upgrade", "0002"))
    _insert_link(engine, secrets.token_urlsafe(8))

    assert _alembic(name, "downgrade", "0001").returncode != 0, "shrinking must not truncate a live token"

    with engine.begin() as conn:
        conn.execute(text("DELETE FROM tracer_links"))
    _ok(_alembic(name, "downgrade", "0001"))
    with engine.connect() as conn:
        assert conn.execute(text(_TOKEN_TYPE)).scalar() == "character varying(10)"
