"""Add a small, idempotent set of synthetic jobs for Adna's candidate feed.

Dry-run by default. Apply with:
    python -m backend.scripts.seed_candidate_jobs --apply

This script never resets data, creates a candidate, or pre-creates favorites.
"""
from __future__ import annotations

import argparse
import hashlib
import os
import sys

from sqlalchemy import func

from backend.config import IS_PRODUCTION
from backend.models.candidates import Candidate, CandidateJob
from backend.models.db import Job, SessionLocal
from backend.models.tenancy import Firm, FirmJob, User, link_job_to_firm


FIRM_SLUG = "adnan-staffing"
CANDIDATE_NAME = "Adna Khan"
ASSIGNED_BDE_NAME = "Pan"
FIXTURE_PREFIX = "benchq_demo_adna_"

DEMO_JOBS = (
    {
        "key": "senior-devops-engineer",
        "title": "Senior DevOps Engineer (Demo)",
        "company": "BenchQ Demo Cloud",
        "location": "Hyderabad, Telangana",
        "description": "Synthetic demo posting for the candidate Jobs → Saved workflow. Not a live vacancy.",
    },
    {
        "key": "platform-engineer",
        "title": "Platform Engineer (Demo)",
        "company": "BenchQ Demo Systems",
        "location": "Remote, United States",
        "description": "Synthetic demo posting for the candidate Jobs → Saved workflow. Not a live vacancy.",
    },
    {
        "key": "site-reliability-engineer",
        "title": "Site Reliability Engineer (Demo)",
        "company": "BenchQ Demo Infrastructure",
        "location": "Austin, TX",
        "description": "Synthetic demo posting for the candidate Jobs → Saved workflow. Not a live vacancy.",
    },
    {
        "key": "cloud-infrastructure-engineer",
        "title": "Cloud Infrastructure Engineer (Demo)",
        "company": "BenchQ Demo Nexus",
        "location": "Bengaluru, Karnataka",
        "description": "Synthetic demo posting for the candidate Jobs → Saved workflow. Not a live vacancy.",
    },
    {
        "key": "kubernetes-platform-engineer",
        "title": "Kubernetes Platform Engineer (Demo)",
        "company": "BenchQ Demo Grid",
        "location": "Remote, India",
        "description": "Synthetic demo posting for the candidate Jobs → Saved workflow. Not a live vacancy.",
    },
    {
        "key": "release-automation-engineer",
        "title": "Release Automation Engineer (Demo)",
        "company": "BenchQ Demo Pipelines",
        "location": "Hyderabad, Telangana",
        "description": "Synthetic demo posting for the candidate Jobs → Saved workflow. Not a live vacancy.",
    },
    {
        "key": "observability-engineer",
        "title": "Observability Engineer (Demo)",
        "company": "BenchQ Demo Metrics",
        "location": "Remote, United States",
        "description": "Synthetic demo posting for the candidate Jobs → Saved workflow. Not a live vacancy.",
    },
)


def _external_id(key: str) -> str:
    return hashlib.sha256(f"{FIXTURE_PREFIX}{key}".encode()).hexdigest()


def _resolve_target(db):
    firm = db.query(Firm).filter(Firm.slug == FIRM_SLUG).one_or_none()
    if firm is None:
        raise RuntimeError(f"Expected development firm {FIRM_SLUG!r} was not found")

    candidates = (
        db.query(Candidate)
        .filter(Candidate.firm_id == firm.id, func.lower(Candidate.full_name) == CANDIDATE_NAME.lower())
        .all()
    )
    if len(candidates) != 1:
        raise RuntimeError(f"Expected exactly one {CANDIDATE_NAME!r} candidate in {FIRM_SLUG!r}; found {len(candidates)}")
    candidate = candidates[0]
    bde = db.get(User, candidate.bde_id) if candidate.bde_id else None
    if bde is None or not bde.is_active or bde.firm_id != firm.id or bde.name.casefold() != ASSIGNED_BDE_NAME.casefold():
        raise RuntimeError(f"{CANDIDATE_NAME!r} is not assigned to an active Pan account in {FIRM_SLUG!r}")
    return firm, candidate, bde


def _seed(db, firm, candidate, bde) -> tuple[int, int, int]:
    created_jobs = 0
    linked_firms = 0
    linked_candidates = 0

    for item in DEMO_JOBS:
        external_id = _external_id(item["key"])
        job = db.query(Job).filter(Job.external_id == external_id).one_or_none()
        if job is None:
            job = Job(
                external_id=external_id,
                title=item["title"],
                company=item["company"],
                url=f"https://jobs.example.invalid/benchq-demo/{item['key']}",
                source="manual",
                description=item["description"],
                location=item["location"],
                status="new",
            )
            db.add(job)
            db.flush()
            created_jobs += 1

        # SCRAPED/CAPTURED are the only supported firm-job origins. These are
        # explicitly labeled demo postings, captured by the assigned BDE fixture.
        had_firm_link = db.query(FirmJob.id).filter_by(firm_id=firm.id, job_id=job.id).first() is not None
        link_job_to_firm(db, firm.id, job.id, "CAPTURED", captured_by_user_id=bde.id)
        linked_firms += int(not had_firm_link)

        had_candidate_link = (
            db.query(CandidateJob.id)
            .filter_by(firm_id=firm.id, candidate_id=candidate.id, job_id=job.id)
            .first()
            is not None
        )
        if not had_candidate_link:
            db.add(CandidateJob(firm_id=firm.id, candidate_id=candidate.id, job_id=job.id))
            linked_candidates += 1

    db.flush()
    return created_jobs, linked_firms, linked_candidates


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Seed synthetic jobs for Adna's development candidate feed.")
    parser.add_argument("--apply", action="store_true", help="write the jobs and links; default is a read-only preview")
    args = parser.parse_args(argv)

    if IS_PRODUCTION or os.getenv("BENCHQ_ENV", "development").lower() not in {"development", "dev", "local"}:
        print("Refused: this demo seed only runs in a development/local environment.", file=sys.stderr)
        return 1

    db = SessionLocal()
    try:
        firm, candidate, bde = _resolve_target(db)
        if not args.apply:
            print(f"Preview: up to {len(DEMO_JOBS)} synthetic jobs for {candidate.full_name} at {firm.slug}; no writes made.")
            print("Pass --apply to create missing jobs and links. No favorites will be created.")
            return 0

        jobs, firm_links, candidate_links = _seed(db, firm, candidate, bde)
        db.commit()
        print(f"Seeded: {jobs} jobs, {firm_links} firm links, {candidate_links} candidate links. No favorites created.")
        return 0
    except Exception as error:
        db.rollback()
        print(f"Seed refused: {error}", file=sys.stderr)
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
