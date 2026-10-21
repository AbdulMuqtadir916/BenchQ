"""A firm by its URL slug, for the firm layout (docs/07 §2.5; sessionApi.firmBySlug in src/mocks/session.ts)."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session as DbSession

from backend.api.routes_auth import current_principal
from backend.auth.serialize import firm_json
from backend.auth.sessions import Principal
from backend.models.db import get_db
from backend.models.tenancy import Firm

router = APIRouter(prefix="/firms", tags=["firms"])


@router.get("/by-slug/{slug}", summary="The firm a URL slug names")
def firm_by_slug(slug: str, principal: Principal = Depends(current_principal), db: DbSession = Depends(get_db)):
    """A firm user gets only their own firm: an unknown slug and another firm's slug are the same 404, so a URL
    never confirms that a firm exists (principle 4). A Super Admin knows every firm; reading its data still
    needs a support view."""
    firm = db.query(Firm).filter(Firm.slug == slug).first()
    if firm is None or (not principal.is_platform and firm.id != principal.firm_id):
        raise HTTPException(status_code=404, detail="Not found.")
    return firm_json(firm)
