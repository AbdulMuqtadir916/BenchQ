import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Principal } from "@/lib/schemas/tenancy";
import { ALL_ACTIONS, can } from "./policy";

/**
 * The policy table shared with the backend (docs/integration/07-auth-and-tenancy.md F4). The backend has
 * its own copy of the table (backend/auth/policy.py), and backend/tests/test_policy.py compares it with
 * this same file, so a change on one side fails the other side's test until both agree.
 *
 * The file is generated from `can()`: after changing the policy, run
 *   UPDATE_POLICY_TABLE=1 pnpm test src/lib/auth/policy-shared.test.ts
 * then change backend/auth/policy.py to match. It lives under backend/ because the backend container
 * only has that folder.
 */
const FILE = fileURLToPath(new URL("../../../backend/auth/policy_table.json", import.meta.url));

const COLUMNS: Record<string, Principal> = {
  OWNER: { kind: "firm", userId: "u", firmId: "f", role: "OWNER" },
  MANAGER: { kind: "firm", userId: "u", firmId: "f", role: "MANAGER" },
  BDE: { kind: "firm", userId: "u", firmId: "f", role: "BDE" },
  VIEWER: { kind: "firm", userId: "u", firmId: "f", role: "VIEWER" },
  PLATFORM_ADMIN: { kind: "platform", userId: "p", role: "PLATFORM_ADMIN", support: null },
  SUPPORT_VIEW: {
    kind: "platform", userId: "p", role: "PLATFORM_ADMIN",
    support: { id: "sv", firmId: "f", reason: "Checking a reported issue", startedAt: "2026-10-19T09:00:00.000Z", expiresAt: "2026-10-19T10:00:00.000Z" },
  },
};

function tableFromPolicy() {
  const principals = Object.values(COLUMNS);
  return {
    _about: "Generated from src/lib/auth/policy.ts by src/lib/auth/policy-shared.test.ts; do not edit by hand. Y = allowed.",
    columns: Object.keys(COLUMNS),
    actions: Object.fromEntries(
      [...ALL_ACTIONS].sort().map((action) => [action, principals.map((principal) => (can(principal, action) ? "Y" : "-")).join(" ")]),
    ),
  };
}

describe("the policy table shared with the backend", () => {
  it("matches backend/auth/policy_table.json", () => {
    const expected = tableFromPolicy();
    if (process.env.UPDATE_POLICY_TABLE === "1") writeFileSync(FILE, `${JSON.stringify(expected, null, 2)}\n`);
    expect(JSON.parse(readFileSync(FILE, "utf8"))).toEqual(expected);
  });
});
