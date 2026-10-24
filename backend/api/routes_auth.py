"""Sign-in, sign-out and the current session (07-auth F3). The frontend's mock is the spec: src/mocks/auth.ts,
src/mocks/session.ts. Access to each endpoint is set in backend/auth/access.py."""
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session as DbSession

from backend.auth import ledger, support, throttle
from backend.auth.passwords import hash_password, needs_rehash, verify_password
from backend.auth.serialize import session_json
from backend.auth.sessions import (COOKIE_NAME, Principal, clear_cookie_kwargs, cookie_kwargs, end_session,
                                   principal_for, start_session)
from backend.models.db import get_db, utcnow
from backend.models.tenancy import PlatformUser, User

router = APIRouter(prefix="/auth", tags=["auth"])

# The same answer for an unknown email, a wrong password and a deactivated account, so sign-in never tells
# anyone which emails have accounts.
INVALID_CREDENTIALS = "Email or password is incorrect."


class SignInBody(BaseModel):
    # Bounded so a huge body can't make Argon2 work on megabytes.
    email: str = Field(max_length=320)
    password: str = Field(max_length=1024)


def current_principal(request: Request) -> Principal:
    """The signed-in principal the session middleware put on the request. Only routes classified SIGNED_IN,
    FIRM or PLATFORM may depend on this."""
    principal = getattr(request.state, "principal", None)
    if principal is None:
        raise HTTPException(status_code=401, detail="Sign in to continue.")
    return principal


@router.post("/sign-in", summary="Sign in with email and password")
def sign_in(body: SignInBody, request: Request, response: Response, db: DbSession = Depends(get_db)):
    """Sets the session cookie and returns the session. 401 for every failure, 429 when throttled."""
    email = body.email.strip().lower()
    throttle.check(request, email)

    # One email is one account across both tables (migration 0003's trigger), so at most one matches.
    account = (db.query(PlatformUser).filter(PlatformUser.email == email).first()
               or db.query(User).filter(User.email == email).first())
    # The password is checked even when the account is missing or inactive, so every failure takes as long.
    password_ok = verify_password(account.password_hash if account else None, body.password)
    if not password_ok or not account.is_active:
        throttle.record_failure(request, email)
        raise HTTPException(status_code=401, detail=INVALID_CREDENTIALS)
    throttle.clear(request, email)

    if needs_rehash(account.password_hash):
        account.password_hash = hash_password(body.password)
    # Signing in as someone (else) replaces the session this browser had.
    end_session(db, request.cookies.get(COOKIE_NAME))
    token, row = start_session(db, account)
    is_firm_user = isinstance(account, User)
    ledger.record(db, actor=account, action="LOGIN", entity_type="user" if is_firm_user else "platform_user",
                  entity_id=account.id, entity_label=account.name, summary=f"{account.name} signed in",
                  firm_id=account.firm_id if is_firm_user else None)
    db.commit()

    response.set_cookie(value=token, **cookie_kwargs(row.expires_at))
    return session_json(db, principal_for(db, row))


@router.post("/sign-out", status_code=204, summary="Sign out")
def sign_out(request: Request, db: DbSession = Depends(get_db)):
    """Deletes the session and clears the cookie; ends an open support view (logged in the firm's ledger,
    backend/auth/support.py). Answers 204 even when there was no session, so a stale tab can always sign out."""
    end_session(db, request.cookies.get(COOKIE_NAME))
    db.commit()
    response = Response(status_code=204)
    response.delete_cookie(**clear_cookie_kwargs())
    return response


@router.get("/me", summary="The current session")
def me(principal: Principal = Depends(current_principal), db: DbSession = Depends(get_db)):
    """A firm session or a platform session. 401 when signed out (the middleware answers that). Logs the end of any
    support view that ran out: the banner asks here when its 60 minutes are up."""
    support.settle_expired(db)
    db.commit()
    return session_json(db, principal)


@router.post("/first-run-done", summary="Finish the first-run welcome")
def first_run_done(principal: Principal = Depends(current_principal), db: DbSession = Depends(get_db)):
    """The user finished or skipped /welcome: they are active from now on, so they land on the dashboard
    (docs/07 T7). Repeating it changes nothing."""
    user = db.get(User, principal.user_id)
    if user.last_active_at is None:
        user.last_active_at = utcnow()
        db.commit()
    return session_json(db, principal)
