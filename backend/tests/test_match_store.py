"""The Match score, stored (backend/match/store.py, decided 2026-11-14, Q35, Q49): a search's save and a capture score
their jobs; a row is scored again only when what it was worked out from changed (here: the candidate's engagement
types); the startup pass scores what has no score, in one process at a time. A fake provider; made-up jobs."""
import uuid

from sqlalchemy import text

from backend.match import store
from backend.models.job_search import JobPosting
from backend.tests.test_candidates_api import world  # noqa: F401  (the fixture)
from backend.tests.test_job_search_api import _job, _run, adnans, fake  # noqa: F401  (fixtures)
from backend.tests.test_job_search_capture import _capture

NO_C2C = "Build Java services. No C2C. W2 only."


def _postings(test_db, candidate):
    test_db.expire_all()
    rows = test_db.query(JobPosting).filter(JobPosting.candidate_id == uuid.UUID(candidate["id"])).all()
    return {row.content.get("t") or row.content.get("title"): row for row in rows}


def test_a_search_saves_each_jobs_match_and_why_one_is_held_at_40(world, fake, adnans, test_db):
    fake.jobs = [_job(1, t="Senior Java Developer", d="Build Java services with Spring."), _job(2, d=NO_C2C)]
    _run(world, adnans)
    rows = _postings(test_db, adnans)
    for row in rows.values():
        assert 0 <= row.match_score <= 100 and len(row.match_basis) == 64
    held = rows["Java Developer 2"]                       # the candidate takes C2C only (the test body's engagement)
    assert held.match_score <= 40 and "C2C" in held.match_note
    assert rows["Senior Java Developer"].match_note is None


def test_a_capture_saves_its_match(anonymous_client, world, adnans, test_db):
    r = _capture(anonymous_client, world, adnans, description=NO_C2C)
    row = test_db.get(JobPosting, uuid.UUID(r.json()["id"]))
    assert row.match_score is not None and row.match_score <= 40 and "C2C" in row.match_note


def test_a_row_is_scored_again_only_when_what_it_read_changed(anonymous_client, world, fake, adnans, test_db):
    fake.jobs = [_job(2, d=NO_C2C)]
    _run(world, adnans)
    before = _postings(test_db, adnans)["Java Developer 2"].match_basis
    assert store.rescore(world["firm"].id, uuid.UUID(adnans["id"])) == 0          # nothing changed: nothing written
    r = anonymous_client.patch(f"/api/firms/{world['firm'].id}/candidates/{adnans['id']}",
                               json={"employment_types": ["C2C", "W2"]}, headers=world["as"]["adnan"])
    assert r.status_code == 200
    after = _postings(test_db, adnans)["Java Developer 2"]                       # scored again after the answer
    assert after.match_basis != before and after.match_note is None              # W2 now: no C2C caps nothing


def test_the_startup_pass_scores_what_has_no_score(world, fake, adnans, test_db):
    fake.jobs = [_job(1), _job(2)]
    _run(world, adnans)
    test_db.query(JobPosting).update({JobPosting.match_score: None, JobPosting.match_basis: None})
    test_db.commit()
    store.score_everything()
    assert all(row.match_score is not None for row in _postings(test_db, adnans).values())


def test_the_startup_pass_runs_in_one_process_at_a_time(world, fake, adnans, test_db):
    from backend.models.db import SessionLocal
    fake.jobs = [_job(1)]
    _run(world, adnans)
    test_db.query(JobPosting).update({JobPosting.match_score: None, JobPosting.match_basis: None})
    test_db.commit()
    with SessionLocal() as other:                                               # another process holds the lock
        assert other.execute(text("SELECT pg_try_advisory_lock(:key)"), {"key": store._LOCK}).scalar()
        store.score_everything()
        assert all(row.match_score is None for row in _postings(test_db, adnans).values())
        other.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": store._LOCK})
        other.commit()
