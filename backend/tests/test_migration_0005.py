"""Revision 0005 (F2b): the rows that existed before it move into the Default firm, every job is linked to that
firm in firm_jobs, and the columns are NOT NULL afterwards, so a row without a firm is refused."""
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from backend.models.tenancy import DEFAULT_FIRM_ID
from backend.tests.test_migration_0002 import _alembic, _ok, scratch_db  # noqa: F401

SCRAPED_JOB, CAPTURED_JOB = uuid.uuid4(), uuid.uuid4()


def _seed_0004_rows(engine):
    """One row in every table 0005 touches, written the way the app did before firms existed."""
    search, app, resume, letter, link = (uuid.uuid4() for _ in range(5))
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO searches (id, name) VALUES (:s, 'S')"), {"s": search})
        conn.execute(text("""
            INSERT INTO jobs (id, external_id, title, company, url, source, search_id) VALUES
              (:a, 'ext-a', 'Engineer', 'Acme', 'https://a.test', 'jobspy_indeed', :s),
              (:b, 'ext-b', 'Analyst', 'Globex', 'https://b.test', 'manual', NULL)
        """), {"a": SCRAPED_JOB, "b": CAPTURED_JOB, "s": search})
        conn.execute(text("INSERT INTO applications (id, job_id) VALUES (:id, :j)"), {"id": app, "j": SCRAPED_JOB})
        conn.execute(text("INSERT INTO interviews (id, application_id, what) VALUES (:id, :a, 'Screen')"),
                     {"id": uuid.uuid4(), "a": app})
        conn.execute(text("INSERT INTO resumes (id, name) VALUES (:id, 'Base')"), {"id": resume})
        conn.execute(text("INSERT INTO cover_letters (id, name) VALUES (:id, 'L')"), {"id": letter})
        conn.execute(text("""
            INSERT INTO tracer_links (id, token, resume_id, destination_url, source_label)
            VALUES (:id, 'tok12345', :r, 'https://x.test', 'LinkedIn')
        """), {"id": link, "r": resume})
        conn.execute(text("INSERT INTO tracer_click_events (id, tracer_link_id, clicked_at) VALUES (:id, :l, now())"),
                     {"id": uuid.uuid4(), "l": link})
        conn.execute(text("INSERT INTO job_runs (id, job_type, trigger, status) VALUES (:id, 'scrape_all', "
                          "'scheduler', 'completed')"), {"id": uuid.uuid4()})


def test_existing_rows_move_into_the_default_firm(scratch_db):  # noqa: F811
    name, engine = scratch_db
    _ok(_alembic(name, "upgrade", "0004"))
    _seed_0004_rows(engine)
    _ok(_alembic(name, "upgrade", "0005"))

    with engine.connect() as conn:
        for table in ("searches", "applications", "interviews", "resumes", "cover_letters", "tracer_links",
                      "tracer_click_events"):
            firms = conn.execute(text(f"SELECT DISTINCT firm_id FROM {table}")).scalars().all()
            assert firms == [DEFAULT_FIRM_ID], table
        # A platform run stays platform-wide.
        assert conn.execute(text("SELECT firm_id FROM job_runs")).scalar() is None
        links = dict(conn.execute(text("SELECT job_id, origin FROM firm_jobs")).all())
        assert links == {SCRAPED_JOB: "SCRAPED", CAPTURED_JOB: "CAPTURED"}
        assert set(conn.execute(text("SELECT firm_id FROM firm_jobs")).scalars()) == {DEFAULT_FIRM_ID}


def test_a_firm_owned_row_without_a_firm_is_refused(scratch_db):  # noqa: F811
    name, engine = scratch_db
    _ok(_alembic(name, "upgrade", "0005"))
    with pytest.raises(IntegrityError):
        with engine.begin() as conn:
            conn.execute(text("INSERT INTO resumes (id, name) VALUES (:id, 'No firm')"), {"id": uuid.uuid4()})


def test_a_job_is_linked_to_a_firm_once(scratch_db):  # noqa: F811
    name, engine = scratch_db
    _ok(_alembic(name, "upgrade", "0004"))
    _seed_0004_rows(engine)
    _ok(_alembic(name, "upgrade", "0005"))
    with pytest.raises(IntegrityError):
        with engine.begin() as conn:
            conn.execute(text("INSERT INTO firm_jobs (firm_id, job_id, origin) VALUES (:f, :j, 'SCRAPED')"),
                         {"f": DEFAULT_FIRM_ID, "j": SCRAPED_JOB})


def test_downgrade_runs(scratch_db):  # noqa: F811
    name, engine = scratch_db
    _ok(_alembic(name, "upgrade", "0004"))
    _seed_0004_rows(engine)
    _ok(_alembic(name, "upgrade", "0005"))
    _ok(_alembic(name, "downgrade", "0004"))
    with engine.connect() as conn:
        columns = conn.execute(text(
            "SELECT count(*) FROM information_schema.columns WHERE column_name = 'firm_id' "
            "AND table_name IN ('searches', 'applications', 'resumes', 'job_runs')")).scalar()
        assert columns == 0
        assert conn.execute(text("SELECT count(*) FROM resumes")).scalar() == 1
