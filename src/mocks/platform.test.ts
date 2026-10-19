import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * docs/04 §14 / 07 P3: every Super Admin write persists (survives a reload) and writes its ledger
 * entry, and the mock enforces the §14 rules a hidden button only hints at. Each "reload" is a fresh
 * set of mock modules over the same stub storage, as in db.test.ts.
 */

class StubStorage {
  items = new Map<string, string>();
  getItem(key: string) { return this.items.get(key) ?? null; }
  setItem(key: string, value: string) { this.items.set(key, value); }
  removeItem(key: string) { this.items.delete(key); }
  clear() { this.items.clear(); }
}

const T0 = "2026-10-19T09:00:00.000Z";
const DAY = 86_400_000;
const SANA = "sana@admin.benchq.test";
type Globals = { __BENCHQ_DEMO_STORAGE__?: Storage | null; __BENCHQ_DEMO_NOW__?: string };
const g = globalThis as Globals;

async function load(email: string | null = SANA) {
  vi.resetModules();
  g.__BENCHQ_DEMO_NOW__ = T0;
  const [db, auth, platform, ledger, team, tenancy] = await Promise.all([
    import("./db"), import("./auth"), import("./platform"), import("./ledger"), import("./team-data"), import("./tenancy"),
  ]);
  if (email) auth.signInWithPassword(email, auth.DEMO_PASSWORD);
  return { db, auth, platform: platform.platformMock, ledger: ledger.allLedger, firms: team.firms, users: team.allUsers, invites: tenancy.invites, plans: tenancy.plans, staff: tenancy.platformUsers };
}

/** Save, reload, and sign Sana in again. */
async function reload(m: Awaited<ReturnType<typeof load>>) {
  m.db.flush();
  return load();
}

const NOW = new Date(T0);

beforeAll(() => {
  process.env.NEXT_PUBLIC_MOCK_DELAY_MS = "0";
});
beforeEach(() => {
  g.__BENCHQ_DEMO_STORAGE__ = new StubStorage() as unknown as Storage;
});
afterEach(() => {
  delete g.__BENCHQ_DEMO_STORAGE__;
  delete g.__BENCHQ_DEMO_NOW__;
});

const createInput = {
  name: "Madhapur Bench Partners",
  slug: "madhapur-bench",
  planId: "plan_starter",
  primaryTimezone: "Asia/Kolkata",
  clientTimezone: "America/Chicago",
  contactPhone: "+91 40 5555 0101",
  ownerName: "Priya Nair",
  ownerEmail: "Priya@Madhapur-Bench.benchq.test",
};

describe("who may call it", () => {
  it("is PLATFORM_ADMIN only: a firm OWNER gets 403, a signed-out caller 401", async () => {
    const asOwner = await load("imran@hyderabad-tech-staffing.benchq.test");
    await expect(asOwner.platform.firms.list()).rejects.toMatchObject({ status: 403 });
    await expect(asOwner.platform.firms.suspend("firm_stl", "testing the guard here")).rejects.toMatchObject({ status: 403 });
    const signedOut = await load(null);
    await expect(signedOut.platform.firms.list()).rejects.toMatchObject({ status: 401 });
  });
});

