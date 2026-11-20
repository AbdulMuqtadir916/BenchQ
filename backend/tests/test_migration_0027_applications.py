"""Migrations 0026 and 0027, and the local move between them: applications let go of the old `jobs` pool, a local
database's old jobs are copied into `job_postings` with its applications pointed at them, and then each application
names one of its own candidate's postings (the add-job plan, decided 2026-11-11). The migrations change no row."""
import uuid

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from backend.scripts.move_local_jobs_to_postings import move, undo
from backend.tests.test_migration_0002 import _alembic, _ok, scratch_db  # noqa: F401
from backend.tests.test_migration_0020 import _firm_and_candidate


def _old_job_and_application(engine, firm_id, candidate_id):
    job_id, app_id = uuid.uuid4(), uuid.uuid4()
    with engine.begin() as conn:
        conn.execute(text(
            "INSERT INTO jobs (id, external_id, title, company, url, description, source, salary_min, salary_max) "
            "VALUES (:id, :ext, 'Java Developer', 'Acme', 'https://jobs.acme.test/1', 'Build the API.', "
            "'jobspy_linkedin', 120000, 140000)"),
            {"id": job_id, "ext": uuid.uuid4().hex})
        conn.execute(text("INSERT INTO candidate_jobs (id, firm_id, candidate_id, job_id) VALUES (:id, :f, :c, :j)"),
                     {"id": uuid.uuid4(), "f": firm_id, "c": candidate_id, "j": job_id})
        conn.execute(text("INSERT INTO applications (id, firm_id, job_id, candidate_id, status) VALUES "
                          "(:id, :f, :j, :c, 'saved')"), {"id": app_id, "f": firm_id, "j": job_id, "c": candidate_id})
    return job_id, app_id


def test_0027_refuses_until_the_applications_are_moved_and_then_links_them(scratch_db):
    name, engine = scratch_db
    _ok(_alembic(name, "upgrade", "0021"))
    firm_id, candidate_id, _ = _firm_and_candidate(engine)
    job_id, app_id = _old_job_and_application(engine, firm_id, candidate_id)
    _ok(_alembic(name, "upgrade", "0026"))
    with engine.connect() as conn:          # 0026 changed no row
        assert conn.execute(text("SELECT job_id FROM applications WHERE id = :id"), {"id": app_id}).scalar() == job_id

    refused = _alembic(name, "upgrade", "0027")    # the new key refuses an application on an old job
    assert refused.returncode != 0 and "fk_applications_job_posting" in refused.stderr

    with engine.begin() as conn:
        assert move(conn) == {"postings copied": 1, "batches": 1, "applications moved": 1}
    with engine.begin() as conn:            # a second run changes nothing
        assert move(conn) == {"postings copied": 0, "batches": 0, "applications moved": 0}
    with engine.connect() as conn:
        posting = conn.execute(text("SELECT id, source, content FROM job_postings")).one()
        assert posting.source == "legacy" and posting.content["old_job_id"] == str(job_id)
        assert {posting.content[k] for k in ("title", "company", "url", "old_source")} == {
            "Java Developer", "Acme", "https://jobs.acme.test/1", "jobspy_linkedin"}
        assert (posting.content["salary_min"], posting.content["salary_max"]) == (120000, 140000)   # its listed pay
        assert conn.execute(text("SELECT job_id FROM applications WHERE id = :id"), {"id": app_id}).scalar() == posting.id

    _ok(_alembic(name, "upgrade", "0027"))
    # An application names one of its own candidate's postings: another candidate's is refused.
    other = uuid.uuid4()
    with engine.begin() as conn:
        conn.execute(text(
            "INSERT INTO candidates (id, firm_id, manager_id, created_by_user_id, work_auth, needs_sponsorship, "
            "rate_target, rate_min, contact_notes) SELECT :id, firm_id, manager_id, created_by_user_id, work_auth, "
            "needs_sponsorship, rate_target, rate_min, contact_notes FROM candidates WHERE id = :c"),
            {"id": other, "c": candidate_id})
    try:
        with engine.begin() as conn:
            conn.execute(text("INSERT INTO applications (id, firm_id, job_id, candidate_id, status) VALUES "
                              "(:id, :f, :j, :c, 'saved')"),
                         {"id": uuid.uuid4(), "f": firm_id, "j": posting.id, "c": other})
        raise AssertionError("another candidate's posting was accepted")
    except IntegrityError:
        pass

    # Back down: 0027 lets go, the undo points the application at its old job again, and 0026 restores the old key.
    _ok(_alembic(name, "downgrade", "0026"))
    with engine.begin() as conn:
        assert undo(conn) == {"applications moved back": 1, "postings dropped": 1, "postings kept for documents": 0,
                                "batches dropped": 1}
    _ok(_alembic(name, "downgrade", "0021"))
    with engine.connect() as conn:
        assert conn.execute(text("SELECT job_id FROM applications WHERE id = :id"), {"id": app_id}).scalar() == job_id


def test_a_database_with_no_old_applications_goes_straight_through(scratch_db):
    name, _ = scratch_db
    _ok(_alembic(name, "upgrade", "0027"))
    _ok(_alembic(name, "downgrade", "0021"))
