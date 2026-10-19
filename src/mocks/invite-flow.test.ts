import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 07 P4 / docs/04 §2.1: the invite link. Tokens live in the mock auth layer (never on the Invite), a
 * resend replaces them, and /invite/[token] accepts with every blocked state handled. Each "reload" is
 * a fresh set of mock modules over the same stub storage (db.test.ts).
 */

class StubStorage {
  items = new Map<string, string>();
  getItem(key: string) { return this.items.get(key) ?? null; }
  setItem(key: string, value: string) { this.items.set(key, value); }
  removeItem(key: string) { this.items.delete(key); }
  clear() { this.items.clear(); }
}

const T0 = "2026-10-19T09:00:00.000Z";
const NOW = new Date(T0);
const DAY = 86_400_000;
const SANA = "sana@admin.benchq.test";
type Globals = { __BENCHQ_DEMO_STORAGE__?: Storage | null; __BENCHQ_DEMO_NOW__?: string };
const g = globalThis as Globals;

async function load(email: string | null = null) {
  vi.resetModules();
  g.__BENCHQ_DEMO_NOW__ = T0;
  const [db, auth, platform, flow, tenancy, team, ledger, landing] = await Promise.all([
    import("./db"), import("./auth"), import("./platform"), import("./invite-flow"), import("./tenancy"), import("./team-data"), import("./ledger"), import("@/lib/routes/landing"),
  ]);
  if (email) auth.signInWithPassword(email, auth.DEMO_PASSWORD);
  return { db, auth, platform: platform.platformMock, flow: flow.inviteFlowMock, invites: tenancy.invites, staff: tenancy.platformUsers, firms: team.firms, users: team.allUsers, ledger: ledger.allLedger, landingHref: landing.landingHref };
}

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

const newFirm = {
  name: "Madhapur Bench Partners", slug: "madhapur-bench", planId: "plan_starter", primaryTimezone: "Asia/Kolkata", clientTimezone: "America/New_York",
  contactPhone: null, ownerName: "Priya Nair", ownerEmail: "priya@madhapur-bench.benchq.test",
};

describe("the owner's invite, from Create firm to /welcome", () => {
  it("copy link → open signed out → accept: OWNER created and signed in, firm ACTIVE, INVITE_ACCEPTED, lands on /welcome; the chosen password signs in after a reload", async () => {
    const asSana = await load(SANA);
    const firm = await asSana.platform.firms.create(newFirm, NOW);
    const invite = asSana.invites.find((item) => item.firmId === firm.id)!;
    const { token } = await asSana.platform.invites.link(invite.id, NOW);
    expect(JSON.stringify(asSana.invites)).not.toContain(token); // the token is never on an Invite
    asSana.auth.signOut();
    asSana.db.flush();

    const visitor = await load(null);
    expect(await visitor.flow.lookup(token, NOW)).toMatchObject({ status: "VALID", firmName: "Madhapur Bench Partners", role: "OWNER", inviteeName: "Priya Nair", email: newFirm.ownerEmail });
    const session = await visitor.flow.accept(token, { name: "Priya N.", password: "madhapur-2026" }, NOW);
    expect(session.principal).toMatchObject({ kind: "firm", firmId: firm.id, role: "OWNER" });
    expect(visitor.landingHref(session)).toBe("/madhapur-bench/welcome");
    expect(visitor.firms.find((item) => item.id === firm.id)?.status).toBe("ACTIVE");
    expect(visitor.ledger[0]).toMatchObject({ action: "INVITE_ACCEPTED", firmId: firm.id, actorName: "Priya N.", summary: "Priya N. accepted the OWNER invite; firm is now active" });
    expect(await visitor.flow.lookup(token, NOW)).toMatchObject({ status: "ACCEPTED" });
    visitor.auth.signOut();
    visitor.db.flush();

    const later = await load(null);
    expect(() => later.auth.signInWithPassword(newFirm.ownerEmail, later.auth.DEMO_PASSWORD)).toThrow(/incorrect/);
    expect(later.auth.signInWithPassword(newFirm.ownerEmail, "madhapur-2026")).toMatchObject({ kind: "firm", role: "OWNER" });
  });

  it("resend issues a new token: the old link is INVALID, the new one VALID", async () => {
    const m = await load(SANA);
    const { token: first } = await m.platform.invites.link("inv_gsc_owner", NOW);
    await m.platform.invites.resend("inv_gsc_owner", NOW);
    const { token: second } = await m.platform.invites.link("inv_gsc_owner", NOW);
    expect(second).not.toBe(first);
    expect(await m.flow.lookup(first, NOW)).toEqual({ status: "INVALID" });
    expect(await m.flow.lookup(second, NOW)).toMatchObject({ status: "VALID", inviteeName: "Sunita Rao" });
  });

  it("a fixture invite's link is the same after a reload", async () => {
    const first = await load(SANA);
    const { token } = await first.platform.invites.link("inv_gsc_owner", NOW);
    const again = await load(SANA);
    expect((await again.platform.invites.link("inv_gsc_owner", NOW)).token).toBe(token);
  });
});

