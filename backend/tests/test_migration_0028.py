"""Migration 0028 (decided 2026-11-14, Q35, Q39): the Match score's three columns on `job_postings` and `resumes`, a
0–100 check, and the index for one candidate's jobs best Match first. Additive: nothing is filled."""
from sqlalchemy import inspect

from backend.tests.test_migration_0002 import _alembic, _ok, scratch_db  # noqa: F401

COLUMNS = {"match_score", "match_note", "match_basis"}


def _columns(engine, table) -> set:
    return {column["name"] for column in inspect(engine).get_columns(table)}


def test_0028_adds_the_match_columns_and_the_index(scratch_db):
    name, engine = scratch_db
    _ok(_alembic(name, "upgrade", "0028"))
    for table in ("job_postings", "resumes"):
        assert COLUMNS <= _columns(engine, table)
        checks = {c["name"] for c in inspect(engine).get_check_constraints(table)}
        assert f"ck_{table}_match_score_range" in checks
    assert "ix_job_postings_candidate_match" in {i["name"] for i in inspect(engine).get_indexes("job_postings")}


def test_0028_downgrades_cleanly(scratch_db):
    name, engine = scratch_db
    _ok(_alembic(name, "upgrade", "0028"))
    _ok(_alembic(name, "downgrade", "0027"))
    for table in ("job_postings", "resumes"):
        assert not COLUMNS & _columns(engine, table)
    _ok(_alembic(name, "upgrade", "0028"))
