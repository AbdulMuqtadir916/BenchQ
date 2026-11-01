"""Migration 0008 (docs/team/resume-versioning.md §3; PR 3): base_resumes, the versioned resumes columns, the job
cascade and award claims; the rules the database holds, and old rows left as they were."""
import uuid
from datetime import timedelta

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from backend.models.candidates import BaseResume, Candidate, Claim, ResumeParse
from backend.models.db import Application, Job, Resume, utcnow
from backend.models.tenancy import DEFAULT_FIRM_ID, Firm, User
from backend.tests.auth_support import make_user
from backend.tests.test_migration_0002 import _alembic, _ok, scratch_db  # noqa: F401


@pytest.fixture
def world(test_db, accounts):
    firm = test_db.get(Firm, accounts.firm_id)
    owner = test_db.get(User, accounts.user_id)
    manager = make_user(test_db, firm, email="m@acme.test", role="MANAGER")
    people = [Candidate(firm_id=firm.id, manager_id=manager.id, created_by_user_id=owner.id, full_name=name,
                        work_auth="H1B") for name in ("Asha Rao", "Ravi Teja")]
    jobs = [Job(external_id=f"v-job-{n}", title="Data Engineer", company="Acme", url=f"https://jobs.example.test/{n}",
                source="manual") for n in (7, 8)]
    test_db.add_all(people + jobs)
    test_db.flush()
    parse = ResumeParse(firm_id=firm.id, uploaded_by_user_id=owner.id, candidate_id=people[0].id, file_name="a.pdf",
                        mime_type="application/pdf", size_bytes=1, content=b"x", parse={})
    test_db.add(parse)
    test_db.flush()
    base = BaseResume(firm_id=firm.id, candidate_id=people[0].id, source="UPLOAD", resume_parse_id=parse.id,
                      is_active=True, created_by_user_id=owner.id)
    test_db.add(base)
    test_db.flush()
    return {"firm": firm, "owner": owner, "asha": people[0], "ravi": people[1], "jobs": jobs, "parse": parse,
            "base": base}


def _refused(test_db, row, constraint: str) -> None:
    """The insert fails on exactly this constraint, in a savepoint so the rows the test set up stay."""
    with pytest.raises(IntegrityError, match=constraint):
        with test_db.begin_nested():
            test_db.add(row)
            test_db.flush()


def _version(world, **values) -> Resume:
    """A versioned row of Asha's base: base v1 unless the test says otherwise. `is_base` follows the category while it
    exists (PR 6 drops it), so code that still reads it isn't misled."""
    row = {"firm_id": world["firm"].id, "candidate_id": world["asha"].id, "base_resume_id": world["base"].id,
           "name": "Base", "category": "BASE", "version": 1, "created_by_user_id": world["owner"].id, **values}
    return Resume(**row, is_base=row["category"] == "BASE")


# ── base_resumes ─────────────────────────────────────────────────────────────

def test_a_candidate_has_one_active_base_and_any_number_of_others(test_db, world):
    second = dict(firm_id=world["firm"].id, candidate_id=world["asha"].id, source="PROMOTED",
                  created_by_user_id=world["owner"].id)
    _refused(test_db, BaseResume(**second, is_active=True), "uq_base_resumes_one_active")
    test_db.add_all([BaseResume(**second), BaseResume(**second)])
    test_db.flush()
    assert test_db.query(BaseResume).filter(BaseResume.candidate_id == world["asha"].id).count() == 3


def test_an_upload_base_names_its_upload_and_the_source_is_known(test_db, world):
    row = dict(firm_id=world["firm"].id, candidate_id=world["ravi"].id, created_by_user_id=world["owner"].id)
    _refused(test_db, BaseResume(**row, source="UPLOAD"), "ck_base_resumes_source")
    _refused(test_db, BaseResume(**row, source="COPIED", resume_parse_id=world["parse"].id),
             "ck_base_resumes_source_values")


# ── resumes: versions ────────────────────────────────────────────────────────

def test_a_new_version_starts_with_every_section_empty_not_null(test_db, world):
    row = _version(world)
    test_db.add(row)
    test_db.flush()
    test_db.refresh(row)
    assert [getattr(row, s) for s in ("skills", "experiences", "projects", "educations", "certifications", "awards",
                                      "languages")] == [[]] * 7


def test_one_resume_is_one_base_category_and_job_each_edit_a_version(test_db, world):
    job7, job8 = world["jobs"]
    test_db.add_all([_version(world), _version(world, version=2),
                     _version(world, category="TAILORED", job_id=job7.id),
                     _version(world, category="TAILORED", job_id=job7.id, version=2),
                     _version(world, category="TAILORED", job_id=job8.id)])
    test_db.flush()
    _refused(test_db, _version(world, version=2), "uq_resumes_version")                       # base v2 again
    _refused(test_db, _version(world, category="TAILORED", job_id=job7.id), "uq_resumes_version")


