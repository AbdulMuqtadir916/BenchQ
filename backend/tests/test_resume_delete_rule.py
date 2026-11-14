"""Deleting a base when something uses it (docs/team/resume-versioning.md §4.7, PR B): only a live application keeps a
tailored résumé in use; cover letters and tracking links don't count; "keep what is in use and delete the rest"; an
application keeps showing the résumé it was sent with after it is deleted."""
import pytest

from backend.candidates import versions
from backend.models.candidates import BaseResume, Candidate
from backend.models.db import Application, Resume
from backend.models.tenancy import DEFAULT_FIRM_ID, User
from backend.tests.resume_support import make_posting, make_version

pytestmark = pytest.mark.usefixtures("default_firm")


def _world(db):
    """A candidate whose BDE made everything: an active Base 1, and Base 2 (not active) with v1 and v2, a tailored
    résumé for each of two jobs. Returns the pieces."""
    first = make_version(db, DEFAULT_FIRM_ID, summary="Base 1")
    candidate = db.get(Candidate, first.candidate_id)
    bde = User(firm_id=DEFAULT_FIRM_ID, role="BDE", name="A BDE", manager_id=candidate.manager_id,
               email="bde-rule@example.test", password_hash="x")
    db.add(bde)
    db.flush()
    base2 = BaseResume(firm_id=DEFAULT_FIRM_ID, candidate_id=candidate.id, source="PROMOTED", is_active=False,
                       created_by_user_id=bde.id)
    db.add(base2)
    db.flush()
    # A tailored résumé names one of the candidate's job postings (0023), and so does an application (0027).
    postings = [make_posting(db, DEFAULT_FIRM_ID, candidate.id, bde.id, n) for n in range(2)]

    def version(number, category="BASE", job=None):
        row = Resume(firm_id=DEFAULT_FIRM_ID, candidate_id=candidate.id, base_resume_id=base2.id, category=category,
                     version=number, name="Base 2", job_id=job.id if job else None, created_by_user_id=bde.id,
                     summary=f"B2 {category} {number}", summary_id=f"sum-{category}-{number}-{job.id if job else 0}")
        db.add(row)
        db.flush()
        return row

    world = dict(candidate=candidate, bde=bde, base1=first, base2=base2, postings=postings, v1=version(1), v2=version(2),
                 t1=version(1, "TAILORED", postings[0]), t2=version(1, "TAILORED", postings[1]))
    db.commit()
    return world


def _apply(db, world, resume, status="applied", job=0):
    """An application for the candidate's `world["postings"][job]`, sent with `resume`."""
    app = Application(firm_id=DEFAULT_FIRM_ID, job_id=world["postings"][job].id, candidate_id=world["candidate"].id,
                      status=status, resume_id=resume.id)
    db.add(app)
    db.commit()
    return app


def _gone(db, *rows):
    return [db.get(Resume, r.id).deleted_at is not None for r in rows]


def test_the_in_use_check_names_live_applications_and_tailorings_only(test_db):
    w = _world(test_db)
    removal = versions.base_removal(test_db, w["candidate"], w["base2"])
    assert set(removal.uses) == {"applications", "tailored"}          # no letters, no links, no claims


def test_a_base_nothing_uses_is_deleted_with_its_unused_tailorings(test_db):
    w = _world(test_db)
    removal = versions.base_removal(test_db, w["candidate"], w["base2"])
    assert removal.outcome == "DELETE" and "2 tailored résumés nobody sent" in removal.message
    versions.delete_base(test_db, w["bde"], w["candidate"], w["base2"])
    test_db.commit()
    assert test_db.get(BaseResume, w["base2"].id).deleted_at is not None
    assert _gone(test_db, w["v1"], w["v2"], w["t1"], w["t2"]) == [True] * 4


