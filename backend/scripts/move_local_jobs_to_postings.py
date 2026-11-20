"""Move a local database's applications from the old `jobs` pool onto `job_postings` (the add-job plan, 2026-11-11).

For a developer's own database, between migrations 0026 and 0027 (0027's new key refuses applications on old jobs):

    python -m backend.scripts.move_local_jobs_to_postings            # copy and point, in one transaction
    python -m backend.scripts.move_local_jobs_to_postings --dry-run  # say what it would do; write nothing
    python -m backend.scripts.move_local_jobs_to_postings --undo     # point back and drop the copies no document names (before 0026's downgrade)

- Every old job a candidate has (an application, or a search result in `candidate_jobs`) becomes one of that
  candidate's `job_postings`, source `legacy`, in one batch per candidate (a finished capture, `kind = 'capture'`, run
  by the candidate's BDE or, before one, its creator; `metadata.moved_locally = true`). Its `content` keeps the old job's title, company, description, link,
  location and salary bounds, `posted_at` (the old `discovered_at`), `old_job_id` and `old_source`, read by
  `backend/applications/postings.py`. Its identity is the job search rule, so a search that finds the job again
  refreshes this copy; when the candidate already has a posting with that identity (two old jobs alike), the old job's
  id joins it, so two old jobs never fold into one posting. A copy already made is reused, so a second run changes nothing.
- Each application then names its candidate's copy.

Refuses: a database not at 0026, one not on this machine (`db`, `localhost`), and an application with no candidate.
Prints counts only, never a job's or a candidate's details.
"""
import argparse
import json
import sys
import uuid
from urllib.parse import urlparse

from sqlalchemy import create_engine, text

from backend.applications.postings import LEGACY, job_hash
from backend.config import DATABASE_URL

LOCAL_HOSTS = {"db", "localhost", "127.0.0.1", "::1"}
BATCH_META = {"request": {"source": LEGACY}, "moved_locally": True}


def _refuse(message: str) -> None:
    print(f"Not moved: {message}", file=sys.stderr)
    raise SystemExit(1)


def move(conn) -> dict:
    """Copy and point. Returns the counts."""
    orphans = conn.execute(text("SELECT count(*) FROM applications WHERE candidate_id IS NULL")).scalar()
    if orphans:
        _refuse(f"{orphans} application(s) have no candidate. Clear those rows (from before 0007) first.")
    pairs = conn.execute(text(
        "SELECT a.firm_id, a.candidate_id, a.job_id FROM applications a JOIN jobs j ON j.id = a.job_id "
        "UNION SELECT cj.firm_id, cj.candidate_id, cj.job_id FROM candidate_jobs cj")).all()
    copies = {(row.candidate_id, row.old): row.id for row in conn.execute(text(
        "SELECT id, candidate_id, content->>'old_job_id' AS old FROM job_postings "
        "WHERE source = :legacy"), {"legacy": LEGACY})}
    batches, made = {}, 0
    for firm_id, candidate_id, old_id in pairs:
        if (candidate_id, str(old_id)) in copies:
            continue
        job = conn.execute(text(
            "SELECT title, company, description, url, location, salary_min, salary_max, discovered_at, source "
            "FROM jobs WHERE id = :id"), {"id": old_id}).one()
        if (firm_id, candidate_id) not in batches:
            batches[(firm_id, candidate_id)] = batch_id = uuid.uuid4()
            conn.execute(text(
                "INSERT INTO scrape_jobs (firm_id, candidate_id, user_id, batch_id, kind, state, finished_at, metadata) "
                "SELECT :firm_id, :candidate_id, COALESCE(bde_id, created_by_user_id), :batch_id, 'capture', 'success', "
                "now(), CAST(:meta AS jsonb) FROM candidates WHERE id = :candidate_id"),
                {"firm_id": firm_id, "candidate_id": candidate_id, "batch_id": batch_id, "meta": json.dumps(BATCH_META)})
        content = {key: value for key, value in {
            "title": job.title, "company": job.company, "description": job.description, "url": job.url,
            "location": job.location, "salary_min": job.salary_min, "salary_max": job.salary_max,
            "posted_at": job.discovered_at.isoformat() if job.discovered_at else None,
            "old_job_id": str(old_id), "old_source": job.source,
        }.items() if value not in (None, "")}
        digest = job_hash(job.company or "", job.title or "", job.description or "")
        if conn.execute(text("SELECT 1 FROM job_postings WHERE candidate_id = :candidate_id AND job_id = :digest"),
                        {"candidate_id": candidate_id, "digest": digest}).first():
            digest = job_hash(job.company or "", job.title or "", f"{job.description or ''}\x1f{old_id}")
        copies[(candidate_id, str(old_id))] = conn.execute(text(
            "INSERT INTO job_postings (firm_id, candidate_id, batch_id, source, first_source, job_id, content, "
            "discovered_at, last_seen_at) VALUES (:firm_id, :candidate_id, :batch_id, :legacy, :legacy, :digest, "
            "CAST(:content AS jsonb), COALESCE(:seen, now()), now()) RETURNING id"),
            {"firm_id": firm_id, "candidate_id": candidate_id, "batch_id": batches[(firm_id, candidate_id)],
             "legacy": LEGACY, "digest": digest,
             "content": json.dumps(content), "seen": job.discovered_at}).scalar()
        made += 1
    pointed = 0
    for app_id, candidate_id, job_id in conn.execute(text(
            "SELECT a.id, a.candidate_id, a.job_id FROM applications a JOIN jobs j ON j.id = a.job_id")).all():
        conn.execute(text("UPDATE applications SET job_id = :posting WHERE id = :id"),
                     {"posting": copies[(candidate_id, str(job_id))], "id": app_id})
        pointed += 1
    return {"postings copied": made, "batches": len(batches), "applications moved": pointed}


