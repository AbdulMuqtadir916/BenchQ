import { describe, expect, it } from "vitest";
import { ROUTES, canOpen } from "@/lib/routes/registry";
import type { Principal } from "@/lib/schemas/tenancy";
import { ALL_ACTIONS, can, type Action } from "./policy";

/**
 * docs/07 Phase C exit: the full principal × action table. This literal table is the spec — change
 * docs/07 first, then this table, then the policy. Columns: OWNER · MANAGER · BDE · VIEWER · platform
 * admin · platform admin in a support view. `Y` = allowed.
 */
const PRINCIPALS: Record<string, Principal> = {
  OWNER: { kind: "firm", userId: "u_owner", firmId: "f", role: "OWNER" },
  MANAGER: { kind: "firm", userId: "u_manager", firmId: "f", role: "MANAGER" },
  BDE: { kind: "firm", userId: "u_bde", firmId: "f", role: "BDE" },
  VIEWER: { kind: "firm", userId: "u_viewer", firmId: "f", role: "VIEWER" },
  ADMIN: { kind: "platform", userId: "padm", role: "PLATFORM_ADMIN", support: null },
  SUPPORT: { kind: "platform", userId: "padm", role: "PLATFORM_ADMIN", support: { id: "sv", firmId: "f", reason: "Checking a reported issue", startedAt: "2026-10-19T09:00:00.000Z", expiresAt: "2026-10-19T10:00:00.000Z" } },
};

//                                   OWNER MANAGER BDE VIEWER ADMIN SUPPORT
const TABLE: ReadonlyArray<readonly [Action, string]> = [
  // firm work
  ["candidate.create", "Y Y - - - -"],   // 07 Q41: a BDE no longer adds candidates
  ["candidate.edit", "Y Y Y - - -"],
  ["job.capture", "Y Y Y - - -"],
  ["job.apply", "Y Y Y - - -"],
  ["application.move", "Y Y Y - - -"],
  ["resume.edit", "Y Y Y - - -"],
  ["outreach.act", "Y Y Y - - -"],
  ["followup.act", "Y Y Y - - -"],
  // team (Q15)
  ["member.invite", "Y - - - - -"],
  ["member.remove", "Y - - - - -"],
  ["member.changeRole", "Y - - - - -"],
  ["member.deactivate", "Y - - - - -"],
  ["member.changeManager", "Y - - - - -"],   // 07 Q40
  ["candidate.assign", "Y Y - - - -"],
  ["firmSettings.edit", "Y - - - - -"],      // 07 Q46
  ["team.view", "Y Y - - - Y"],
  // platform (07 §2.3)
  ["firm.create", "- - - - Y Y"],
  ["firm.edit", "- - - - Y Y"],
  ["firm.suspend", "- - - - Y Y"],
  ["firm.viewWorkspace", "- - - - Y Y"],
  ["plan.edit", "- - - - Y Y"],
  ["invite.resend", "- - - - Y Y"],
  ["invite.revoke", "- - - - Y Y"],
  ["platformTeam.manage", "- - - - Y Y"],
];

describe("principal × action table (docs/07 Phase C)", () => {
  it("covers every action exactly once", () => {
    expect(TABLE.map(([action]) => action).sort()).toEqual([...ALL_ACTIONS].sort());
  });

  it.each(TABLE)("%s: %s", (action, row) => {
    const expected = row.split(" ").map((cell) => cell === "Y");
    const actual = Object.values(PRINCIPALS).map((principal) => can(principal, action));
    expect(actual).toEqual(expected);
  });

  it("route.view is the registry's access table, for every principal and every route", () => {
    for (const principal of Object.values(PRINCIPALS)) {
      for (const route of ROUTES) expect(can(principal, "route.view", route), `${principal.kind} ${route.id}`).toBe(canOpen(route, principal));
    }
  });
});
