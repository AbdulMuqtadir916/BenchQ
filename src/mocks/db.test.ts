import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * docs/03 §3.3: the demo data persists in this browser. Each "reload" is a fresh set of mock modules
 * (vi.resetModules) reading the same storage; a stub stands in for localStorage and the clock is
 * pinned. Every other test file runs on fresh fixtures: storage is off under the test runner unless a
 * test installs a stub, as this one does.
 */

class StubStorage {
  items = new Map<string, string>();
  getItem(key: string) { return this.items.get(key) ?? null; }
  setItem(key: string, value: string) { this.items.set(key, value); }
  removeItem(key: string) { this.items.delete(key); }
  clear() { this.items.clear(); }
}

const KEY = "benchq.demo-data";
const DAY = 86_400_000;
const T0 = "2026-11-02T09:00:00.000Z";
const at = (days: number) => new Date(new Date(T0).getTime() + days * DAY).toISOString();
type Globals = { __BENCHQ_DEMO_STORAGE__?: Storage | null; __BENCHQ_DEMO_NOW__?: string; window?: unknown };
const g = globalThis as Globals;
let storage: StubStorage;

/** A page load: fresh mock modules over the same storage, at `now`, signed in as `email` if given. */
async function load(now = T0, email?: string) {
  vi.resetModules();
  g.__BENCHQ_DEMO_NOW__ = now;
  const [db, auth, applications, candidates, documents, inbox, invitesModule, tenancy, team, ledger, demo] = await Promise.all([
    import("./db"), import("./auth"), import("./applications"), import("./candidates"), import("./documents"), import("./inbox"),
    import("./invites"), import("./tenancy"), import("./team"), import("./ledger"), import("./demo-data"),
  ]);
  if (email) auth.signInWithPassword(email, auth.DEMO_PASSWORD);
  return { db, auth, applications, candidates, documents, inbox, invitesModule, tenancy, team, ledger, demo };
}
const stored = () => JSON.parse(storage.getItem(KEY) ?? "null") as { version: string; seededAt: string; tables: Record<string, unknown[]> } | null;
const ADNAN = "adnan@hyderabad-tech-staffing.benchq.test";
const FATIMA = "fatima@hyderabad-tech-staffing.benchq.test";
const SANA = "sana@admin.benchq.test";

beforeEach(() => {
  storage = new StubStorage();
  g.__BENCHQ_DEMO_STORAGE__ = storage as unknown as Storage;
});
afterEach(() => {
  delete g.__BENCHQ_DEMO_STORAGE__;
  delete g.__BENCHQ_DEMO_NOW__;
  delete g.window;
});

describe("fixture version", () => {
  it("FIXTURE_VERSION is the fingerprint of src/mocks/data/*.json (update it when the fixtures change: every browser then reseeds)", async () => {
    const dir = fileURLToPath(new URL("./data/", import.meta.url));
    const hash = createHash("sha256");
    for (const name of readdirSync(dir).filter((file) => file.endsWith(".json")).sort()) {
      hash.update(name).update("\0").update(readFileSync(dir + name)).update("\0");
    }
    const { db } = await load();
    expect(db.FIXTURE_VERSION).toBe(hash.digest("hex").slice(0, 16));
  });
});

