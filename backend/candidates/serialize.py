"""A candidate's wire shape: the frontend's `CandidateSchema` (src/lib/schemas/candidate.ts) in snake_case, mapped by
src/lib/api/dto/candidates.ts (onboarding module 07). The skills and the summary are the active base
résumé's, not the candidate's (migration 0015); so are the name, contact details and location (07 Q57, migration 0017:
read from the active base's newest version through the `Candidate` properties).

A résumé's text isn't checked like the old columns were, so: no name reads as "", no country is invented (none reads as
none; the old column's "US" default is gone, Abdul's PR 7 review #5), and an email that isn't one reads as none (the frontend's schema requires a valid one)."""
import re
from datetime import datetime
from decimal import Decimal

from backend.models.candidates import Candidate


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _number(value: Decimal | None) -> float | None:
    return float(value) if value is not None else None


_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def candidate_json(c: Candidate) -> dict:
    email = (c.email or "").strip().lower()
    return {
        "id": str(c.id), "firm_id": str(c.firm_id),
        "manager_id": str(c.manager_id), "bde_id": str(c.bde_id) if c.bde_id else None,
        "full_name": c.full_name or "", "email": email if _EMAIL.match(email) else None, "phone": c.phone,
        "linkedin_url": c.linkedin_url, "city": c.city, "state": c.state, "country": c.country, "willing_to_relocate": c.willing_to_relocate,
        "work_auth": c.work_auth, "work_auth_expiry": _iso(c.work_auth_expiry),
        "needs_sponsorship": c.needs_sponsorship, "needs_transfer": c.needs_transfer,
        "employment_types": list(c.employment_types or []),
        "rate_min": _number(c.rate_min), "rate_target": _number(c.rate_target),
        "status": c.status, "bench_start_date": _iso(c.bench_start_date), "available_from": _iso(c.available_from),
        "notice_period_days": c.notice_period_days, "years_experience": _number(c.years_experience),
        "primary_role": c.primary_role, "target_roles": list(c.target_roles or []),
        "work_settings": list(c.work_settings or []), "preferred_locations": list(c.preferred_locations or []),
        "contact_notes": c.contact_notes, "preferred_industries": list(c.preferred_industries or []),
        "deal_breakers": list(c.deal_breakers or []), "qa_bank": c.qa_bank or [],
        "created_at": _iso(c.created_at), "updated_at": _iso(c.updated_at),
    }
