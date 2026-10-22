"""Set a new password for any account, firm user or Super Admin: BenchQ staff's way back in for someone who
lost theirs, until a self-service reset exists (it needs email; 07 Q39).

    python -m backend.scripts.reset_password --email someone@example.com
    docker compose exec backend python -m backend.scripts.reset_password --email ...

Like create_platform_admin it asks for the password twice and never takes it as an argument;
`--password-stdin` reads one line instead. The account is signed out everywhere, and the reset is logged
(never the password).
"""
import argparse
import getpass
import sys

from fastapi import HTTPException

from backend.auth.invites import normal_email
from backend.auth.passwords import MIN_PASSWORD_LENGTH, hash_password
from backend.auth.sessions import end_all_sessions
from backend.models.db import SessionLocal
from backend.models.tenancy import LedgerEntry, PlatformUser, User


class Refused(Exception):
    pass


def reset_password(db, *, email: str, password: str) -> User | PlatformUser:
    try:
        address = normal_email(email)
    except HTTPException:
        raise Refused("Enter a valid email address.")
    if len(password) < MIN_PASSWORD_LENGTH:
        raise Refused(f"Use at least {MIN_PASSWORD_LENGTH} characters for the password.")
    account = (db.query(User).filter(User.email == address).first()
               or db.query(PlatformUser).filter(PlatformUser.email == address).first())
    if account is None:
        raise Refused(f"No account uses {address}.")
    account.password_hash = hash_password(password)
    end_all_sessions(db, account)
    is_firm_user = isinstance(account, User)
    # In the firm's own ledger for a firm user, so the OWNER sees it; a platform event for a Super Admin (A13).
    db.add(LedgerEntry(firm_id=account.firm_id if is_firm_user else None, actor_type="SYSTEM", actor_user_id=None,
                       actor_name="reset_password", entity_type="user" if is_firm_user else "platform_user",
                       entity_id=str(account.id), entity_label=account.name, action="UPDATE",
                       summary=f"Reset the password of {account.name} ({address}) from the command line"))
    db.commit()
    return account


def _read_password(from_stdin: bool) -> str:
    if from_stdin:
        return sys.stdin.readline().rstrip("\n")
    first = getpass.getpass("New password: ")
    if getpass.getpass("New password again: ") != first:
        raise Refused("The passwords don't match.")
    return first


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Set a new password for an account (signs it out everywhere).")
    parser.add_argument("--email", required=True)
    parser.add_argument("--password-stdin", action="store_true", help="read the password from standard input")
    args = parser.parse_args(argv)
    db = SessionLocal()
    try:
        account = reset_password(db, email=args.email, password=_read_password(args.password_stdin))
        print(f"New password set for {account.name} <{account.email}>. They were signed out everywhere.")
    except Refused as refused:
        print(f"Not changed: {refused}", file=sys.stderr)
        return 1
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
