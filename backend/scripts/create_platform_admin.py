"""Create a Super Admin: the way to the first account in a new environment, production included (07 Q38).

    python -m backend.scripts.create_platform_admin --email you@example.com --name "Your Name"
    docker compose exec backend python -m backend.scripts.create_platform_admin --email ... --name ...

It asks for the password twice and never takes it as an argument, so it stays out of the shell history and
the process list. `--password-stdin` reads one line from standard input instead, for automation. Every other
account then comes through an invite.
"""
import argparse
import getpass
import sys

from fastapi import HTTPException

from backend.auth.invites import account_exists, normal_email
from backend.auth.passwords import MIN_PASSWORD_LENGTH, hash_password
from backend.models.db import SessionLocal
from backend.models.tenancy import LedgerEntry, PlatformUser


class Refused(Exception):
    pass


def create_platform_admin(db, *, email: str, name: str, password: str) -> PlatformUser:
    try:
        address = normal_email(email)
    except HTTPException:
        raise Refused("Enter a valid email address.")
    name = name.strip()
    if not name:
        raise Refused("Enter a name.")
    if len(password) < MIN_PASSWORD_LENGTH:
        raise Refused(f"Use at least {MIN_PASSWORD_LENGTH} characters for the password.")
    if account_exists(db, address):
        raise Refused(f"{address} already has an account.")
    admin = PlatformUser(name=name, email=address, password_hash=hash_password(password))
    db.add(admin)
    db.flush()
    # A platform event (A13): no firm, and no person did it, so the actor is the system.
    db.add(LedgerEntry(firm_id=None, actor_type="SYSTEM", actor_user_id=None, actor_name="create_platform_admin",
                       entity_type="platform_user", entity_id=str(admin.id), entity_label=name, action="CREATE",
                       summary=f"Created Super Admin {name} ({address}) from the command line"))
    db.commit()
    return admin


def _read_password(from_stdin: bool) -> str:
    if from_stdin:
        return sys.stdin.readline().rstrip("\n")
    first = getpass.getpass("Password: ")
    if getpass.getpass("Password again: ") != first:
        raise Refused("The passwords don't match.")
    return first


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Create a Super Admin (PLATFORM_ADMIN) account.")
    parser.add_argument("--email", required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--password-stdin", action="store_true", help="read the password from standard input")
    args = parser.parse_args(argv)
    db = SessionLocal()
    try:
        admin = create_platform_admin(db, email=args.email, name=args.name,
                                      password=_read_password(args.password_stdin))
        print(f"Created Super Admin {admin.name} <{admin.email}>. Sign in at /sign-in.")
    except Refused as refused:
        print(f"Not created: {refused}", file=sys.stderr)
        return 1
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
