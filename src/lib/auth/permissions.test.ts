import { describe, expect, it } from "vitest";
import type { Principal } from "@/lib/schemas/tenancy";
import { can, canAssignTo, dashboardFor, hasOwnScope, hasTeamScope, isSupportView, scopeApplications, scopeByCandidate, scopeCandidates, scopeFollowups, scopeFollowupsUserId, scopeLedger, scopeOf, scopeTeam, type FirmAction } from "./permissions";

const firmUser = (role: "OWNER" | "MANAGER" | "BDE" | "VIEWER"): Principal => ({ kind: "firm", userId: `u_${role}`, firmId: "f", role });
const admin: Principal = { kind: "platform", userId: "padm", role: "PLATFORM_ADMIN", support: null };
const support: Principal = { ...admin, support: { id: "sv", firmId: "f", reason: "Checking a report", startedAt: "2026-10-19T09:00:00.000Z", expiresAt: "2026-10-19T10:00:00.000Z" } };

const ACTIONS: FirmAction[] = ["candidate.create", "candidate.edit", "job.capture", "job.apply", "application.move", "resume.edit", "outreach.act", "followup.act"];

describe("can() (07 Phase C slice, Q32)", () => {
  it("OWNER and MANAGER take every firm action; a BDE every one but adding a candidate (07 Q41); VIEWER none", () => {
    for (const role of ["OWNER", "MANAGER"] as const) for (const action of ACTIONS) expect(can(firmUser(role), action), `${role} ${action}`).toBe(true);
    for (const action of ACTIONS) expect(can(firmUser("BDE"), action), action).toBe(action !== "candidate.create");
    for (const action of ACTIONS) expect(can(firmUser("VIEWER"), action), action).toBe(false);
  });

  it("only the OWNER changes a BDE's manager or the firm's settings (07 Q40, Q46)", () => {
    for (const action of ["member.changeManager", "firmSettings.edit"] as const) {
      expect(["OWNER", "MANAGER", "BDE", "VIEWER"].map((role) => can(firmUser(role as "OWNER"), action)), action).toEqual([true, false, false, false]);
      expect(can(support, action), action).toBe(false);
    }
  });

  it("a support view takes no action at all (07 §4); a platform admin outside one has no firm actions either", () => {
    for (const action of ACTIONS) {
      expect(can(support, action), action).toBe(false);
      expect(can(admin, action), action).toBe(false);
    }
  });

  it("team.view: OWNER and MANAGER (Q15), and a support view (it reads the whole firm); not BDE or VIEWER", () => {
    expect(["OWNER", "MANAGER", "BDE", "VIEWER"].map((role) => can(firmUser(role as "OWNER"), "team.view"))).toEqual([true, true, false, false]);
    expect(can(support, "team.view")).toBe(true);
    expect(can(admin, "team.view")).toBe(false);
  });
});