def test_a_base_has_no_job_and_a_tailored_resume_has_one(test_db, world):
    _refused(test_db, _version(world, job_id=world["jobs"][0].id), "ck_resumes_category_job")
    _refused(test_db, _version(world, category="TAILORED"), "ck_resumes_category_job")
    _refused(test_db, _version(world, category="DRAFT"), "ck_resumes_category_(values|job)")   # breaks both


def test_a_version_belongs_to_its_bases_candidate(test_db, world):
    _refused(test_db, _version(world, candidate_id=world["ravi"].id), "fk_resumes_base_candidate")
    _refused(test_db, _version(world, candidate_id=None), "ck_resumes_base_has_candidate")


def test_rows_from_before_versioning_are_left_alone(test_db, world):
    """No base: the version rules don't apply until PR 6 converts these rows, and 0007's one-base rule still does."""
    old = dict(firm_id=world["firm"].id, name="Old")
    test_db.add_all([Resume(**old, category="BASE"), Resume(**old, category="BASE"),
                     Resume(**old, category="TAILORED", is_base=False)])                     # tailored, no job
    test_db.flush()
    test_db.add(Resume(**old, candidate_id=world["ravi"].id))
    test_db.flush()
    _refused(test_db, Resume(**old, candidate_id=world["ravi"].id), "uq_resumes_one_base_per_candidate")


def test_a_versioned_candidate_has_many_base_versions_and_bases(test_db, world):
    second = BaseResume(firm_id=world["firm"].id, candidate_id=world["asha"].id, source="PROMOTED",
                        created_by_user_id=world["owner"].id)
    test_db.add(second)
    test_db.flush()
    test_db.add_all([_version(world), _version(world, version=2), _version(world, base_resume_id=second.id)])
    test_db.flush()


# ── Deleting a job (Abdul, 2026-11-01) ──────────────────────────────────────

def test_deleting_a_job_deletes_the_resumes_tailored_for_it(test_db, world):
    job7, job8 = world["jobs"]
    base = _version(world)
    test_db.add_all([base, _version(world, category="TAILORED", job_id=job7.id),
                     _version(world, category="TAILORED", job_id=job7.id, version=2),
                     _version(world, category="TAILORED", job_id=job8.id)])
    test_db.commit()
    test_db.delete(job7)                       # through the ORM, as the app deletes jobs
    test_db.commit()
    left = test_db.query(Resume.category, Resume.job_id).filter(Resume.candidate_id == world["asha"].id).all()
    assert sorted(left, key=str) == sorted([("BASE", None), ("TAILORED", job8.id)], key=str)


def test_a_job_an_application_names_cannot_be_deleted(test_db, world):
    job7 = world["jobs"][0]
    tailored = _version(world, category="TAILORED", job_id=job7.id)
    test_db.add(tailored)
    test_db.flush()
    test_db.add(Application(firm_id=world["firm"].id, candidate_id=world["asha"].id, job_id=job7.id,
                            resume_id=tailored.id, submitted_by_user_id=world["owner"].id))
    test_db.commit()
    with pytest.raises(IntegrityError):
        test_db.delete(job7)
        test_db.commit()
    test_db.rollback()
    assert test_db.get(Resume, tailored.id) is not None                # the résumé that was sent stays


# ── Claims ───────────────────────────────────────────────────────────────────

def test_an_award_can_be_a_claim(test_db, world):
    test_db.add(Claim(firm_id=world["firm"].id, candidate_id=world["asha"].id, entity_type="award",
                      entity_ref=str(uuid.uuid4()), text="Dean's List", source="RESUME_UPLOAD", state="UNVERIFIED"))
    test_db.flush()


# ── The migration on a database with old rows ────────────────────────────────

def test_old_resumes_upgrade_get_their_category_and_downgrade_runs(scratch_db):  # noqa: F811
    name, engine = scratch_db
    _ok(_alembic(name, "upgrade", "0007"))
    job, base_a, base_b, tailored, orphan = (uuid.uuid4() for _ in range(5))
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO jobs (id, external_id, title, company, url, source) VALUES "
                          "(:j, 'old-job', 'Engineer', 'Acme', 'https://old.test', 'manual')"), {"j": job})
        # Two old bases and two old tailored résumés, one with no job: the rules must not refuse the upgrade.
        conn.execute(text("""
            INSERT INTO resumes (id, firm_id, name, is_base, job_id) VALUES
              (:a, :f, 'Base A', true, NULL), (:b, :f, 'Base B', true, NULL),
              (:t, :f, 'For the job', false, :j), (:o, :f, 'No job', false, NULL)
        """), {"a": base_a, "b": base_b, "t": tailored, "o": orphan, "f": DEFAULT_FIRM_ID, "j": job})
    _ok(_alembic(name, "upgrade", "0008"))
    with engine.connect() as conn:
        rows = dict(conn.execute(text("SELECT id, category FROM resumes")).all())
        assert rows == {base_a: "BASE", base_b: "BASE", tailored: "TAILORED", orphan: "TAILORED"}
        assert conn.execute(text("SELECT skills FROM resumes WHERE id = :a"), {"a": base_a}).scalar() == []
    _ok(_alembic(name, "downgrade", "0007"))
    _ok(_alembic(name, "upgrade", "0008"))
