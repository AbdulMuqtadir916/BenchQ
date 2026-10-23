"""A firm for tests that write firm-owned rows directly (F2b).

Every firm-owned row needs a `firm_id` now. Production databases always hold the "Default firm" (migration 0003),
but the tests empty every table before each test, so `default_firm_id` puts it back, with the same fixed ids,
when a test needs it. A signed-in test user's firm reuses that id (auth_support.seed_accounts). Pass the id explicitly (`Resume(firm_id=default_firm_id(db), ...)`): a row with no firm is a
bug the database should keep refusing.
"""
import uuid

from sqlalchemy import text

from backend.models.tenancy import DEFAULT_FIRM_ID, DEFAULT_PLAN_ID


def default_firm_id(db) -> uuid.UUID:
    """The Default firm's id, inserting it (and its plan) the way migration 0003 does when it isn't there. The
    signed-in test firm (auth_support.seed_accounts) has the same id, so these rows are the signed-in user's."""
    from backend.models.tenancy import Firm
    if db.get(Firm, DEFAULT_FIRM_ID) is not None:
        return DEFAULT_FIRM_ID
    db.execute(text("""
        INSERT INTO plans (id, name, seat_limit, candidate_limit) VALUES (:plan, 'Default', 10, 100)
        ON CONFLICT DO NOTHING
    """), {"plan": DEFAULT_PLAN_ID})
    # auth_support.make_plan may already have taken the name "Default"; the firm then sits on that plan.
    plan_id = db.execute(text("SELECT id FROM plans WHERE name = 'Default'")).scalar()
    db.execute(text("""
        INSERT INTO firms (id, name, slug, status, plan_id, seat_limit, candidate_limit)
        VALUES (:firm, 'Default firm', 'default', 'ACTIVE', :plan, 10, 100)
        ON CONFLICT (id) DO NOTHING
    """), {"firm": DEFAULT_FIRM_ID, "plan": plan_id})
    db.flush()
    return DEFAULT_FIRM_ID


def default_firm_writer(db) -> dict:
    """The `firm_id` and `principal` a firm route receives, for a test that calls a route function directly: an
    OWNER of the Default firm. Spread it into the call: `create_manual_job(body, tasks, db=db, **writer)`."""
    from types import SimpleNamespace

    from backend.auth.sessions import Principal
    from backend.models.tenancy import User
    from backend.tests.auth_support import make_user

    firm_id = default_firm_id(db)
    user = db.query(User).filter(User.email == "owner@default.test").first() or make_user(
        db, SimpleNamespace(id=firm_id), email="owner@default.test")
    db.commit()
    principal = Principal(kind="firm", user_id=user.id, session_id=uuid.uuid4(), role="OWNER", firm_id=firm_id,
                          firm_status="ACTIVE")
    return {"firm_id": firm_id, "principal": principal}
