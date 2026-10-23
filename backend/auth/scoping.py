"""Which firm a request acts for (docs/integration/07-auth-and-tenancy.md F2b, F4).

F2b: every row a request creates on a firm-owned table takes its `firm_id` from the signed-in firm user. Reads
are not filtered yet: the firm-scoping dependency (`firm_scope`) and its lint test come in the next PR.
"""
import uuid

from fastapi import Depends, HTTPException

from backend.api.routes_auth import current_principal
from backend.auth.sessions import Principal


def writer_firm_id(principal: Principal = Depends(current_principal)) -> uuid.UUID:
    """The firm a new row belongs to. FIRM routes already refuse a Super Admin (backend/auth/access.py); this is
    the same answer for any other route that writes firm data. A support view is read-only, so it never writes."""
    if principal.firm_id is None:
        raise HTTPException(status_code=403, detail="A platform admin can't act inside a firm.")
    return principal.firm_id
