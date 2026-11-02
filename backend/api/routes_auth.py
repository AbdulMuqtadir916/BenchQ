"""Sign-in, sign-out and the current session (07-auth F3). The frontend's mock is the spec: src/mocks/auth.ts,
src/mocks/session.ts. Access to each endpoint is set in backend/auth/access.py."""
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session as DbSession

from backend.auth import ledger, support, throttle
from backend.auth.password_reset import (GENERIC_REQUEST, LINK_EXPIRED, expire_due_for_user, expire_request,
                                         make_reset_link, password_frozen, request_reset, system_entry)
from backend.auth.tokens import hash_token
from backend.auth.passwords import MIN_PASSWORD_LENGTH, hash_password, needs_rehash, verify_password
from backend.auth.serialize import session_json
from backend.auth.sessions import (COOKIE_NAME, Principal, clear_cookie_kwargs, cookie_kwargs, end_all_sessions,
                                   end_session, principal_for, start_session)
from backend.models.db import get_db, utcnow
from backend.models.notifications import Notification, PasswordResetRequest
from backend.models.tenancy import PlatformUser, User

router = APIRouter(prefix="/auth", tags=["auth"])

# The same answer for an unknown email, a wrong password and a deactivated account, so sign-in never tells
# anyone which emails have accounts.
INVALID_CREDENTIALS = "Email or password is incorrect."


class SignInBody(BaseModel):
    # Bounded so a huge body can't make Argon2 work on megabytes.
    email: str = Field(max_length=320)
    password: str = Field(max_length=1024)


class PasswordResetRequestBody(BaseModel):
    email: str = Field(max_length=320)


class PasswordResetCompleteBody(BaseModel):
    # No length rule: a link cut short when pasted gets the same "expired" answer as any other bad link.
    token: str = Field(max_length=1024)
    password: str = Field(min_length=MIN_PASSWORD_LENGTH, max_length=1024)


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
    if isinstance(account, User):
        # Serialize with reset requests so an old password cannot create a session after a request freezes it.
        # populate_existing: the lock must re-read the row, not return the object loaded above. If the hash changed
        # during the Argon2 check, check the password again against the new one: a completed reset replaced it (refuse),
        # or a concurrent sign-in only rehashed the same password (still right).
        verified_hash = account.password_hash
        account = db.query(User).filter(User.id == account.id).with_for_update().populate_existing().first()
        still_valid = account.password_hash == verified_hash or verify_password(account.password_hash, body.password)
        if not account.is_active or not still_valid or password_frozen(db, account):
            db.commit()  # persist expiry cleanup if the request had already timed out
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


@router.post("/password-reset/request", status_code=202, summary="Request an approver-reviewed password reset")
def password_reset_request(body: PasswordResetRequestBody, request: Request, db: DbSession = Depends(get_db)):
    email = body.email.strip().lower()
    throttle.check_password_reset(request, email)
    request_reset(db, email)
    db.commit()
    return {"message": GENERIC_REQUEST}


@router.post("/password-reset/complete", summary="Complete an approved password reset")
def password_reset_complete(body: PasswordResetCompleteBody, db: DbSession = Depends(get_db)):
    token_hash = hash_token(body.token)
    # Find the requester without locking, then lock user -> request, matching sign-in/approval order.
    row = db.query(PasswordResetRequest).filter(PasswordResetRequest.reset_token_hash == token_hash).first()
    now = utcnow()
    if row is None:
        raise HTTPException(status_code=400, detail=LINK_EXPIRED)
    # Hash once a real link is found (an unknown token costs no Argon2), and before the locks, so they aren't held for it.
    new_hash = hash_password(body.password)
    row_id = row.id
    # populate_existing on both locks: each must re-read its row, or a second call with the same token checks the
    # copy loaded above and spends the one-use link twice.
    user = db.query(User).filter(User.id == row.requester_user_id).with_for_update().populate_existing().first()
    if user:
        expire_due_for_user(db, user, now)
    row = (db.query(PasswordResetRequest).filter(PasswordResetRequest.id == row_id).with_for_update()
           .populate_existing().first())
    if (not user or not user.is_active or not row or row.status != "APPROVED"
            or row.reset_token_hash != token_hash or row.reset_token_consumed_at is not None
            or row.reset_token_expires_at is None or row.reset_token_expires_at <= now or row.expires_at <= now):
        if row and row.status == "APPROVED":
            if row.expires_at <= now:
                expire_request(db, row, now)
            elif row.reset_token_hash == token_hash:
                # Link expired; approval still lives until the 24-hour request expires.
                row.reset_token_hash = None
                row.reset_token_expires_at = None
            db.commit()
        raise HTTPException(status_code=400, detail=LINK_EXPIRED)
    if verify_password(user.password_hash, body.password):
        raise HTTPException(status_code=422, detail="Choose a password different from your current password.")
    user.password_hash = new_hash
    end_all_sessions(db, user)     # Q54: every session made before or during the request ends with the old password
    row.status = "COMPLETED"
    row.reset_token_consumed_at = now
    row.reset_token_hash = None
    row.reset_token_expires_at = None
    for notification in db.query(Notification).filter(Notification.type == "PASSWORD_RESET",
        Notification.entity_id == str(row.id), Notification.resolved_at.is_(None)).all():
        notification.resolved_at = now
    system_entry(db, row, user.name, "STATE_CHANGE", f"{user.name} completed an approved password reset")
    db.commit()
    return {"message": "Password reset successfully. You can now sign in."}


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