describe("persistence across reloads, sign-outs and accounts", () => {
  it("seeds from the fixtures on first load and stores only the seeding instant, no tables", async () => {
    const { applications } = await load();
    expect(applications.allApplications.find((a) => a.id === "app_001")?.status).toBeDefined();
    expect(stored()).toMatchObject({ seededAt: T0, tables: {} });
  });

  it("keeps a change across a reload, a sign-out and a different account; untouched tables stay fixtures", async () => {
    const first = await load(T0, ADNAN);
    const app = first.applications.allApplications.find((a) => a.id === "app_001")!;
    const before = app.status;
    await first.applications.applicationsMock.updateStatus("firm_hts", "app_001", { status: "WITHDRAWN", note: "persist me" });
    first.db.flush();
    first.auth.signOut();
    expect(Object.keys(stored()!.tables)).toEqual(["applications"]);

    const second = await load(at(1), FATIMA); // next day, another account in the same browser
    const moved = await second.applications.applicationsMock.byId("firm_hts", "app_001");
    expect(before).not.toBe("WITHDRAWN");
    expect(moved.status).toBe("WITHDRAWN");
    expect(moved.events.at(-1)).toMatchObject({ note: "persist me", actorUserId: "user_adnan" });
    expect(stored()!.seededAt).toBe(T0);
  });

  it("persists every write the mock backend accepts, in the table it changed", async () => {
    const m = await load(T0, ADNAN);
    const candidate = m.candidates.allCandidates.find((c) => c.firmId === "firm_hts")!;
    await m.candidates.candidatesMock.update("firm_hts", candidate.id, { noticePeriodDays: 45 } as never);
    m.db.flush();
    expect(Object.keys(stored()!.tables)).toContain("candidates");

    const doc = await m.documents.documentsMock.upload("firm_hts", candidate.id, { kind: "OTHER", title: "x", fileName: "x.pdf", mimeType: "application/pdf", sizeKb: 1, expiresAt: null });
    m.db.flush();
    expect((stored()!.tables.documents as { id: string }[]).some((row) => row.id === doc.id)).toBe(true);
    await m.documents.documentsMock.remove("firm_hts", doc.id);
    m.db.flush();
    expect((stored()!.tables.documents as { id: string }[]).some((row) => row.id === doc.id)).toBe(false);

    await m.inbox.inboxMock.connect("firm_hts", candidate.id);
    m.db.flush();
    expect(Object.keys(stored()!.tables)).toContain("inboxConnections");
    const message = m.inbox.allMessages.find((row) => row.firmId === "firm_hts")!;
    await m.inbox.inboxMock.markRead("firm_hts", message.id);
    m.db.flush();
    expect(Object.keys(stored()!.tables)).toContain("inboxMessages");

    m.invitesModule.acceptInvite("inv_gsc_owner", { userId: "user_gsc_owner", name: "Sunita Rao" });
    m.db.flush();
    expect(Object.keys(stored()!.tables)).toEqual(expect.arrayContaining(["users", "invites", "firms", "ledger"]));

    const reloaded = await load(at(1), "owner@gachibowli-staffing.benchq.test"); // the accepted owner still exists after a reload
    expect(reloaded.team.firms.find((f) => f.id === "firm_gsc")?.status).toBe("ACTIVE");
    expect(reloaded.auth.currentPrincipal()).toMatchObject({ userId: "user_gsc_owner" });
    expect(reloaded.candidates.allCandidates.find((c) => c.id === candidate.id)?.noticePeriodDays).toBe(45);
  });

  it("reset (Super Admin only) wipes every change and re-anchors to now; nobody else may reset", async () => {
    const m = await load(T0, ADNAN);
    await m.applications.applicationsMock.updateStatus("firm_hts", "app_001", { status: "WITHDRAWN", note: null });
    m.db.flush();
    await expect(m.demo.demoDataMock.reset()).rejects.toMatchObject({ status: 403 });

    const later = await load(at(6), SANA);
    const heard: string[] = [];
    later.db.watchDemoData(() => heard.push("changed"));
    await later.demo.demoDataMock.reset();
    expect(stored()).toMatchObject({ seededAt: at(6), tables: {} });
    expect(later.applications.allApplications.find((a) => a.id === "app_001")?.status).not.toBe("WITHDRAWN"); // replaced in place
    expect(heard).toEqual(["changed"]);
    const after = await load(at(6), FATIMA);
    expect((await after.applications.applicationsMock.byId("firm_hts", "app_001")).status).not.toBe("WITHDRAWN");
  });

  it("reseeds when the stored data is from another fixture version, unreadable, or a table no longer fits its schema", async () => {
    storage.setItem(KEY, JSON.stringify({ version: "old-fixtures", seededAt: at(-30), tables: { applications: [] } }));
    let m = await load();
    expect(m.applications.allApplications.length).toBeGreaterThan(0);
    expect(stored()).toMatchObject({ seededAt: T0, tables: {} });

    storage.setItem(KEY, "{not json");
    m = await load();
    expect(m.applications.allApplications.length).toBeGreaterThan(0);

    const version = m.db.FIXTURE_VERSION;
    storage.setItem(KEY, JSON.stringify({ version, seededAt: T0, tables: { applications: [{ id: "broken" }] } }));
    m = await load();
    expect(m.applications.allApplications.find((a) => a.id === "app_001")).toBeDefined();
  });

  it("another tab's saved change refreshes this tab's tables in place and notifies it", async () => {
    const window = Object.assign(new EventTarget(), {});
    g.window = window;
    const tabA = await load(T0, ADNAN);
    const heard: string[] = [];
    tabA.db.watchDemoData(() => heard.push("refresh"));
    const rowsA = tabA.applications.allApplications;

    // Tab B (another set of modules) moves an application and saves.
    const tabB = await load(T0, ADNAN);
    await tabB.applications.applicationsMock.updateStatus("firm_hts", "app_001", { status: "WITHDRAWN", note: null });
    tabB.db.flush();
    window.dispatchEvent(Object.assign(new Event("storage"), { key: KEY }));

    expect(heard).toEqual(["refresh"]);
    expect(rowsA.find((a) => a.id === "app_001")?.status).toBe("WITHDRAWN"); // the same array, now holding tab B's rows
  });
});

