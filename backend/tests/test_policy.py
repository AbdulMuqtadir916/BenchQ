"""The backend's permission table (backend/auth/policy.py) agrees with the frontend's, through the shared file
backend/auth/policy_table.json (src/lib/auth/policy-shared.test.ts checks the other side)."""
import json
import pathlib
import uuid

import pytest
from fastapi import HTTPException

from backend.auth.policy import ALL_ACTIONS, can, is_support_view, require
from backend.auth.sessions import Principal

TABLE = json.loads((pathlib.Path(__file__).parents[1] / "auth" / "policy_table.json").read_text())

_ID = uuid.uuid4()
COLUMNS = {
    "OWNER": Principal(kind="firm", user_id=_ID, session_id=_ID, role="OWNER", firm_id=_ID, firm_status="ACTIVE"),
    "MANAGER": Principal(kind="firm", user_id=_ID, session_id=_ID, role="MANAGER", firm_id=_ID, firm_status="ACTIVE"),
    "BDE": Principal(kind="firm", user_id=_ID, session_id=_ID, role="BDE", firm_id=_ID, firm_status="ACTIVE"),
    "VIEWER": Principal(kind="firm", user_id=_ID, session_id=_ID, role="VIEWER", firm_id=_ID, firm_status="ACTIVE"),
    "PLATFORM_ADMIN": Principal(kind="platform", user_id=_ID, session_id=_ID, role="PLATFORM_ADMIN"),
    "SUPPORT_VIEW": Principal(kind="platform", user_id=_ID, session_id=_ID, role="PLATFORM_ADMIN",
                              support_view_id=uuid.uuid4()),
}


def test_the_columns_are_the_ones_this_test_builds():
    assert TABLE["columns"] == list(COLUMNS)


def test_the_actions_are_the_same_on_both_sides():
    assert sorted(TABLE["actions"]) == sorted(ALL_ACTIONS)


@pytest.mark.parametrize("action", sorted(TABLE["actions"]))
def test_each_row_matches_the_shared_table(action):
    actual = " ".join("Y" if can(principal, action) else "-" for principal in COLUMNS.values())
    assert actual == TABLE["actions"][action], f"{action}: columns {TABLE['columns']}"


def test_an_unknown_action_is_an_error_not_a_no():
    with pytest.raises(ValueError):
        can(COLUMNS["OWNER"], "member.inviet")
    with pytest.raises(ValueError):
        require("member.inviet")


def test_is_support_view():
    assert is_support_view(COLUMNS["SUPPORT_VIEW"])
    assert not is_support_view(COLUMNS["PLATFORM_ADMIN"])
    assert not is_support_view(COLUMNS["OWNER"])


def test_require_passes_the_principal_through_when_allowed():
    check = require("member.invite")
    assert check(COLUMNS["OWNER"]) is COLUMNS["OWNER"]


@pytest.mark.parametrize("who", ["MANAGER", "BDE", "VIEWER", "PLATFORM_ADMIN", "SUPPORT_VIEW"])
def test_require_refuses_with_403(who):
    with pytest.raises(HTTPException) as refused:
        require("member.invite")(COLUMNS[who])
    assert refused.value.status_code == 403