@pytest.mark.parametrize("status", ["applied", "interview_scheduled", "offer", "saved", "other", "interview"])
def test_a_tailored_resume_sent_in_a_live_application_keeps_its_base_alive_hidden(test_db, status):
    w = _world(test_db)
    _apply(test_db, w, w["t1"], status)
    removal = versions.base_removal(test_db, w["candidate"], w["base2"])
    assert removal.outcome == "HIDE" and removal.uses["tailored"] == 1
    assert removal.rest == {"versions": 1, "tailored": 1}                      # v2 and the other tailoring; v1 stays
    assert "Keep what is in use and delete the rest (1 unused version, 1 tailored résumé nobody sent)?" in removal.message


@pytest.mark.parametrize("status", ["move_on", "rejected", "MOVE_ON", "Rejected"])
def test_a_closed_application_does_not_keep_anything_in_use(test_db, status):
    w = _world(test_db)
    _apply(test_db, w, w["t1"], status)
    assert versions.base_removal(test_db, w["candidate"], w["base2"]).outcome == "DELETE"


def test_hiding_without_keep_used_deletes_nothing(test_db):
    w = _world(test_db)
    _apply(test_db, w, w["t1"])
    versions.delete_base(test_db, w["bde"], w["candidate"], w["base2"])
    test_db.commit()
    base = test_db.get(BaseResume, w["base2"].id)
    assert base.archived_at is not None and base.deleted_at is None
    assert _gone(test_db, w["v1"], w["v2"], w["t1"], w["t2"]) == [False] * 4


def test_keep_used_hides_the_base_and_deletes_only_what_nothing_uses(test_db):
    w = _world(test_db)
    _apply(test_db, w, w["t1"])
    versions.delete_base(test_db, w["bde"], w["candidate"], w["base2"], keep_used=True)
    test_db.commit()
    base = test_db.get(BaseResume, w["base2"].id)
    assert base.archived_at is not None and base.deleted_at is None
    assert _gone(test_db, w["v1"], w["v2"], w["t1"], w["t2"]) == [False, True, False, True]   # v2 and t2 gone


def test_keep_used_keeps_a_version_a_live_application_was_sent_with(test_db):
    w = _world(test_db)
    _apply(test_db, w, w["v2"])
    removal = versions.base_removal(test_db, w["candidate"], w["base2"])
    assert removal.outcome == "HIDE" and removal.uses["applications"] == 1 and removal.rest == {"versions": 0, "tailored": 2}
    versions.delete_base(test_db, w["bde"], w["candidate"], w["base2"], keep_used=True)
    test_db.commit()
    assert _gone(test_db, w["v1"], w["v2"], w["t1"], w["t2"]) == [False, False, True, True]


def test_the_active_base_is_still_refused(test_db):
    w = _world(test_db)
    active = test_db.get(BaseResume, w["base1"].base_resume_id)
    assert active.is_active and versions.base_removal(test_db, w["candidate"], active).outcome == "REFUSED"


def test_an_application_keeps_showing_the_resume_it_was_sent_with_after_it_is_deleted(test_db):
    from backend.api.routes_applications import _application_responses
    w = _world(test_db)
    app = _apply(test_db, w, w["t1"], "move_on")
    versions.delete_base(test_db, w["bde"], w["candidate"], w["base2"])
    test_db.commit()
    (row,) = _application_responses(test_db, DEFAULT_FIRM_ID, [app])
    assert (row["tailored_resume_id"], row["tailored_resume_name"], row["tailored_resume_deleted"]) == (
        str(w["t1"].id), "Base 2", True)


def test_an_application_sent_with_a_base_version_shows_that_version(test_db):
    from backend.api.routes_applications import _application_responses
    w = _world(test_db)
    app = _apply(test_db, w, w["v2"])
    (row,) = _application_responses(test_db, DEFAULT_FIRM_ID, [app])
    # A BDE can send any résumé, base or tailored: the application shows the one it was sent with.
    assert row["tailored_resume_id"] == str(w["v2"].id) and row["tailored_resume_deleted"] is False
