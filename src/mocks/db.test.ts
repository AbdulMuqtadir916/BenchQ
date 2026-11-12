import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubCandidateReads } from "./fixture-backend";
import { fixtureCandidates } from "@/test/fixtures/candidates";

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

/** A page load: fresh mock modules over the same storage, at `now`, signed in as the seeded account `email` names if given. */
async function load(now = T0, email?: string) {
  vi.resetModules();
  g.__BENCHQ_DEMO_NOW__ = now;
  const [db, signIn, applications, documents, inbox, demo, candidatesModule] = await Promise.all([
    import("./db"), import("./sign-in-as"), import("./applications"), import("./documents"), import("./inbox"),
    import("./demo-data"), import("@/lib/api/candidates"),
  ]);
  // Candidates are the backend's (no candidates mock): the mocks just loaded read the test fixture through it.
  stubCandidateReads(candidatesModule.candidatesApi);
  if (email) await signIn.signInAs(email);
  return { db, signIn, applications, documents, inbox, demo };
}
const stored = () => JSON.parse(storage.getItem(KEY) ?? "null") as { version: string; seededAt: string; tables: Record<string, unknown[]> } | null;
const ADNAN = "user_adnan"; // seeded account ids (./sign-in-as.ts)
const FATIMA = "user_fatima";
const SANA = "padm_sana";

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
    first.signIn.signOutForTest();
    expect(Object.keys(stored()!.tables)).toEqual(["applications"]);

    const second = await load(at(1), FATIMA); // next day, another account in the same browser
    const moved = await second.applications.applicationsMock.byId("firm_hts", "app_001");
    expect(before).not.toBe("WITHDRAWN");
    expect(moved.status).toBe("WITHDRAWN");
    expect(moved.events.at(-1)).toMatchObject({ note: "persist me", actorUserId: "user_adnan" });
    expect(stored()!.seededAt).toBe(T0);
  });

  it("persists every write the mock backend accepts, in the table it changed", async () => {
    // The manager: the profile edit is the owner's and manager's (07 Q56); documents and the inbox are theirs too.
    const m = await load(T0, FATIMA);
    const candidate = fixtureCandidates.find((c) => c.firmId === "firm_hts")!;

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

    const reloaded = await load(at(1), ADNAN);
    expect(reloaded.inbox.allMessages.find((row) => row.id === message.id)?.isRead).toBe(true);
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

describe("inbox fixture dates once the data persists (docs/03 §3.3)", () => {
  it("anchors inbox connections to the seeding instant (12 days before it), and keeps them across reloads", async () => {
    const seeded = await load(T0, ADNAN);
    const connectedId = (await import("./data/inbox.json")).default.initiallyConnected[0] as string;
    const firmId = fixtureCandidates.find((c) => c.id === connectedId)!.firmId;
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