describe("relative fixture dates once the data persists (docs/03 §3.3)", () => {
  it("anchors invites and inbox connections to the seeding instant, then lets them age like real dates; a reset re-anchors them", async () => {
    const seeded = await load(T0);
    const pendingAtSeed = seeded.tenancy.invites.find((invite) => invite.id === "inv_stl_01")!;
    expect(pendingAtSeed.expiresAt).toBe(at(5)); // pending: now + 5 days at seeding (FIXTURE_NOW + 5d → T0 + 5d)

    // Three days later: the same absolute dates (not shifted again), still pending, STL still at 4/4.
    const day3 = await load(at(3));
    const { deriveFirmUsage, effectiveInviteStatus } = await import("@/lib/derive/tenancy");
    const stl = () => day3.team.firms.find((firm) => firm.id === "firm_stl")!;
    const usage = (m: typeof day3, now: string) =>
      deriveFirmUsage(m.team.firms.find((firm) => firm.id === "firm_stl")!, { users: m.team.allUsers, invites: m.tenancy.invites, candidates: m.candidates.allCandidates }, new Date(now));
    expect(day3.tenancy.invites.find((invite) => invite.id === "inv_stl_01")?.expiresAt).toBe(at(5));
    expect(effectiveInviteStatus(day3.tenancy.invites.find((invite) => invite.id === "inv_stl_01")!, new Date(at(3)))).toBe("PENDING");
    expect(usage(day3, at(3))).toMatchObject({ seatsUsed: 4, seatLimit: stl().seatLimit });

    // Six days later: it expired like a real invite, and its seat is free again (derived, nothing stored).
    const day6 = await load(at(6));
    expect(effectiveInviteStatus(day6.tenancy.invites.find((invite) => invite.id === "inv_stl_01")!, new Date(at(6)))).toBe("EXPIRED");
    expect(usage(day6, at(6))).toMatchObject({ seatsUsed: 3, canAddSeat: true });
    expect(stored()!.seededAt).toBe(T0);

    // A reset on day 6 re-anchors the fixtures to day 6: pending again.
    const admin = await load(at(6), SANA);
    await admin.demo.demoDataMock.reset();
    const afterReset = await load(at(6));
    expect(afterReset.tenancy.invites.find((invite) => invite.id === "inv_stl_01")?.expiresAt).toBe(at(11));
    expect(usage(afterReset, at(6))).toMatchObject({ seatsUsed: 4 });
  });

  it("anchors inbox connections to the seeding instant (12 days before it), and keeps them across reloads", async () => {
    const seeded = await load(T0, ADNAN);
    const connectedId = (await import("./data/inbox.json")).default.initiallyConnected[0] as string;
    const firmId = seeded.candidates.allCandidates.find((c) => c.id === connectedId)!.firmId;
    const session = firmId === "firm_hts" ? seeded : await load(T0, ADNAN);
    const inbox = await session.inbox.inboxMock.byCandidate(firmId, connectedId);
    expect(inbox.connection?.connectedAt).toBe(at(-12));
    const later = await load(at(4), ADNAN);
    expect((await later.inbox.inboxMock.byCandidate(firmId, connectedId)).connection?.connectedAt).toBe(at(-12));
  });
});

describe("tests never read persisted data", () => {
  it("ignores a browser's localStorage under the test runner unless a test installs a stub", async () => {
    const browserStorage = new StubStorage();
    browserStorage.setItem(KEY, JSON.stringify({ version: "whatever", seededAt: T0, tables: { applications: [] } }));
    g.window = { localStorage: browserStorage };
    delete g.__BENCHQ_DEMO_STORAGE__;
    const m = await load();
    expect(m.applications.allApplications.length).toBeGreaterThan(0);
    expect(browserStorage.getItem(KEY)).toContain("whatever"); // untouched: never read, never written
  });
});

describe("a full localStorage (docs/03 §3.3)", () => {
  class FullStorage extends StubStorage {
    full = false;
    override setItem(key: string, value: string) {
      if (this.full) throw Object.assign(new Error("The quota has been exceeded."), { name: "QuotaExceededError" });
      super.setItem(key, value);
    }
  }

  it("keeps the change in memory, says storage is full, and saves it once space is back", async () => {
    const full = new FullStorage();
    storage = full;
    g.__BENCHQ_DEMO_STORAGE__ = full as unknown as Storage;
    const m = await load(T0, ADNAN);
    const states: boolean[] = [];
    m.db.watchStorageFull((isFull) => states.push(isFull));

    full.full = true;
    await m.applications.applicationsMock.updateStatus("firm_hts", "app_001", { status: "RESPONSE", note: "kept" });
    m.db.flush();
    expect(m.applications.allApplications.find((a) => a.id === "app_001")?.status).toBe("RESPONSE"); // not lost in this tab
    expect(stored()!.tables).toEqual({}); // nothing reached storage
    expect(states).toEqual([false, true]); // the app shows "Demo storage is full…"

    full.full = false;
    await m.applications.applicationsMock.updateStatus("firm_hts", "app_003", { status: "RESPONSE", note: null });
    m.db.flush();
    const saved = stored()!.tables.applications as { id: string; status: string }[];
    expect(saved.find((a) => a.id === "app_001")?.status).toBe("RESPONSE"); // the earlier change made it after all
    expect(saved.find((a) => a.id === "app_003")?.status).toBe("RESPONSE");
    expect(states).toEqual([false, true, false]);
  });

  it("the notice says what to do", async () => {
    const { renderToString } = await import("react-dom/server");
    const { createElement } = await import("react");
    const { DemoStorageFullMessage } = await import("@/components/app/demo-storage-notice");
    const html = renderToString(createElement(DemoStorageFullMessage));
    expect(html).toContain('role="alert"');
    expect(html).toContain("Demo storage is full. Ask a Super Admin to reset demo data.");
  });
});
