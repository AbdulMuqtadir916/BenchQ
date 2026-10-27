"""The permission policy (docs/07 Phase C; 07-auth F4): what a signed-in principal may do. The same table as
src/lib/auth/policy.ts. Both are checked against backend/auth/policy_table.json (tests/test_policy.py and
src/lib/auth/policy-shared.test.ts), so the two can't drift.

Which endpoints a principal may reach at all is backend/auth/access.py; this table is the finer check inside
an endpoint, through `require(action)`. Nothing else checks roles.

- Firm users: the role table below: firm work, team management (07 Q15) and team visibility.
- A platform admin: every platform action, no firm action. In a read-only support view (07 §4) still none;
  they only see the whole firm (`team.view`).
"""
from fastapi import Depends, HTTPException

from backend.auth.sessions import Principal

FIRM_ACTIONS = ("candidate.create", "candidate.edit", "job.capture", "job.apply", "application.move", "resume.edit",
                "outreach.act", "followup.act")
TEAM_ACTIONS = ("member.invite", "member.remove", "member.changeRole", "member.deactivate", "member.changeManager",
                "candidate.assign", "firmSettings.edit")
PLATFORM_ACTIONS = ("firm.create", "firm.edit", "firm.suspend", "firm.viewWorkspace", "plan.edit", "invite.resend",
                    "invite.revoke", "platformTeam.manage")
ALL_ACTIONS = FIRM_ACTIONS + TEAM_ACTIONS + ("team.view",) + PLATFORM_ACTIONS

_ALL_ACTING = ("OWNER", "MANAGER", "BDE")
_OWNER_ONLY = ("OWNER",)
_OWNER_AND_MANAGER = ("OWNER", "MANAGER")

# Who in a firm may take each action. VIEWER reads everything it can open and acts on nothing.
_FIRM_TABLE: dict[str, tuple[str, ...]] = {
    "candidate.create": _OWNER_AND_MANAGER,      # 07 Q41: a BDE no longer adds candidates
    "candidate.edit": _ALL_ACTING,
    "job.capture": _ALL_ACTING,
    "job.apply": _ALL_ACTING,
    "application.move": _ALL_ACTING,
    "resume.edit": _ALL_ACTING,
    "outreach.act": _ALL_ACTING,
    "followup.act": _ALL_ACTING,
    "member.invite": _OWNER_ONLY,
    "member.remove": _OWNER_ONLY,
    "member.changeRole": _OWNER_ONLY,
    "member.deactivate": _OWNER_ONLY,
    "member.changeManager": _OWNER_ONLY,          # 07 Q40
    "candidate.assign": _OWNER_AND_MANAGER,
    "firmSettings.edit": _OWNER_ONLY,             # 07 Q46
    "team.view": _OWNER_AND_MANAGER,
}


def can(principal: Principal, action: str) -> bool:
    if action not in ALL_ACTIONS:
        raise ValueError(f"unknown action {action!r}")    # a typo must fail loudly, never deny or allow quietly
    if action in PLATFORM_ACTIONS:
        return principal.is_platform
    if principal.is_platform:
        return principal.support_view_id is not None and action == "team.view"
    return principal.role in _FIRM_TABLE[action]


def is_support_view(principal: Principal) -> bool:
    return principal.is_platform and principal.support_view_id is not None


def require(action: str):
    """A route dependency: 403 unless the signed-in principal may take `action`. Returns the principal.

        @router.post("/members/invites")
        def invite(principal: Principal = Depends(require("member.invite"))): ...
    """
    if action not in ALL_ACTIONS:
        raise ValueError(f"unknown action {action!r}")    # at import time, not on the first request

    from backend.api.routes_auth import current_principal

    def _check(principal: Principal = Depends(current_principal)) -> Principal:
        if not can(principal, action):
            raise HTTPException(status_code=403, detail="You don't have permission to do that.")
        return principal

    return _check