describe("scope helpers (07 §2.2, Q47)", () => {
  // Two teams: u_MANAGER manages c1 (BDE u_BDE) and c3 (no BDE yet); m2 manages c2 (BDE b2).
  const users = [
    { id: "u_MANAGER", role: "MANAGER" as const, managerId: null },
    { id: "m2", role: "MANAGER" as const, managerId: null },
    { id: "u_BDE", role: "BDE" as const, managerId: "u_MANAGER" },
    { id: "b2", role: "BDE" as const, managerId: "m2" },
    { id: "u_OWNER", role: "OWNER" as const, managerId: null },
  ];
  const candidates = [
    { id: "c1", managerId: "u_MANAGER", bdeId: "u_BDE" },
    { id: "c2", managerId: "m2", bdeId: "b2" },
    { id: "c3", managerId: "u_MANAGER", bdeId: null },
  ];
  const context = { users, candidates };
  const applications = [
    { id: "a1", submittedByUserId: "u_BDE", candidateId: "c1" },
    { id: "a2", submittedByUserId: "b2", candidateId: "c2" },
    { id: "a3", submittedByUserId: "b2", candidateId: "c1" }, // c1 moved from b2's team: its history moves with it (Q43)
  ];
  const ledger = [
    { id: "l1", actorUserId: "u_BDE", entityType: "application", entityId: "a1", action: "UPDATE" },
    { id: "l2", actorUserId: "b2", entityType: "application", entityId: "a2", action: "UPDATE" },
    { id: "l3", actorUserId: null, entityType: "firm", entityId: "f", action: "UPDATE" },
    { id: "l4", actorUserId: "u_OWNER", entityType: "candidate", entityId: "c3", action: "UPDATE" },
  ];
  const followups = [{ id: "f1", assignedToUserId: "u_BDE" }, { id: "f2", assignedToUserId: "b2" }];
  const ids = (rows: readonly { id: string }[]) => rows.map((row) => row.id);

  it("a BDE sees their own", () => {
    const bde = firmUser("BDE");
    expect(scopeOf(bde)).toEqual({ kind: "own", userId: "u_BDE" });
    expect(ids(scopeCandidates(bde, candidates))).toEqual(["c1"]);
    // BDE scope follows the candidate's current assignment, not the historical submitter.
    expect(ids(scopeApplications(bde, applications, candidates))).toEqual(["a1", "a3"]);
    expect(ids(scopeLedger(bde, ledger, context))).toEqual(["l1"]);
    // 07 Q52: plus who assigned them the candidates they work now; not other entries about them, nor others' candidates.
    const assigns = [
      { id: "l5", actorUserId: "u_MANAGER", entityType: "candidate", entityId: "c1", action: "ASSIGN" },
      { id: "l6", actorUserId: "u_MANAGER", entityType: "candidate", entityId: "c1", action: "UPDATE" },
      { id: "l7", actorUserId: "u_MANAGER", entityType: "candidate", entityId: "c2", action: "ASSIGN" },
    ];
    expect(ids(scopeLedger(bde, [...ledger, ...assigns], context))).toEqual(["l1", "l5"]);
    expect(ids(scopeFollowups(bde, followups, context))).toEqual(["f1"]);
    expect(scopeFollowupsUserId(bde)).toBe("u_BDE");
    expect(hasOwnScope(bde)).toBe(true);
  });

  it("a MANAGER sees their team: the candidates they manage, their queue, their BDEs' work, never the other team's", () => {
    const manager = firmUser("MANAGER");
    expect(scopeOf(manager)).toEqual({ kind: "team", managerId: "u_MANAGER" });
    expect(ids(scopeCandidates(manager, candidates))).toEqual(["c1", "c3"]);
    expect(ids(scopeApplications(manager, applications, candidates))).toEqual(["a1", "a3"]);
    expect(ids(scopeByCandidate(manager, [{ id: "r1", candidateId: "c1" }, { id: "r2", candidateId: "c2" }], candidates))).toEqual(["r1"]);
    expect(ids(scopeLedger(manager, ledger, context))).toEqual(["l1", "l4"]);
    expect(ids(scopeFollowups(manager, followups, context))).toEqual(["f1"]);
    expect(ids(scopeTeam(manager, users, candidates))).toEqual(["u_MANAGER", "u_BDE"]);
    expect(scopeFollowupsUserId(manager)).toBeUndefined();
    expect([hasTeamScope(manager), hasOwnScope(manager)]).toEqual([true, false]);
  });

  it("a MANAGER's team includes the BDE of a candidate they manage even when the team list has no managerId yet", () => {
    const withoutManagers = users.map((user) => ({ ...user, managerId: null }));
    expect(ids(scopeTeam(firmUser("MANAGER"), withoutManagers, candidates))).toEqual(["u_MANAGER", "u_BDE"]);
  });

  it("the OWNER, a VIEWER and a support view see the whole firm", () => {
    for (const principal of [firmUser("OWNER"), firmUser("VIEWER"), support]) {
      expect(scopeOf(principal)).toEqual({ kind: "firm" });
      expect(scopeCandidates(principal, candidates)).toHaveLength(3);
      expect(scopeApplications(principal, applications, candidates)).toHaveLength(3);
      expect(scopeLedger(principal, ledger, context)).toHaveLength(4);
      expect(scopeFollowups(principal, followups, context)).toHaveLength(2);
      expect(scopeTeam(principal, users, candidates)).toHaveLength(5);
      expect(scopeFollowupsUserId(principal)).toBeUndefined();
      expect([hasOwnScope(principal), hasTeamScope(principal)]).toEqual([false, false]);
    }
  });
});

