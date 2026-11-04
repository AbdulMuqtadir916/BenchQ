"""A candidate's wire shape: the frontend's `CandidateSchema` (src/lib/schemas/candidate.ts) in snake_case, mapped by
src/lib/api/dto/candidates.ts (onboarding module 07). The skills and the summary are the Record's (`claims`) and the
active base résumé's, not the candidate's (migration 0015)."""
from datetime import datetime
from decimal import Decimal

from backend.models.candidates import Candidate


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _number(value: Decimal | None) -> float | None:
    return float(value) if value is not None else None


def candidate_json(c: Candidate) -> dict:
    return {
        "id": str(c.id), "firm_id": str(c.firm_id),
        "manager_id": str(c.manager_id), "bde_id": str(c.bde_id) if c.bde_id else None,
        "full_name": c.full_name, "email": c.email, "phone": c.phone, "linkedin_url": c.linkedin_url,
        "city": c.city, "state": c.state, "country": c.country, "willing_to_relocate": c.willing_to_relocate,
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