describe("firm writes persist and log (docs/04 §14.4–14.5)", () => {
  it("create firm: ONBOARDING, plan limits copied, OWNER invite for 7 days, FIRM_CREATED + INVITE_SENT", async () => {
    const m = await load();
    const firm = await m.platform.firms.create(createInput, NOW);
    expect(firm).toMatchObject({ status: "ONBOARDING", planId: "plan_starter", seatLimit: 4, candidateLimit: 25, contactPhone: "+91 40 5555 0101" });
    const after = await reload(m);
    expect(after.firms.find((item) => item.id === firm.id)?.slug).toBe("madhapur-bench");
    const invite = after.invites.find((item) => item.firmId === firm.id)!;
    expect(invite).toMatchObject({ role: "OWNER", email: "priya@madhapur-bench.benchq.test", status: "PENDING", invitedByUserId: "padm_sana", expiresAt: new Date(NOW.getTime() + 7 * DAY).toISOString() });
    const entries = after.ledger.filter((entry) => entry.firmId === firm.id);
    expect(entries.map((entry) => entry.action).sort()).toEqual(["FIRM_CREATED", "INVITE_SENT"]);
    expect(entries.every((entry) => entry.actorType === "PLATFORM_ADMIN" && entry.actorName === "Sana Mirza")).toBe(true);
    expect(entries.find((entry) => entry.action === "INVITE_SENT")?.summary).toBe("Invited Priya Nair (priya@madhapur-bench.benchq.test) as OWNER");
  });

  it("create firm refuses a taken, reserved or malformed slug, a hidden plan and an email already in use", async () => {
    const m = await load();
    await expect(m.platform.firms.create({ ...createInput, slug: "secunderabad-talent" }, NOW)).rejects.toThrow(/already uses/);
    await expect(m.platform.firms.create({ ...createInput, slug: "admin" }, NOW)).rejects.toThrow(/reserved/);
    await expect(m.platform.firms.create({ ...createInput, slug: "Bad Slug" }, NOW)).rejects.toThrow(/lowercase/);
    await expect(m.platform.firms.create({ ...createInput, ownerEmail: "imran@hyderabad-tech-staffing.benchq.test" }, NOW)).rejects.toMatchObject({ status: 409 });
    await m.platform.plans.setActive("plan_scale", false, NOW);
    await expect(m.platform.firms.create({ ...createInput, planId: "plan_scale" }, NOW)).rejects.toThrow(/isn't offered/);
  });

  it("edit and change slug log UPDATE with before → after; an unchanged edit logs nothing", async () => {
    const m = await load();
    const firm = m.firms.find((item) => item.id === "firm_stl")!;
    const before = m.ledger.length;
    await m.platform.firms.update("firm_stl", { name: firm.name, contactPhone: firm.contactPhone, primaryTimezone: firm.primaryTimezone, clientTimezone: firm.clientTimezone }, NOW);
    expect(m.ledger.length).toBe(before);
    await m.platform.firms.update("firm_stl", { name: "Secunderabad Talent Labs Pvt", contactPhone: null, primaryTimezone: "Asia/Kolkata", clientTimezone: "America/Los_Angeles" }, NOW);
    await m.platform.firms.changeSlug("firm_stl", "sec-talent", NOW);
    const after = await reload(m);
    expect(after.firms.find((item) => item.id === "firm_stl")).toMatchObject({ name: "Secunderabad Talent Labs Pvt", slug: "sec-talent", clientTimezone: "America/Los_Angeles" });
    const [slug, edit] = after.ledger;
    expect(slug).toMatchObject({ action: "UPDATE", firmId: "firm_stl", summary: "Slug secunderabad-talent → sec-talent" });
    expect(edit).toMatchObject({ action: "UPDATE", firmId: "firm_stl" });
    expect(edit!.summary).toContain('name "Secunderabad Talent Labs" → "Secunderabad Talent Labs Pvt"');
  });

  it("suspend: ACTIVE only, reason of 10+ characters in the summary; reactivate: SUSPENDED only, even over a limit", async () => {
    const m = await load();
    await expect(m.platform.firms.suspend("firm_gsc", "onboarding firm, not allowed", NOW)).rejects.toMatchObject({ status: 409 });
    await expect(m.platform.firms.suspend("firm_stl", "too short", NOW)).rejects.toMatchObject({ status: 400 });
    await m.platform.firms.suspend("firm_stl", "Contract renewal pending", NOW);
    await expect(m.platform.firms.reactivate("firm_hts", NOW)).rejects.toMatchObject({ status: 409 });
    // CBW is suspended and over its seat limit (6 of 4): reactivating the firm is not blocked.
    await m.platform.firms.reactivate("firm_cbw", NOW);
    const after = await reload(m);
    expect(after.firms.find((item) => item.id === "firm_stl")?.status).toBe("SUSPENDED");
    expect(after.firms.find((item) => item.id === "firm_cbw")?.status).toBe("ACTIVE");
    expect(after.ledger.find((entry) => entry.action === "FIRM_SUSPENDED" && entry.firmId === "firm_stl")?.summary).toBe("Suspended: Contract renewal pending");
    expect(after.ledger[0]).toMatchObject({ action: "FIRM_REACTIVATED", firmId: "firm_cbw" });
  });
});

describe("plan and limits (docs/04 §14.5 Plan tab, 07 Q29–Q30)", () => {
  it("change plan copies the limits and logs PLAN_CHANGED on the firm, before → after; allowed when usage exceeds them", async () => {
    const m = await load();
    await m.platform.firms.changePlan("firm_hts", "plan_starter", NOW); // 7 seats used, Starter allows 4
    const after = await reload(m);
    expect(after.firms.find((item) => item.id === "firm_hts")).toMatchObject({ planId: "plan_starter", seatLimit: 4, candidateLimit: 25 });
    expect(after.ledger[0]).toMatchObject({ action: "PLAN_CHANGED", entityType: "firm", summary: "Growth → Starter, seats 10 → 4, candidates 100 → 25" });
  });

  it("adjust limits logs PLAN_CHANGED on firm_limits (the custom-limits mark); a later plan change clears it", async () => {
    const { hasCustomLimits } = await import("@/lib/derive/platform");
    const m = await load();
    await expect(m.platform.firms.adjustLimits("firm_stl", { seatLimit: 0, candidateLimit: 25 }, NOW)).rejects.toMatchObject({ status: 400 });
    await m.platform.firms.adjustLimits("firm_stl", { seatLimit: 6, candidateLimit: 25 }, NOW);
    let after = await reload(m);
    expect(after.firms.find((item) => item.id === "firm_stl")).toMatchObject({ planId: "plan_starter", seatLimit: 6 });
    expect(after.ledger[0]).toMatchObject({ action: "PLAN_CHANGED", entityType: "firm_limits", summary: "Custom limits on Starter: seats 4 → 6, candidates 25 → 25" });
    expect(hasCustomLimits("firm_stl", after.ledger)).toBe(true);
    await after.platform.firms.changePlan("firm_stl", "plan_growth", new Date(NOW.getTime() + 1000));
    after = await reload(after);
    expect(hasCustomLimits("firm_stl", after.ledger)).toBe(false);
  });
});

describe("firm users and invites (docs/04 §14.5 Users tab)", () => {
  it("deactivate logs STATE_CHANGE on the user; the OWNER can't be deactivated; a deactivated user can't sign in", async () => {
    const m = await load();
    await expect(m.platform.users.deactivate("user_imran", NOW)).rejects.toMatchObject({ status: 409 });
    await m.platform.users.deactivate("user_adnan", NOW);
    const after = await reload(m);
    expect(after.users.find((user) => user.id === "user_adnan")?.isActive).toBe(false);
    expect(after.ledger[0]).toMatchObject({ action: "STATE_CHANGE", entityType: "user", firmId: "firm_hts", entityId: "user_adnan" });
    expect(() => after.auth.signInWithPassword("adnan@hyderabad-tech-staffing.benchq.test", after.auth.DEMO_PASSWORD)).toThrow(/incorrect/);
  });

  it("reactivate is blocked at the seat limit with the reason naming the limit, and works below it", async () => {
    const m = await load();
    await m.platform.users.deactivate("user_adnan", NOW); // HTS 6 of 10
    await m.platform.firms.adjustLimits("firm_hts", { seatLimit: 6, candidateLimit: 100 }, NOW); // at the limit
    await expect(m.platform.users.reactivate("user_adnan", NOW)).rejects.toMatchObject({ status: 409, message: "Your plan allows 6 seats; 6 are in use." });
    await m.platform.firms.adjustLimits("firm_hts", { seatLimit: 10, candidateLimit: 100 }, NOW);
    await m.platform.users.reactivate("user_adnan", NOW);
    const after = await reload(m);
    expect(after.users.find((user) => user.id === "user_adnan")?.isActive).toBe(true);
    expect(after.ledger[0]).toMatchObject({ action: "STATE_CHANGE", summary: expect.stringMatching(/^Reactivated/) });
  });

  it("resend: same row, +7 days, INVITE_SENT 'Invite resent to …' (Q24); revoke: INVITE_REVOKED; accepted/revoked can't be resent", async () => {
    const m = await load();
    await m.platform.invites.resend("inv_hts_02", NOW); // expired; HTS has room
    await m.platform.invites.revoke("inv_hts_01", NOW);
    await expect(m.platform.invites.resend("inv_hts_03", NOW)).rejects.toMatchObject({ status: 409 });
    await expect(m.platform.invites.revoke("inv_hts_04", NOW)).rejects.toMatchObject({ status: 409 });
    const after = await reload(m);
    expect(after.invites.find((invite) => invite.id === "inv_hts_02")).toMatchObject({ status: "PENDING", expiresAt: new Date(NOW.getTime() + 7 * DAY).toISOString() });
    expect(after.invites.find((invite) => invite.id === "inv_hts_01")?.status).toBe("REVOKED");
    const [revoked, resent] = after.ledger;
    expect(resent).toMatchObject({ action: "INVITE_SENT", firmId: "firm_hts", summary: "Invite resent to old.lead@hyderabad-tech-staffing.benchq.test" });
    expect(revoked).toMatchObject({ action: "INVITE_REVOKED", firmId: "firm_hts" });
  });

  it("resending an expired invite takes a seat again, so it is blocked at the seat limit", async () => {
    const m = await load();
    await m.platform.firms.adjustLimits("firm_hts", { seatLimit: 7, candidateLimit: 100 }, NOW); // 7 of 7
    await expect(m.platform.invites.resend("inv_hts_02", NOW)).rejects.toMatchObject({ status: 409, message: "Your plan allows 7 seats; 7 are in use." });
    await m.platform.invites.resend("inv_hts_01", NOW); // pending: already holds its seat
  });
});

describe("plan catalogue (docs/04 §14.6)", () => {
  it("create, edit and hide log CREATE / UPDATE on plan with firmId null, and never change existing firms (A3)", async () => {
    const m = await load();
    const plan = await m.platform.plans.create({ name: "Boutique", seatLimit: 6, candidateLimit: 40, features: ["Truth Guard", " "] }, NOW);
    await m.platform.plans.update("plan_starter", { name: "Starter", seatLimit: 5, candidateLimit: 30, features: ["Truth Guard"] }, NOW);
    await m.platform.plans.setActive(plan.id, false, NOW);
    await expect(m.platform.plans.create({ name: "growth", seatLimit: 1, candidateLimit: 1, features: [] }, NOW)).rejects.toMatchObject({ status: 409 });
    const after = await reload(m);
    expect(after.plans.find((item) => item.id === plan.id)).toMatchObject({ isActive: false, features: ["Truth Guard"] });
    expect(after.plans.find((item) => item.id === "plan_starter")).toMatchObject({ seatLimit: 5 });
    expect(after.firms.find((item) => item.id === "firm_stl")).toMatchObject({ seatLimit: 4, candidateLimit: 25 });
    expect(after.ledger.slice(0, 3).map((entry) => [entry.action, entry.entityType, entry.firmId])).toEqual([["UPDATE", "plan", null], ["UPDATE", "plan", null], ["CREATE", "plan", null]]);
  });
});

describe("BenchQ staff (docs/04 §14.8)", () => {
  it("invite: PLATFORM_ADMIN, firmId null, INVITE_SENT on the platform; not twice for the same email", async () => {
    const m = await load();
    const invite = await m.platform.team.invite("Zoya@admin.benchq.test", NOW);
    await expect(m.platform.team.invite("zoya@admin.benchq.test", NOW)).rejects.toMatchObject({ status: 409 });
    await expect(m.platform.team.invite("not-an-email", NOW)).rejects.toMatchObject({ status: 400 });
    const after = await reload(m);
    expect(after.invites.find((item) => item.id === invite.id)).toMatchObject({ firmId: null, role: "PLATFORM_ADMIN", email: "zoya@admin.benchq.test" });
    expect(after.ledger[0]).toMatchObject({ action: "INVITE_SENT", firmId: null, summary: "Invited zoya@admin.benchq.test to the platform team" });
  });

  it("deactivate: never yourself, never the last active admin; otherwise STATE_CHANGE on platform_user", async () => {
    const m = await load();
    await expect(m.platform.team.deactivate("padm_sana", NOW)).rejects.toThrow(/yourself/);
    m.staff.push({ id: "padm_omar", name: "Omar Siddiqui", email: "omar@admin.benchq.test", role: "PLATFORM_ADMIN", isActive: true, lastActiveAt: null });
    await m.platform.team.deactivate("padm_omar", NOW);
    expect(m.staff.find((user) => user.id === "padm_omar")?.isActive).toBe(false);
    expect(m.ledger[0]).toMatchObject({ action: "STATE_CHANGE", entityType: "platform_user", firmId: null, summary: "Deactivated Omar Siddiqui" });
  });
});
