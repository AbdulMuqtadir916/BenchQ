"""Load the frontend mocks' world into the database, outside production only (07-auth F5, 07 Q38).

    python -m backend.scripts.seed_demo            # add what's missing; running it twice changes nothing
    python -m backend.scripts.seed_demo --reset    # delete the demo rows (and their sessions and ledger), reseed
    docker compose exec backend python -m backend.scripts.seed_demo

It reads the same JSON the mocks use (src/mocks/data/*.json; docker-compose mounts it read-only), never a
copy, so the two can't drift. Today: the plans, the four firms, their users, the Super Admin and the invites.
Each module's data joins as its track lands. Every seeded account signs in with the one demo password
(docs/03 §3.2).

- Ids: UUIDv5 of each fixture id in one fixed namespace, so a seeded row has the same id on every machine.
- Invite dates are shifted the way the mocks shift them (FIXTURE_NOW becomes now), so a pending invite stays
  pending. A seeded invite's link is unknown (only hashes are stored): resend it to get one.
"""
import argparse
from datetime import datetime, timedelta
import json
import os
import pathlib
import sys
import uuid

from sqlalchemy import or_

from backend.auth.passwords import hash_password
from backend.auth.tokens import hash_token, new_token
from backend.config import IS_PRODUCTION
from backend.models.db import SessionLocal, utcnow
from backend.models.candidates import Candidate, ResumeParse
from backend.models.tenancy import Firm, Invite, LedgerEntry, Plan, PlatformUser, Session, User

DEMO_PASSWORD = "benchq-demo-2026"                                     # docs/03 §3.2
NAMESPACE = uuid.UUID("6f1d4c2e-0b7a-5e3c-9a41-b3c0e5d2a7f8")           # fixed: changing it re-ids every demo row
FIXTURE_NOW = datetime.fromisoformat("2026-10-18T12:00:00+00:00")       # FIXTURE_NOW in src/mocks/tenancy.ts
DATA_DIR = pathlib.Path(os.getenv("BENCHQ_MOCK_DATA", pathlib.Path(__file__).resolve().parents[2] / "src/mocks/data"))


class Refused(Exception):
    pass


def demo_id(fixture_id: str) -> uuid.UUID:
    return uuid.uuid5(NAMESPACE, fixture_id)


def _load(name: str):
    path = DATA_DIR / name
    if not path.exists():
        raise Refused(f"{path} not found: run from a checkout of the repo, or set BENCHQ_MOCK_DATA")
    return json.loads(path.read_text())


def _when(iso: str | None) -> datetime | None:
    return datetime.fromisoformat(iso.replace("Z", "+00:00")) if iso else None


def _shift(iso: str, now: datetime) -> datetime:
    return _when(iso) + (now - FIXTURE_NOW)


def _add_missing(db, model, row_id: uuid.UUID, **fields) -> bool:
    if db.get(model, row_id) is not None:
        return False
    db.add(model(id=row_id, **fields))
    db.flush()
    return True


def reset(db) -> None:
    """Delete the demo rows and what hangs off them (their sessions and ledger entries), children first."""
    fixture_ids = _fixture_ids()
    firm_ids, user_ids = fixture_ids["firms"], fixture_ids["users"] + fixture_ids["platform_users"]
    db.query(Session).filter(or_(Session.user_id.in_(user_ids), Session.platform_user_id.in_(user_ids))) \
        .delete(synchronize_session=False)
    db.query(LedgerEntry).filter(or_(LedgerEntry.firm_id.in_(firm_ids), LedgerEntry.actor_user_id.in_(user_ids))) \
        .delete(synchronize_session=False)
    db.query(ResumeParse).filter(ResumeParse.firm_id.in_(firm_ids)).delete(synchronize_session=False)
    db.query(Candidate).filter(Candidate.firm_id.in_(firm_ids)).delete(synchronize_session=False)
    db.query(Invite).filter(or_(Invite.id.in_(fixture_ids["invites"]), Invite.firm_id.in_(firm_ids))) \
        .delete(synchronize_session=False)
    # A BDE points at their manager (ON DELETE RESTRICT, checked row by row), so the links go before the users.
    db.query(User).filter(User.firm_id.in_(firm_ids)).update({User.manager_id: None}, synchronize_session=False)
    db.query(User).filter(User.firm_id.in_(firm_ids)).delete(synchronize_session=False)
    db.query(PlatformUser).filter(PlatformUser.id.in_(fixture_ids["platform_users"])).delete(synchronize_session=False)
    db.query(Firm).filter(Firm.id.in_(firm_ids)).delete(synchronize_session=False)
    db.query(Plan).filter(Plan.id.in_(fixture_ids["plans"])).delete(synchronize_session=False)
    db.flush()


