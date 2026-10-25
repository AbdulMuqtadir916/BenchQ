"""Scratch databases for tests that need a schema of their own (migrations, catalog checks).

Their names end in `_test`, so conftest's guard still holds; the caller drops them afterwards.
"""
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.pool import NullPool

from backend.tests.conftest import TEST_DATABASE_URL


def _admin_engine():
    return create_engine(TEST_DATABASE_URL, poolclass=NullPool, isolation_level="AUTOCOMMIT")


def _url_for(dbname: str) -> str:
    return make_url(TEST_DATABASE_URL).set(database=dbname).render_as_string(hide_password=False)