describe("canAssignTo (07 Q41, Q43)", () => {
  const team = [
    { id: "u_MANAGER", role: "MANAGER" as const, managerId: null, isActive: true },
    { id: "m2", role: "MANAGER" as const, managerId: null, isActive: true },
    { id: "m_gone", role: "MANAGER" as const, managerId: null, isActive: false },
    { id: "u_BDE", role: "BDE" as const, managerId: "u_MANAGER", isActive: true },
    { id: "b2", role: "BDE" as const, managerId: "m2", isActive: true },
    { id: "b_gone", role: "BDE" as const, managerId: "u_MANAGER", isActive: false },
    { id: "b_none", role: "BDE" as const, managerId: null, isActive: true },
  ];
  const owner = firmUser("OWNER");
  const manager = firmUser("MANAGER");

  it("the OWNER: any active manager, alone or with one of that manager's active BDEs", () => {
    expect(canAssignTo(owner, null, { managerId: "m2", bdeId: null }, team)).toBe(true);
    expect(canAssignTo(owner, null, { managerId: "m2", bdeId: "b2" }, team)).toBe(true);
    expect(canAssignTo(owner, { managerId: "u_MANAGER" }, { managerId: "m2", bdeId: null }, team)).toBe(true); // across teams
    expect(canAssignTo(owner, null, { managerId: "m2", bdeId: "u_BDE" }, team)).toBe(false); // another manager's BDE
    expect(canAssignTo(owner, null, { managerId: "u_BDE", bdeId: null }, team)).toBe(false); // not a manager
    expect(canAssignTo(owner, null, { managerId: "m_gone", bdeId: null }, team)).toBe(false);
    expect(canAssignTo(owner, null, { managerId: "u_MANAGER", bdeId: "b_gone" }, team)).toBe(false);
    expect(canAssignTo(owner, null, { managerId: "u_MANAGER", bdeId: "b_none" }, team)).toBe(false); // no manager yet (Q51)
  });

  it("a MANAGER: only their own team, a BDE required when creating, never another team's candidate", () => {
    expect(canAssignTo(manager, null, { managerId: "u_MANAGER", bdeId: "u_BDE" }, team)).toBe(true);
    expect(canAssignTo(manager, null, { managerId: "u_MANAGER", bdeId: null }, team)).toBe(false);
    expect(canAssignTo(manager, { managerId: "u_MANAGER" }, { managerId: "u_MANAGER", bdeId: "u_BDE" }, team)).toBe(true);
    expect(canAssignTo(manager, { managerId: "u_MANAGER" }, { managerId: "u_MANAGER", bdeId: null }, team)).toBe(true); // back to their queue
    expect(canAssignTo(manager, { managerId: "u_MANAGER" }, { managerId: "m2", bdeId: "b2" }, team)).toBe(false);
    expect(canAssignTo(manager, { managerId: "m2" }, { managerId: "u_MANAGER", bdeId: "u_BDE" }, team)).toBe(false);
  });

  it("a BDE, a VIEWER and a support view never", () => {
    for (const principal of [firmUser("BDE"), firmUser("VIEWER"), support, admin]) {
      expect(canAssignTo(principal, null, { managerId: "u_MANAGER", bdeId: "u_BDE" }, team)).toBe(false);
    }
  });
});

describe("dashboards", () => {
  it("dashboards: each role its own; a support view the owner's whole-firm view", () => {
    expect(dashboardFor(firmUser("VIEWER"))).toBe("VIEWER");
    expect(dashboardFor(support)).toBe("OWNER");
    expect(isSupportView(support)).toBe(true);
    expect(isSupportView(admin)).toBe(false);
  });
});
