import { describe, expect, it } from "vitest";
import type { Principal } from "@/lib/schemas/tenancy";
import { can, dashboardFor, hasOwnScope, isSupportView, scopeApplications, scopeCandidates, scopeFollowupsUserId, scopeLedger, type FirmAction } from "./permissions";

const firmUser = (role: "OWNER" | "MANAGER" | "BDE" | "VIEWER"): Principal => ({ kind: "firm", userId: `u_${role}`, firmId: "f", role });
const admin: Principal = { kind: "platform", userId: "padm", role: "PLATFORM_ADMIN", support: null };
const support: Principal = { ...admin, support: { id: "sv", firmId: "f", reason: "Checking a report", startedAt: "2026-10-19T09:00:00.000Z", expiresAt: "2026-10-19T10:00:00.000Z" } };

const ACTIONS: FirmAction[] = ["candidate.create", "candidate.edit", "job.capture", "job.apply", "application.move", "resume.edit", "outreach.act", "followup.act"];

describe("can() (07 Phase C slice, Q32)", () => {
  it("OWNER, MANAGER and BDE take every firm action; VIEWER none", () => {
    for (const role of ["OWNER", "MANAGER", "BDE"] as const) for (const action of ACTIONS) expect(can(firmUser(role), action), `${role} ${action}`).toBe(true);
    for (const action of ACTIONS) expect(can(firmUser("VIEWER"), action), action).toBe(false);
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

describe("scope helpers", () => {
  const candidates = [{ id: "c1", assignedUserIds: ["u_BDE"] }, { id: "c2", assignedUserIds: ["other"] }];
  const applications = [{ id: "a1", submittedByUserId: "u_BDE" }, { id: "a2", submittedByUserId: "other" }];

  it("a BDE sees their own; everyone else, a support view included, the whole firm", () => {
    expect(scopeCandidates(firmUser("BDE"), candidates).map((c) => c.id)).toEqual(["c1"]);
    expect(scopeApplications(firmUser("BDE"), applications).map((a) => a.id)).toEqual(["a1"]);
    expect(scopeFollowupsUserId(firmUser("BDE"))).toBe("u_BDE");
    const ledger = [{ id: "l1", actorUserId: "u_BDE" }, { id: "l2", actorUserId: "other" }, { id: "l3", actorUserId: null }];
    expect(scopeLedger(firmUser("BDE"), ledger).map((e) => e.id)).toEqual(["l1"]);
    for (const principal of [firmUser("OWNER"), firmUser("MANAGER"), firmUser("VIEWER"), support]) expect(scopeLedger(principal, ledger)).toHaveLength(3);
    expect(hasOwnScope(firmUser("BDE"))).toBe(true);
    for (const principal of [firmUser("OWNER"), firmUser("MANAGER"), firmUser("VIEWER"), support]) {
      expect(scopeCandidates(principal, candidates)).toHaveLength(2);
      expect(scopeApplications(principal, applications)).toHaveLength(2);
      expect(scopeFollowupsUserId(principal)).toBeUndefined();
      expect(hasOwnScope(principal)).toBe(false);
    }
  });

  it("dashboards: each role its own; a support view the owner's whole-firm view", () => {
    expect(dashboardFor(firmUser("VIEWER"))).toBe("VIEWER");
    expect(dashboardFor(support)).toBe("OWNER");
    expect(isSupportView(support)).toBe(true);
    expect(isSupportView(admin)).toBe(false);
  });
});
