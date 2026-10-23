"""The Alembic baseline is the schema the old startup path built (docs/integration/07, F1).

Two scratch databases are built from nothing, one the old way (migrations/legacy_bootstrap.py: create_tables +
run_migrations + migrate_h1b_to_visa_cache) and one by `db_upgrade` (alembic upgrade head), and their catalogs
are compared: tables, columns (type, nullability, default), constraints, indexes, sequences. The old path's
create_all reads today's models, so it is compared with head, not with the baseline alone, on the tables it
builds: tables added after the baseline (models/tenancy.py) exist only through Alembic. A third test
asks Alembic whether the models still agree with the migrations, so a model change without a revision fails.
"""
import os
import subprocess
import sys
import uuid

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.pool import NullPool

from backend.db_schema import head_revision
from backend.tests.conftest import TEST_DATABASE_URL

_CATALOG_QUERIES = {
    "columns": """
        SELECT c.relname AS tbl, a.attname AS col, format_type(a.atttypid, a.atttypmod) AS type,
               a.attnotnull AS notnull, pg_get_expr(d.adbin, d.adrelid) AS dflt, a.attidentity AS ident
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid AND c.relkind = 'r'
        JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
        LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attnum > 0 AND NOT a.attisdropped AND c.relname <> 'alembic_version'
        ORDER BY 1, 2""",
    "constraints": """
        SELECT c.relname AS tbl, k.conname AS name, k.contype AS kind, pg_get_constraintdef(k.oid) AS def
        FROM pg_constraint k
        JOIN pg_class c ON c.oid = k.conrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
        WHERE c.relname <> 'alembic_version'
        ORDER BY 1, 2""",
    "indexes": """
        SELECT tablename AS tbl, indexname AS name, indexdef AS def
        FROM pg_indexes WHERE schemaname = 'public' AND tablename <> 'alembic_version'
        ORDER BY 1, 2""",
    "sequences": """
        SELECT sequencename AS name, data_type::text AS type, start_value, increment_by, min_value, max_value, cycle
        FROM pg_sequences WHERE schemaname = 'public' ORDER BY 1""",
}


def _admin_engine():
    return create_engine(TEST_DATABASE_URL, poolclass=NullPool, isolation_level="AUTOCOMMIT")


def _url_for(dbname: str) -> str:
    return make_url(TEST_DATABASE_URL).set(database=dbname).render_as_string(hide_password=False)


@pytest.fixture
def scratch_dbs():
    """Two empty databases (names end in _test, so conftest's guard still holds), dropped afterwards."""
    suffix = uuid.uuid4().hex[:8]
    names = {"legacy": f"jn_legacy_{suffix}_test", "alembic": f"jn_alembic_{suffix}_test"}
    admin = _admin_engine()
    with admin.connect() as conn:
        for n in names.values():
            conn.execute(text(f'CREATE DATABASE "{n}"'))
    try:
        yield names
    finally:
        with admin.connect() as conn:
            for n in names.values():
                conn.execute(text(f'DROP DATABASE IF EXISTS "{n}" WITH (FORCE)'))
        admin.dispose()


def _run(module: str, dbname: str) -> None:
    env = {**os.environ, "DATABASE_URL": _url_for(dbname)}
    done = subprocess.run([sys.executable, "-m", module], env=env, capture_output=True, text=True)
    assert done.returncode == 0, f"{module} failed:\n{done.stdout}\n{done.stderr}"


def _catalog(dbname: str) -> dict:
    engine = create_engine(_url_for(dbname), poolclass=NullPool)
    try:
        with engine.connect() as conn:
            return {k: [tuple(r) for r in conn.execute(text(q))] for k, q in _CATALOG_QUERIES.items()}
    finally:
        engine.dispose()