describe("every state of the link (docs/04 §2.1)", () => {
  async function tokenOf(m: Awaited<ReturnType<typeof load>>, inviteId: string) {
    const { tokenForInvite } = await import("./invite-tokens");
    return tokenForInvite(inviteId)!;
  }

  it("unknown → INVALID (nothing about any invite); revoked, accepted, expired; accepting any of them fails", async () => {
    const m = await load(SANA);
    await m.platform.invites.revoke("inv_hts_01", NOW);
    expect(await m.flow.lookup("iv_nope", NOW)).toEqual({ status: "INVALID" });
    expect(await m.flow.lookup(await tokenOf(m, "inv_hts_01"), NOW)).toMatchObject({ status: "REVOKED", firmName: "Hyderabad Tech Staffing LLC" });
    expect(await m.flow.lookup(await tokenOf(m, "inv_hts_03"), NOW)).toMatchObject({ status: "ACCEPTED" });
    expect(await m.flow.lookup(await tokenOf(m, "inv_hts_02"), NOW)).toMatchObject({ status: "EXPIRED" });
    await expect(m.flow.accept(await tokenOf(m, "inv_hts_01"), { name: "X", password: "password1" }, NOW)).rejects.toMatchObject({ status: 410 });
    await expect(m.flow.accept("iv_nope", { name: "X", password: "password1" }, NOW)).rejects.toMatchObject({ status: 410 });
  });

  it("a SUSPENDED firm's invite: blocked with 'Workspace suspended', and it stays PENDING (Q28)", async () => {
    const m = await load(null);
    const token = await tokenOf(m, "inv_cbw_01");
    expect(await m.flow.lookup(token, NOW)).toMatchObject({ status: "SUSPENDED", firmName: "Cyberabad Bench Works" });
    await expect(m.flow.accept(token, { name: "New BDE", password: "password1" }, NOW)).rejects.toMatchObject({ status: 403, message: expect.stringMatching(/^Workspace suspended/) });
    expect(m.invites.find((item) => item.id === "inv_cbw_01")?.status).toBe("PENDING");
  });

  it("an invite expires 7 days after it was sent, even if never opened", async () => {
    const m = await load(SANA);
    const token = await tokenOf(m, "inv_hts_01");
    expect((await m.flow.lookup(token, new Date(NOW.getTime() + 8 * DAY))).status).toBe("EXPIRED");
  });

  it("asks for a name and a password of 8+ characters", async () => {
    const m = await load(null);
    const token = await tokenOf(m, "inv_gsc_owner");
    await expect(m.flow.accept(token, { name: " ", password: "password1" }, NOW)).rejects.toMatchObject({ status: 400 });
    await expect(m.flow.accept(token, { name: "Sunita", password: "short" }, NOW)).rejects.toMatchObject({ status: 400 });
    expect(m.invites.find((item) => item.id === "inv_gsc_owner")?.status).toBe("PENDING");
  });
});

describe("a staff invite", () => {
  it("joins the platform team: a Super Admin session that lands on /admin; INVITE_ACCEPTED on the platform (firmId null)", async () => {
    const m = await load(null);
    const { tokenForInvite } = await import("./invite-tokens");
    const session = await m.flow.accept(tokenForInvite("inv_platform_01")!, { name: "Omar Siddiqui", password: "omar-benchq" }, NOW);
    expect(session.principal).toMatchObject({ kind: "platform", role: "PLATFORM_ADMIN" });
    expect(m.landingHref(session)).toBe("/admin");
    expect(m.staff.some((user) => user.email === "omar@admin.benchq.test" && user.isActive)).toBe(true);
    expect(m.ledger[0]).toMatchObject({ action: "INVITE_ACCEPTED", firmId: null, actorType: "PLATFORM_ADMIN" });
  });
});