def _sync_hierarchy(db, firm_data: dict) -> None:
    """Demo rows seeded before the hierarchy (07 Q40) get the fixtures' managers and BDE capacity. Only empty or
    default values are filled, so a manager changed in the app since stays as it is."""
    for f in firm_data["firms"]:
        firm = db.get(Firm, demo_id(f["id"]))
        if firm is not None and firm.bde_capacity == 10 and f.get("bdeCapacity", 10) != 10:
            firm.bde_capacity = f["bdeCapacity"]
    for u in firm_data["users"]:
        user = db.get(User, demo_id(u["id"]))
        if user is not None and user.manager_id is None and u.get("managerId"):
            user.manager_id = demo_id(u["managerId"])
    for i in _load("invites.json"):
        invite = db.get(Invite, demo_id(i["id"]))
        if invite is not None and invite.manager_id is None and i.get("managerId"):
            invite.manager_id = demo_id(i["managerId"])
    db.flush()


def _fixture_ids() -> dict[str, list[uuid.UUID]]:
    firm = _load("firm.json")
    return {
        "plans": [demo_id(p["id"]) for p in _load("plans.json")],
        "firms": [demo_id(f["id"]) for f in firm["firms"]],
        "users": [demo_id(u["id"]) for u in firm["users"]],
        "platform_users": [demo_id(p["id"]) for p in _load("platform-users.json")],
        "invites": [demo_id(i["id"]) for i in _load("invites.json")],
    }


def seed(db, now: datetime | None = None) -> dict[str, int]:
    """Add every demo row that isn't there yet. Returns how many of each were added."""
    now = now or utcnow()
    password_hash = hash_password(DEMO_PASSWORD)
    firm_data = _load("firm.json")
    added = {"plans": 0, "firms": 0, "users": 0, "platform_users": 0, "invites": 0}

    for p in _load("plans.json"):
        added["plans"] += _add_missing(db, Plan, demo_id(p["id"]), name=p["name"], seat_limit=p["seatLimit"],
                                       candidate_limit=p["candidateLimit"], features=p["features"],
                                       is_active=p["isActive"])
    for f in firm_data["firms"]:
        added["firms"] += _add_missing(
            db, Firm, demo_id(f["id"]), name=f["name"], slug=f["slug"], status=f["status"],
            plan_id=demo_id(f["planId"]), seat_limit=f["seatLimit"], candidate_limit=f["candidateLimit"],
            contact_phone=f["contactPhone"], logo_url=f["logoUrl"], primary_timezone=f["primaryTimezone"],
            client_timezone=f["clientTimezone"], truth_guard_mode=f["truthGuardMode"],
            application_expiry_days=f["applicationExpiryDays"], bde_capacity=f.get("bdeCapacity", 10),
            created_at=_when(f["createdAt"]))
    # Managers before the BDEs who point at them (07 Q40).
    for u in sorted(firm_data["users"], key=lambda user: user.get("managerId") is not None):
        added["users"] += _add_missing(
            db, User, demo_id(u["id"]), firm_id=demo_id(u["firmId"]), role=u["role"], name=u["name"],
            manager_id=demo_id(u["managerId"]) if u.get("managerId") else None,
            email=u["email"].lower(), password_hash=password_hash, avatar_url=u["avatarUrl"], is_active=u["isActive"],
            last_active_at=_when(u["lastActiveAt"]))
    _sync_hierarchy(db, firm_data)
    for a in _load("platform-users.json"):
        added["platform_users"] += _add_missing(
            db, PlatformUser, demo_id(a["id"]), name=a["name"], email=a["email"].lower(),
            password_hash=password_hash, is_active=a["isActive"], last_active_at=_when(a["lastActiveAt"]))

    platform_ids = {p["id"] for p in _load("platform-users.json")}
    for i in _load("invites.json"):
        created = _shift(i["createdAt"], now)
        by_platform = i["invitedByUserId"] in platform_ids
        added["invites"] += _add_missing(
            db, Invite, demo_id(i["id"]), firm_id=demo_id(i["firmId"]) if i["firmId"] else None,
            email=i["email"].lower(), invitee_name=i["inviteeName"], role=i["role"], status=i["status"],
            invited_by_user_id=None if by_platform else demo_id(i["invitedByUserId"]),
            invited_by_platform_user_id=demo_id(i["invitedByUserId"]) if by_platform else None,
            manager_id=demo_id(i["managerId"]) if i.get("managerId") else None,
            token_hash=hash_token(new_token()), expires_at=_shift(i["expiresAt"], now), created_at=created,
            accepted_at=created + timedelta(hours=1) if i["status"] == "ACCEPTED" else None,
            revoked_at=created + timedelta(hours=1) if i["status"] == "REVOKED" else None)
    return added


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Load the frontend mocks' demo data (outside production only).")
    parser.add_argument("--reset", action="store_true", help="delete the demo rows first, then seed")
    args = parser.parse_args(argv)
    if IS_PRODUCTION:
        print("Not seeded: BENCHQ_ENV is production. The demo data never goes into production.", file=sys.stderr)
        return 1
    db = SessionLocal()
    try:
        if args.reset:
            reset(db)
        added = seed(db)
        db.commit()
    except Refused as refused:
        print(f"Not seeded: {refused}", file=sys.stderr)
        return 1
    finally:
        db.close()
    print("Seeded: " + ", ".join(f"{n} {what}" for what, n in added.items())
          + f". Sign in with any account in docs/03 §3.2 and the password {DEMO_PASSWORD}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