def undo(conn) -> dict:
    """Point applications back at their old jobs and drop the copies, but one a tailored résumé or a cover letter
    names: dropping it would take the résumé with it (its key cascades) and leave the letter without its job. A copy
    kept is still the candidate's job, at 0024 too, and a later move reuses it."""
    added = conn.execute(text(
        "SELECT count(*) FROM applications a JOIN job_postings p ON p.id = a.job_id WHERE p.source <> :legacy"),
        {"legacy": LEGACY}).scalar()
    if added:
        _refuse(f"{added} application(s) are for jobs added since the move, with no old job: delete them first.")
    pointed = conn.execute(text(
        "UPDATE applications a SET job_id = CAST(p.content->>'old_job_id' AS uuid) FROM job_postings p "
        "WHERE p.id = a.job_id AND p.source = :legacy"), {"legacy": LEGACY}).rowcount
    dropped = conn.execute(text(
        "DELETE FROM job_postings p WHERE p.source = :legacy AND p.content ? 'old_job_id' "
        "AND NOT EXISTS (SELECT 1 FROM resumes r WHERE r.job_id = p.id) "
        "AND NOT EXISTS (SELECT 1 FROM cover_letters c WHERE c.job_id = p.id)"), {"legacy": LEGACY}).rowcount
    kept = conn.execute(text("SELECT count(*) FROM job_postings WHERE source = :legacy AND content ? 'old_job_id'"),
                        {"legacy": LEGACY}).scalar()
    batches = conn.execute(text(
        "DELETE FROM scrape_jobs s WHERE s.metadata->>'moved_locally' = 'true' "
        "AND NOT EXISTS (SELECT 1 FROM job_postings p WHERE p.batch_id = s.batch_id)")).rowcount
    return {"applications moved back": pointed, "postings dropped": dropped, "postings kept for documents": kept,
            "batches dropped": batches}


def main(argv=None) -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--dry-run", action="store_true", help="say what it would do; write nothing")
    parser.add_argument("--undo", action="store_true", help="point back at the old jobs and drop the copies")
    args = parser.parse_args(argv)
    if urlparse(DATABASE_URL.replace("postgresql+psycopg2", "postgresql")).hostname not in LOCAL_HOSTS:
        _refuse("this is for a database on this machine only.")
    engine = create_engine(DATABASE_URL)
    with engine.connect() as conn:
        transaction = conn.begin()
        version = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
        if version != "0026":
            transaction.rollback()
            _refuse(f"the database is at {version}; this runs at 0026 (upgrade or downgrade to it first).")
        counts = undo(conn) if args.undo else move(conn)
        if args.dry_run:
            transaction.rollback()
        else:
            transaction.commit()
    print(("Would do: " if args.dry_run else "Done: ") + ", ".join(f"{count} {what}" for what, count in counts.items()))


if __name__ == "__main__":
    main()