def test_alembic_baseline_equals_the_old_startup_schema(scratch_dbs):
    _run("backend.migrations.legacy_bootstrap", scratch_dbs["legacy"])
    _run("backend.scripts.db_upgrade", scratch_dbs["alembic"])

    old, new = _catalog(scratch_dbs["legacy"]), _catalog(scratch_dbs["alembic"])
    # Tables added after the baseline (models/tenancy.py) exist only through Alembic, and so do the columns later
    # revisions added to the old tables (firm_id, 0005); compare the rest.
    new = _without_later_columns(_only_tables(new, {row[0] for row in old["columns"]}))
    assert old["columns"] and new["columns"], "the catalog query found nothing; the comparison would be vacuous"

    for kind in _CATALOG_QUERIES:
        only_old = sorted(set(old[kind]) - set(new[kind]))
        only_new = sorted(set(new[kind]) - set(old[kind]))
        assert not only_old and not only_new, (
            f"{kind} differ.\nOnly in the old startup path:\n  " + "\n  ".join(map(str, only_old))
            + "\nOnly in the Alembic baseline:\n  " + "\n  ".join(map(str, only_new)))


def _only_tables(catalog: dict, tables: set) -> dict:
    """The catalog limited to `tables` (sequences have no table and are kept whole)."""
    return {k: rows if k == "sequences" else [r for r in rows if r[0] in tables] for k, rows in catalog.items()}


def _later_columns() -> set:
    """(table, column) pairs added to the old tables after the baseline: models marked alembic_only."""
    from backend.models.db import Base
    return {(t.name, c.name) for t in Base.metadata.sorted_tables if not t.info.get("alembic_only")
            for c in t.columns if c.info.get("alembic_only")}


def _without_later_columns(catalog: dict) -> dict:
    """The catalog without those columns, or the constraints and indexes on them (whose names and definitions
    name the column)."""
    later = _later_columns()

    def keep(kind, row):
        if kind == "sequences":
            return True
        if kind == "columns":
            return (row[0], row[1]) not in later
        return not any(row[0] == table and any(column in str(part) for part in row[1:]) for table, column in later)

    return {k: [r for r in rows if keep(k, r)] for k, rows in catalog.items()}


def test_an_existing_unversioned_database_is_stamped_not_recreated(scratch_dbs):
    """db_upgrade on a database the old path built: keep the rows, stamp it at the baseline, then upgrade it
    to head. (The old path builds from today's models, so later revisions find nothing to change here;
    test_migration_0002.py covers a database that really is at the baseline.)"""
    name = scratch_dbs["legacy"]
    _run("backend.migrations.legacy_bootstrap", name)
    engine = create_engine(_url_for(name), poolclass=NullPool)
    try:
        with engine.begin() as conn:
            conn.execute(text("INSERT INTO settings (key, value) VALUES ('keep_me', 'yes')"))
        before = _catalog(name)

        _run("backend.scripts.db_upgrade", name)

        with engine.connect() as conn:
            assert conn.execute(text("SELECT value FROM settings WHERE key = 'keep_me'")).scalar() == "yes"
            assert conn.execute(text("SELECT version_num FROM alembic_version")).scalar() == head_revision()
        after = _catalog(name)
        assert _without_later_columns(_only_tables(after, {row[0] for row in before["columns"]})) == before, \
            "stamping must not change the existing tables, beyond what later revisions add"
        assert ("resumes", "firm_id") in {(row[0], row[1]) for row in after["columns"]}, \
            "the upgrade after stamping must add the later revisions' columns"
        assert {"firms", "users", "invites"} <= {row[0] for row in after["columns"]}, \
            "the upgrade after stamping must add the later revisions' tables"
    finally:
        engine.dispose()


def test_models_and_migrations_agree(scratch_dbs):
    """`alembic check` on a database built only by migrations: autogenerate must find nothing to add.
    (A scratch database, because other tests create throwaway tables in the shared one.)"""
    _run("backend.scripts.db_upgrade", scratch_dbs["alembic"])
    env = {**os.environ, "DATABASE_URL": _url_for(scratch_dbs["alembic"])}
    done = subprocess.run([sys.executable, "-m", "alembic", "-c", "backend/alembic.ini", "check"],
                          env=env, capture_output=True, text=True)
    assert done.returncode == 0, f"models and migrations disagree:\n{done.stdout}\n{done.stderr}"
