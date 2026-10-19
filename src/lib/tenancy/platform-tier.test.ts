import { describe, expect, it } from "vitest";
import { FIRM_ACTIONS, can } from "@/lib/auth/policy";
import { ROLES, ROUTES, accessFor } from "@/lib/routes/registry";
import type { Principal } from "@/lib/schemas/tenancy";
import { firmOutcome } from "./firm-outcome";
import { platformOutcome } from "./platform-outcome";

/**
 * docs/07 P6: the platform tier's tests in one place — who gets /admin, what a support view may do,
 * and the §2.5 platform-admin rows of the firm layout. (The per-route platform rows of the access table
 * are in registry.test.ts; the mock backend's refusals in src/mocks/write-authorization.test.ts.)
 */

const firmUser = (role: (typeof ROLES)[number]): Principal => ({ kind: "firm", userId: `u_${role}`, firmId: "firm_a", role });
const admin: Principal = { kind: "platform", userId: "padm", role: "PLATFORM_ADMIN", support: null };
const supportOf = (firmId: string): Principal => ({ ...admin, support: { id: "sv", firmId, reason: "Checking a reported issue", startedAt: "2026-10-19T09:00:00.000Z", expiresAt: "2026-10-19T10:00:00.000Z" } });
const READY = { isHydrated: true, isSettling: false };

const firm = (status: "ACTIVE" | "SUSPENDED" | "ONBOARDING") => ({
  id: "firm_a", name: "Firm A", slug: "firm-a", logoUrl: null, primaryTimezone: "Asia/Kolkata", clientTimezone: "America/New_York",
  truthGuardMode: "BALANCED" as const, applicationExpiryDays: 30, status, planId: "plan_starter", seatLimit: 4, candidateLimit: 25, contactPhone: null,
  createdAt: "2026-10-01T00:00:00.000Z",
});

describe("/admin (07 §2.3): only a PLATFORM_ADMIN; everyone else not-found", () => {
  it.each(ROLES)("a %s gets not-found, never Forbidden", (role) => {
    expect(platformOutcome(firmUser(role), READY)).toBe("not-found");
  });

  it("a platform admin gets the admin area, inside a support view too; signed out goes to sign-in; nothing is decided before the session settles", () => {
    expect(platformOutcome(admin, READY)).toBe("open");
    expect(platformOutcome(supportOf("firm_a"), READY)).toBe("open");
    expect(platformOutcome(null, READY)).toBe("sign-in");
    expect(platformOutcome(firmUser("OWNER"), { isHydrated: false, isSettling: false })).toBe("waiting");
    expect(platformOutcome(null, { isHydrated: true, isSettling: true })).toBe("waiting");
  });

  it("the registry agrees: every platform route is none for every firm role and full for a platform admin", () => {
    for (const route of ROUTES.filter((item) => item.area === "platform")) {
      for (const role of ROLES) expect(accessFor(route, firmUser(role)), `${route.id} ${role}`).toBe("none");
      expect(accessFor(route, admin), route.id).toBe("full");
    }
  });
});

describe("a support view grants no actions (07 §4)", () => {
  it.each(FIRM_ACTIONS)("%s: false in a support view, and for a platform admin outside one", (action) => {
    expect(can(supportOf("firm_a"), action)).toBe(false);
    expect(can(admin, action)).toBe(false);
  });

  it("route access inside a view is never more than read", () => {
    for (const route of ROUTES.filter((item) => item.area === "firm")) {
      expect(["read", "none"], route.id).toContain(accessFor(route, supportOf("firm_a")));
    }
  });
});

describe("§2.5 platform-admin rows of the firm layout", () => {
  it("no support view of the firm → the support interstitial (reason required), not a redirect, for every status", () => {
    for (const status of ["ACTIVE", "SUSPENDED", "ONBOARDING"] as const) {
      expect(firmOutcome(admin, { status: "success", firm: firm(status) }), status).toMatchObject({ kind: "support-required" });
      expect(firmOutcome(supportOf("firm_other"), { status: "success", firm: firm(status) }), status).toMatchObject({ kind: "support-required" });
    }
  });

  it("a support view of a SUSPENDED firm renders normally (read-only), like any other status", () => {
    for (const status of ["ACTIVE", "SUSPENDED", "ONBOARDING"] as const) {
      expect(firmOutcome(supportOf("firm_a"), { status: "success", firm: firm(status) }), status).toMatchObject({ kind: "open" });
    }
  });
});
