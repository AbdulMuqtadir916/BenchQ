import { describe, expect, it } from "vitest";
import { allCandidates } from "@/mocks/candidates";
import { allUsers, firms } from "@/mocks/team";
import { FIXTURE_NOW, invitesAt } from "@/mocks/tenancy";
import type { LedgerEntry } from "@/lib/schemas/analytics";
import {
  firmsByStatus, firmsOnPlan, hasCustomLimits, lastActivityAt, needsAttention, openSupportViews, ownerStatus, planHistory, seatBlockReason, seatTotals, slugProblem, suggestSlug,
} from "./platform";

const NOW = FIXTURE_NOW;
const DAY = 86_400_000;
const later = (days: number) => new Date(NOW.getTime() + days * DAY);

const entry = (over: Partial<LedgerEntry>): LedgerEntry => ({
  id: "e", firmId: "firm_stl", actorUserId: "padm_sana", actorType: "PLATFORM_ADMIN", actorName: "Sana Mirza", entityType: "firm", entityId: "firm_stl",
  entityLabel: "STL", action: "PLAN_CHANGED", summary: "", modelId: null, promptVersion: null, evidenceIds: [], claimState: null, createdAt: NOW.toISOString(), ...over,
});

/** What the backend's ledger holds for a firm that was created, moved to a smaller plan and then suspended. */
const cbwLedger = [
  entry({ id: "l1", firmId: "firm_cbw", entityId: "firm_cbw", action: "FIRM_CREATED", summary: "Created firm on Growth (10 seats, 100 candidates)", createdAt: later(-60).toISOString() }),
  entry({ id: "l2", firmId: "firm_cbw", entityId: "firm_cbw", action: "PLAN_CHANGED", summary: "Growth → Starter, seats 10 → 4, candidates 100 → 25", createdAt: later(-45).toISOString() }),
  entry({ id: "l3", firmId: "firm_cbw", entityId: "firm_cbw", action: "FIRM_SUSPENDED", summary: "Suspended: account on hold pending contract renewal", createdAt: later(-20).toISOString() }),
];
const data = { firms, users: allUsers, invites: invitesAt(NOW), candidates: allCandidates, ledger: cbwLedger };

describe("overview numbers (docs/04 §14.2), from the fixtures", () => {
  it("counts firms by status", () => {
    expect(firmsByStatus(firms)).toEqual({ ACTIVE: 2, ONBOARDING: 1, SUSPENDED: 1 });
  });

  it("sums seats over ACTIVE firms only (HTS 7 of 10 + STL 4 of 4); active users over every firm", () => {
    expect(seatTotals(data, NOW)).toEqual({ seatsUsed: 11, seatLimit: 14, activeUsers: allUsers.filter((user) => user.isActive).length });
  });

  it("needs attention: CBW over its seat limit by 2; nothing for GSC until its onboarding is 7 days old", () => {
    expect(needsAttention(data, NOW).map((item) => [item.kind, item.firm.id])).toEqual([["over-limit", "firm_cbw"]]);
    const overLimit = needsAttention(data, NOW)[0]!;
    expect(overLimit).toMatchObject({ limit: "seats", used: 6, allowed: 4 });
  });

  it("needs attention: an expired owner invite once it lapses; a stalled onboarding at 7 days if it was resent and is still pending", () => {
    // GSC was created 2026-10-15T10:00Z with its owner invite, which (relative to FIXTURE_NOW) lapses 7 days later.
    const eightDaysOn = new Date("2026-10-23T10:00:00.000Z");
    expect(needsAttention(data, eightDaysOn).filter((item) => item.firm.id === "firm_gsc").map((item) => item.kind)).toEqual(["owner-invite-expired"]);
    const resent = data.invites.map((invite) => (invite.id === "inv_gsc_owner" ? { ...invite, expiresAt: later(7).toISOString() } : invite));
    const items = needsAttention({ ...data, invites: resent }, eightDaysOn).filter((item) => item.firm.id === "firm_gsc");
    expect(items).toEqual([expect.objectContaining({ kind: "stalled-onboarding", days: 8 })]);
    expect(needsAttention({ ...data, invites: resent }, new Date("2026-10-22T09:00:00.000Z")).some((item) => item.firm.id === "firm_gsc")).toBe(false);
  });

  it("an open support view: ADMIN_ACCESS without its END, under 60 minutes old", () => {
    const start = entry({ id: "s1", action: "ADMIN_ACCESS", entityType: "support_view", entityId: "sv1", firmId: "firm_hts" });
    expect(openSupportViews([start], later(0))).toHaveLength(1);
    expect(openSupportViews([start], new Date(NOW.getTime() + 61 * 60_000))).toHaveLength(0);
    expect(openSupportViews([start, entry({ id: "s2", action: "ADMIN_ACCESS_END", entityType: "support_view", entityId: "sv1" })], later(0))).toHaveLength(0);
  });
});

