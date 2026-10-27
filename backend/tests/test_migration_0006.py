"""Migration 0006 (docs/candidate-onboarding/06-backend.md PR 1; 07 Q40–Q51): the rules the database itself holds."""
import uuid
from datetime import timedelta

import pytest
from sqlalchemy.exc import IntegrityError

from backend.models.candidates import Candidate, ResumeParse
from backend.models.db import utcnow
from backend.models.tenancy import Firm, Invite, LedgerEntry, User
from backend.tests.auth_support import make_user


@pytest.fixture
def firm(test_db, accounts):
    return test_db.get(Firm, accounts.firm_id)


def _refused(test_db, row, constraint: str) -> None:
    """The insert fails on exactly this constraint, in a savepoint so the rows the test set up stay."""
    with pytest.raises(IntegrityError, match=constraint):
        with test_db.begin_nested():
            test_db.add(row)
            test_db.flush()


def test_only_a_bde_has_a_manager_and_an_older_bde_may_have_none(test_db, firm):
    manager = make_user(test_db, firm, email="m@acme.test", role="MANAGER")
    bde = make_user(test_db, firm, email="b@acme.test", role="BDE")
    assert bde.manager_id is None                              # 07 Q51: allowed, set later by the OWNER
    bde.manager_id = manager.id
    test_db.flush()
    manager.manager_id = bde.id
    with pytest.raises(IntegrityError, match="ck_users_only_bde_has_manager"):
        test_db.flush()
    test_db.rollback()


def test_only_a_bde_invite_names_a_manager(test_db, firm, accounts):
    manager = make_user(test_db, firm, email="m@acme.test", role="MANAGER")
    invite = dict(firm_id=firm.id, email="new@acme.test", invited_by_user_id=accounts.user_id,
                  token_hash="a" * 64, expires_at=utcnow() + timedelta(days=7), manager_id=manager.id)
    _refused(test_db, Invite(role="VIEWER", **invite), "ck_invites_only_bde_has_manager")
    test_db.add(Invite(role="BDE", **invite))
    test_db.flush()


def test_bde_capacity_is_one_to_fifty(test_db, firm):
    assert firm.bde_capacity == 10
    firm.bde_capacity = 0
    with pytest.raises(IntegrityError, match="ck_firms_bde_capacity_range"):
        test_db.flush()
    test_db.rollback()


def test_the_ledger_takes_assign_with_a_note(test_db, firm):
    test_db.add(LedgerEntry(firm_id=firm.id, actor_type="USER", actor_name="Owner", entity_type="candidate",
                            entity_id=str(uuid.uuid4()), entity_label="Ravi", action="ASSIGN",
                            summary="Assigned to Adnan Khan (Fatima Reddy)", note="Push banking clients first."))
    test_db.flush()


def _candidate(firm, manager, **over):
    return Candidate(**{"firm_id": firm.id, "manager_id": manager.id, "created_by_user_id": manager.id,
                        "full_name": "Ravi Teja", "work_auth": "H1B", **over})


def test_a_candidate_keeps_to_the_contract(test_db, firm):
    manager = make_user(test_db, firm, email="m@acme.test", role="MANAGER")
    row = _candidate(firm, manager, employment_types=["C2C", "W2"], work_settings=["REMOTE"], rate_min=70, rate_target=85)
    test_db.add(row)
    test_db.flush()
    assert (row.status, row.bde_id, row.summary_state, row.skills) == ("ON_BENCH", None, "UNVERIFIED", [])
    for bad, constraint in (({"work_auth": "H1-B"}, "ck_candidates_work_auth"), ({"status": "BENCH"}, "ck_candidates_status"),
                            ({"employment_types": ["CONTRACT"]}, "ck_candidates_employment_types"),
                            ({"work_settings": ["ANYWHERE"]}, "ck_candidates_work_settings"),
                            ({"rate_min": 90, "rate_target": 85}, "ck_candidates_floor_not_above_target"),
                            ({"years_experience": 61}, "ck_candidates_years_experience"),
                            ({"summary_state": "VERIFIED"}, "ck_candidates_summary_unverified"),
                            ({"full_name": "  "}, "ck_candidates_full_name_not_blank")):
        _refused(test_db, _candidate(firm, manager, **bad), constraint)


def test_a_parse_is_either_expiring_or_kept_with_its_candidate(test_db, firm):
    manager = make_user(test_db, firm, email="m@acme.test", role="MANAGER")
    parse = dict(firm_id=firm.id, uploaded_by_user_id=manager.id, file_name="r.pdf", mime_type="application/pdf",
                 size_bytes=3, content=b"pdf", parse={})
    _refused(test_db, ResumeParse(expires_at=None, **parse), "ck_resume_parses_kept_or_expiring")   # neither
    test_db.add(ResumeParse(expires_at=utcnow() + timedelta(minutes=60), **parse))
    test_db.flush()
