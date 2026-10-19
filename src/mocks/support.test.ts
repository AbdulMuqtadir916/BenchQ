import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 07 §4 / docs/04 §14.10 on the mock backend: the read-only support view. A view is the principal's
 * `support`; it opens the firm's reads (never its writes), is one at a time, lasts 60 minutes, and every
 * start and end is in the firm's own ledger.
 */

class StubStorage {
  items = new Map<string, string>();
  getItem(key: string) { return this.items.get(key) ?? null; }
  setItem(key: string, value: string) { this.items.set(key, value); }
  removeItem(key: string) { this.items.delete(key); }
  clear() { this.items.clear(); }
}

type Globals = { __BENCHQ_DEMO_STORAGE__?: Storage | null; __BENCHQ_DEMO_NOW__?: string };
const g = globalThis as Globals;
const SANA = "sana@admin.benchq.test";
const REASON = "Customer reported a missing application";

async function load(email: string | null = SANA) {
  vi.resetModules();
  g.__BENCHQ_DEMO_NOW__ = "2026-10-19T09:00:00.000Z";
  const [db, auth, support, session, candidates, applications, ledger] = await Promise.all([
    import("./db"), import("./auth"), import("./support"), import("./session"), import("./candidates"), import("./applications"), import("./ledger"),
  ]);
  if (email) auth.signInWithPassword(email, auth.DEMO_PASSWORD);
  return { db, auth, support, session: session.sessionMock, candidates: candidates.candidatesMock, applications: applications.applicationsMock, ledger: ledger.allLedger };
}

beforeAll(() => {
  process.env.NEXT_PUBLIC_MOCK_DELAY_MS = "0";
});
beforeEach(() => {
  g.__BENCHQ_DEMO_STORAGE__ = new StubStorage() as unknown as Storage;
  vi.useRealTimers();
});
afterEach(() => {
  delete g.__BENCHQ_DEMO_STORAGE__;
  delete g.__BENCHQ_DEMO_NOW__;
  vi.useRealTimers();
});

describe("start", () => {
  it("opens the firm's reads, read-only: ADMIN_ACCESS in the firm's ledger with the admin's name and the reason", async () => {
    const m = await load();
    await expect(m.candidates.list("firm_hts")).rejects.toMatchObject({ status: 404 }); // no view yet
    const session = await m.session.startSupportView("firm_hts", REASON);
    expect(session.principal).toMatchObject({ kind: "platform", support: { firmId: "firm_hts", reason: REASON } });
    expect(session.firm?.id).toBe("firm_hts");
    expect((await m.candidates.list("firm_hts")).length).toBeGreaterThan(0);
    await expect(m.applications.updateStatus("firm_hts", "app_001", { status: "INTERVIEW", note: null })).rejects.toMatchObject({ status: 403, message: "A support view is read-only." });
    await expect(m.candidates.list("firm_stl")).rejects.toMatchObject({ status: 404 }); // another firm stays closed
    expect(m.ledger[0]).toMatchObject({ action: "ADMIN_ACCESS", firmId: "firm_hts", actorType: "PLATFORM_ADMIN", actorName: "Sana Mirza", entityType: "support_view", summary: `Support view started: ${REASON}` });
    expect(JSON.stringify(m.ledger[0])).not.toContain("sana@"); // the firm never sees the admin's email (A12)
  });

  it("needs a reason of 10+ characters, an existing firm, and a Super Admin", async () => {
    const m = await load();
    await expect(m.session.startSupportView("firm_hts", "too short")).rejects.toMatchObject({ status: 400 });
    await expect(m.session.startSupportView("firm_nope", REASON)).rejects.toMatchObject({ status: 404 });
    const owner = await load("imran@hyderabad-tech-staffing.benchq.test");
    await expect(owner.session.startSupportView("firm_stl", REASON)).rejects.toMatchObject({ status: 403 });
  });

  it("opens a SUSPENDED firm too (read-only), and an ONBOARDING firm with no users (07 Q29)", async () => {
    const m = await load();
    expect((await m.session.startSupportView("firm_cbw", REASON)).principal).toMatchObject({ support: { firmId: "firm_cbw" } });
    expect((await m.session.startSupportView("firm_gsc", REASON)).principal).toMatchObject({ support: { firmId: "firm_gsc" } });
    expect(await m.candidates.list("firm_gsc")).toEqual([]);
  });
});

describe("one at a time, exit, expiry, sign-out", () => {
  it("starting a view of firm B ends firm A's first; both logged in their own firm", async () => {
    const m = await load();
    await m.session.startSupportView("firm_hts", REASON);
    await m.session.startSupportView("firm_stl", "Checking the plan change today");
    expect(m.ledger.slice(0, 2).map((entry) => [entry.action, entry.firmId, entry.summary])).toEqual([
      ["ADMIN_ACCESS", "firm_stl", "Support view started: Checking the plan change today"],
      ["ADMIN_ACCESS_END", "firm_hts", "Support view ended: another support view started"],
    ]);
    await expect(m.candidates.list("firm_hts")).rejects.toMatchObject({ status: 404 });
  });

  it("exit: ADMIN_ACCESS_END, the firm to go back to, and the firm closed again", async () => {
    const m = await load();
    await m.session.startSupportView("firm_hts", REASON);
    const { session, firmId } = await m.session.exitSupportView();
    expect(firmId).toBe("firm_hts");
    expect(session.principal).toMatchObject({ kind: "platform", support: null });
    expect(m.ledger[0]).toMatchObject({ action: "ADMIN_ACCESS_END", firmId: "firm_hts", summary: "Support view ended" });
    await expect(m.candidates.list("firm_hts")).rejects.toMatchObject({ status: 404 });
  });

  it("60 minutes, no extension: after that the view is closed and its end is logged at the expiry time", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-19T09:00:00.000Z"));
    const m = await load();
    const started = await m.session.startSupportView("firm_hts", REASON);
    expect(started.principal).toMatchObject({ support: { expiresAt: "2026-10-19T10:00:00.000Z" } });
    vi.setSystemTime(new Date("2026-10-19T10:00:01.000Z"));
    await expect(m.candidates.list("firm_hts")).rejects.toMatchObject({ status: 404 });
    const now = await m.session.current();
    expect(now?.principal).toMatchObject({ support: null });
    expect(m.ledger[0]).toMatchObject({ action: "ADMIN_ACCESS_END", summary: "Support view ended after 60 minutes", createdAt: "2026-10-19T10:00:00.000Z" });
  });

  it("signing out ends the view (logged), and it doesn't come back on the next sign-in", async () => {
    const m = await load();
    await m.session.startSupportView("firm_hts", REASON);
    await m.session.signOut();
    expect(m.ledger[0]).toMatchObject({ action: "ADMIN_ACCESS_END", summary: "Support view ended: signed out" });
    m.auth.signInWithPassword(SANA, m.auth.DEMO_PASSWORD);
    expect((await m.session.current())?.principal).toMatchObject({ support: null });
  });

  it("survives a reload while it lasts (the view is stored with the demo data)", async () => {
    const m = await load();
    await m.session.startSupportView("firm_hts", REASON);
    m.db.flush();
    const again = await load(SANA); // the session cookie stand-in lives outside the demo data under the test runner
    expect((await again.session.current())?.principal).toMatchObject({ support: { firmId: "firm_hts" } });
  });
});
