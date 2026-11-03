"""Who changes a candidate's résumés (07 Q55; docs/team/resume-versioning.md §6): `can_change_resume` and
`can_manage_resume`, the same rule as `canChangeResume` / `canManageResume` (src/lib/auth/permissions.test.ts)."""
import uuid
from types import SimpleNamespace

from backend.auth.policy import can_change_resume, can_manage_resume
from backend.auth.sessions import Principal

_FIRM = uuid.uuid4()
BDE_ID = uuid.uuid4()


def _firm_user(role: str, user_id: uuid.UUID | None = None) -> Principal:
    user_id = user_id or uuid.uuid4()
    return Principal(kind="firm", user_id=user_id, session_id=uuid.uuid4(), role=role, firm_id=_FIRM,
                     firm_status="ACTIVE")


ROLES = {"OWNER": _firm_user("OWNER"), "MANAGER": _firm_user("MANAGER"), "BDE": _firm_user("BDE", BDE_ID),
         "VIEWER": _firm_user("VIEWER")}
ADMIN = Principal(kind="platform", user_id=uuid.uuid4(), session_id=uuid.uuid4(), role="PLATFORM_ADMIN")
SUPPORT = Principal(kind="platform", user_id=uuid.uuid4(), session_id=uuid.uuid4(), role="PLATFORM_ADMIN",
                    support_view_id=uuid.uuid4())
UNASSIGNED = SimpleNamespace(bde_id=None)
THEIRS = SimpleNamespace(bde_id=BDE_ID)
SOMEONE_ELSES = SimpleNamespace(bde_id=uuid.uuid4())


def _row(check, candidate) -> list[bool]:
    return [check(principal, candidate) for principal in ROLES.values()]


def test_before_a_bde_is_assigned_the_owner_and_manager_change_it_and_nobody_manages_it():
    assert _row(can_change_resume, UNASSIGNED) == [True, True, False, False]
    assert _row(can_manage_resume, UNASSIGNED) == [False, False, False, False]


def test_once_a_bde_is_assigned_only_that_bde_changes_and_manages_it():
    assert _row(can_change_resume, THEIRS) == [False, False, True, False]
    assert _row(can_manage_resume, THEIRS) == [False, False, True, False]
    assert _row(can_change_resume, SOMEONE_ELSES) == [False] * 4
    assert _row(can_manage_resume, SOMEONE_ELSES) == [False] * 4


def test_a_platform_admin_and_a_support_view_never():
    for principal in (ADMIN, SUPPORT):
        for candidate in (UNASSIGNED, THEIRS):
            assert not can_change_resume(principal, candidate)
            assert not can_manage_resume(principal, candidate)
