"""The Super Admin's read-only support view of a firm (07 §4; 07-auth F3): start and exit. What a view may read,
and that it never writes, is backend/auth/access.py and backend/auth/scoping.py; the rules for a view are
backend/auth/support.py. The frontend's mock is the spec: sessionApi.startSupportView / exitSupportView in
src/mocks/session.ts."""
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session as DbSession

from backend.api.routes_auth import current_principal
from backend.auth import support
from backend.auth.serialize import session_json
from backend.auth.sessions import Principal, principal_for
from backend.models.db import get_db
from backend.models.tenancy import Session

router = APIRouter(prefix="/support-views", tags=["support"])


class StartBody(BaseModel):
    # A string, not a UUID: a malformed id is the same 404 as an unknown one (principle 4).
    firm_id: str = Field(max_length=64)
    reason: str = Field(max_length=2000)


def _session(db: DbSession, principal: Principal) -> dict:
    """The session as it is now, rebuilt from its row (the principal on the request predates the change)."""
    return session_json(db, principal_for(db, db.get(Session, principal.session_id)))


@router.post("", summary="Open a read-only support view of a firm")
def start_support_view(body: StartBody, principal: Principal = Depends(current_principal),
                       db: DbSession = Depends(get_db)):
    """60 minutes, no extension (Q20); any firm status (Q29). Ends the admin's open view first. Logs
    `ADMIN_ACCESS` in the firm's ledger. Returns the session, with `support` set."""
    support.start(db, admin_id=principal.user_id, session_id=principal.session_id, firm_id=body.firm_id,
                  reason=body.reason)
    db.commit()
    return _session(db, principal)


@router.delete("/current", summary="Exit the open support view")
def exit_support_view(principal: Principal = Depends(current_principal), db: DbSession = Depends(get_db)):
    """Logs `ADMIN_ACCESS_END`. `firm_id` is the firm the view was of, for the way back to /admin/firms/[firmId],
    or null when none was open."""
    firm_id = support.exit_view(db, admin_id=principal.user_id, session_id=principal.session_id)
    db.commit()
    return {"session": _session(db, principal), "firm_id": str(firm_id) if firm_id else None}