describe("firm rows (docs/04 §14.3, §14.5)", () => {
  it("owner: the user when accepted; the pending or expired invite before that", () => {
    expect(ownerStatus("firm_hts", data, NOW)).toMatchObject({ kind: "active", name: "Imran Shaikh" });
    expect(ownerStatus("firm_gsc", data, NOW)).toMatchObject({ kind: "pending", email: "owner@gachibowli-staffing.benchq.test" });
    expect(ownerStatus("firm_gsc", data, later(5))).toMatchObject({ kind: "expired" });
  });

  it("last activity is the firm's latest ledger entry", () => {
    expect(lastActivityAt("firm_cbw", data.ledger)).toBe(later(-20).toISOString());
    expect(lastActivityAt("firm_nope", data.ledger)).toBeNull();
  });

  it("plan history and the custom-limits mark (07 Q30): set by a limits adjustment, cleared by a later plan change", () => {
    expect(planHistory("firm_cbw", data.ledger).map((item) => item.summary)).toEqual(["Growth → Starter, seats 10 → 4, candidates 100 → 25"]);
    expect(hasCustomLimits("firm_cbw", data.ledger)).toBe(false);
    const adjusted = [entry({ id: "a", entityType: "firm_limits", createdAt: later(1).toISOString() })];
    expect(hasCustomLimits("firm_stl", adjusted)).toBe(true);
    expect(hasCustomLimits("firm_stl", [...adjusted, entry({ id: "b", entityType: "firm", createdAt: later(2).toISOString() })])).toBe(false);
  });

  it("counts firms on a plan", () => {
    expect(firmsOnPlan("plan_starter", firms)).toBe(3);
    expect(firmsOnPlan("plan_scale", firms)).toBe(0);
  });

  it("names the limit when a seat is blocked (A4)", () => {
    expect(seatBlockReason({ seatsUsed: 4, seatLimit: 4 })).toBe("Your plan allows 4 seats; 4 are in use.");
    expect(seatBlockReason({ seatsUsed: 1, seatLimit: 1 })).toBe("Your plan allows 1 seat; 1 is in use.");
  });
});

describe("slugs (A7, docs/04 §14.4)", () => {
  it("suggests a slug from the name", () => {
    expect(suggestSlug("Hyderabad Tech Staffing LLC")).toBe("hyderabad-tech-staffing-llc");
    expect(suggestSlug("  3 Stars & Co. ")).toBe("stars-co");
  });

  it("gives each failure its own message, then checks reserved words and the other firms' slugs", () => {
    const taken = ["hyderabad-tech-staffing"];
    expect(slugProblem("", taken)).toBe("Enter a slug.");
    expect(slugProblem("ab", taken)).toBe("Use 3–32 characters.");
    expect(slugProblem("a".repeat(33), taken)).toBe("Use 3–32 characters.");
    expect(slugProblem("Acme", taken)).toBe("Use only lowercase letters, digits and hyphens.");
    expect(slugProblem("1acme", taken)).toBe("Start with a letter.");
    expect(slugProblem("acme-", taken)).toBe("Don't end with a hyphen.");
    expect(slugProblem("ac--me", taken)).toBe("Don't use two hyphens in a row.");
    expect(slugProblem("admin", taken)).toBe("This word is reserved by BenchQ.");
    expect(slugProblem("hyderabad-tech-staffing", taken)).toBe("Another firm already uses this slug.");
    expect(slugProblem("madhapur-bench", taken)).toBeNull();
  });
});
