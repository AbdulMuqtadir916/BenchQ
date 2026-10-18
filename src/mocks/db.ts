import type { z } from "zod";
import { arrayOf } from "@/lib/api/client";

/**
 * The mock backend's database (docs/03 §3.3): the demo data persists in this browser like a real
 * app's. The fixtures seed it on first load; after that every change (an application moved, a
 * document uploaded, an invite accepted…) survives reloads and sign-outs, for every account here.
 *
 * Storage: one versioned localStorage key holding `{ version, seededAt, tables }`. Only tables that
 * changed are stored (the fixtures are ~3.5 MB, too much to rewrite on every change); a table absent
 * from storage is still the fixture. Each table is validated against its schema when read.
 *
 * - **Version:** `FIXTURE_VERSION` is a fingerprint of src/mocks/data/*.json, checked by db.test.ts. When
 *   the fixtures change the fingerprint changes, and every browser reseeds on its next load.
 * - **seededAt:** the instant this browser's data was seeded. Fixture dates written relative to "now"
 *   (invites, inbox connections) are placed relative to it once, then age like real dates.
 * - **Tabs:** a change saved in one tab refreshes the tables in the others (storage event), so two tabs
 *   can't overwrite each other's changes; `watchDemoData` tells the client to refetch.
 * - **Tests** never read persisted data: under the test runner storage is off unless a test installs a
 *   stub (globalThis.__BENCHQ_DEMO_STORAGE__), and the clock can be pinned (__BENCHQ_DEMO_NOW__).
 *
 * Mock data, not a database: Phase D replaces it with the backend's.
 */

/** sha256 of src/mocks/data/*.json (first 16 hex). db.test.ts recomputes it: update it with the fixtures. */
export const FIXTURE_VERSION = "c8f6f6b487e4b892";

const STORAGE_KEY = "benchq.demo-data";

/** Tables that can change. A new writable table registers here and calls `changed()` after writing. */
export type TableName = "firms" | "users" | "invites" | "candidates" | "applications" | "documents" | "inboxMessages" | "inboxConnections" | "ledger";

interface Snapshot {
  version: string;
  seededAt: string;
  tables: Partial<Record<TableName, unknown[]>>;
}

interface TableDef {
  rows: unknown[];
  schema: z.ZodType;
  seed: () => unknown[];
}

type TestGlobals = { __BENCHQ_DEMO_STORAGE__?: Storage | null; __BENCHQ_DEMO_NOW__?: string };
const testGlobals = globalThis as TestGlobals;

function storage(): Storage | null {
  if (process.env.NODE_ENV === "test") return testGlobals.__BENCHQ_DEMO_STORAGE__ ?? null;
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

function now(): Date {
  if (process.env.NODE_ENV === "test" && testGlobals.__BENCHQ_DEMO_NOW__) return new Date(testGlobals.__BENCHQ_DEMO_NOW__);
  return new Date();
}

function readSnapshot(): Snapshot | null {
  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Snapshot>;
    if (parsed.version !== FIXTURE_VERSION || typeof parsed.seededAt !== "string" || typeof parsed.tables !== "object" || !parsed.tables) return null;
    return parsed as Snapshot;
  } catch {
    return null;
  }
}

/**
 * Whether the last save failed because storage is full (or blocked). The change itself is kept in
 * memory, so this tab still shows it; it is lost on reload unless a later save succeeds (every save
 * writes all changed tables, so the next one retries). The app shows "Demo storage is full…" meanwhile.
 */
let storageFull = false;
const storageListeners = new Set<(full: boolean) => void>();
function setStorageFull(full: boolean): void {
  if (storageFull === full) return;
  storageFull = full;
  for (const listener of storageListeners) listener(full);
}

function writeSnapshot(value: Snapshot): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(value));
    setStorageFull(false);
  } catch {
    // QuotaExceededError (or blocked storage): keep the change in memory and say so.
    setStorageFull(true);
  }
}

/** Call `onChange(full)` now and whenever saving starts or stops failing for lack of space. */
export function watchStorageFull(onChange: (full: boolean) => void): () => void {
  storageListeners.add(onChange);
  onChange(storageFull);
  return () => storageListeners.delete(onChange);
}

const freshSnapshot = (): Snapshot => ({ version: FIXTURE_VERSION, seededAt: now().toISOString(), tables: {} });

let snapshot: Snapshot | null = null;
/** The current snapshot. First use reads storage; with none (or another fixture version) it seeds now. */
function current(): Snapshot {
  if (snapshot) return snapshot;
  snapshot = readSnapshot();
  if (!snapshot) {
    snapshot = freshSnapshot();
    writeSnapshot(snapshot); // fixes seededAt for this browser, so relative fixture dates don't move on reload
  }
  return snapshot;
}

/** When this browser's demo data was seeded: the anchor for fixture dates written relative to "now". */
export function seededAt(): Date {
  return new Date(current().seededAt);
}

const tables = new Map<TableName, TableDef>();

function rowsFor(name: TableName, def: Omit<TableDef, "rows">): unknown[] {
  const stored = current().tables[name];
  if (!stored) return def.seed();
  const parsed = arrayOf(def.schema).safeParse(stored);
  if (parsed.success) return parsed.data;
  // A stored table that no longer fits its schema: drop it and use the fixture.
  delete current().tables[name];
  return def.seed();
}

/**
 * A persisted table: the stored rows if this browser has changed them, otherwise the fixture (`seed`).
 * The returned array is the live table; mutate it, then call `changed(name)`.
 */
export function table<T>(name: TableName, schema: z.ZodType<T>, seed: () => T[]): T[] {
  const def = { schema: schema as z.ZodType, seed: seed as () => unknown[] };
  const rows = rowsFor(name, def) as T[];
  tables.set(name, { ...def, rows });
  ensureWatching();
  return rows;
}

const dirty = new Set<TableName>();
let saveScheduled = false;

/** Mark tables as changed: they are saved (debounced, together) and survive reloads. */
export function changed(...names: TableName[]): void {
  for (const name of names) dirty.add(name);
  if (saveScheduled) return;
  saveScheduled = true;
  queueMicrotask(flush);
}

/** Save the changed tables now (tests call it instead of waiting for the microtask). */
export function flush(): void {
  saveScheduled = false;
  if (dirty.size === 0) return;
  const snap = current();
  for (const name of dirty) {
    const def = tables.get(name);
    if (def) snap.tables[name] = def.rows;
  }
  dirty.clear();
  writeSnapshot(snap);
}

/** Replace every loaded table's rows in place (the arrays are shared by the mock modules). */
function reload(next: Snapshot): void {
  snapshot = next;
  for (const [name, def] of tables) {
    const rows = rowsFor(name, def);
    def.rows.splice(0, def.rows.length, ...rows);
  }
}

const listeners = new Set<() => void>();
function notify(): void {
  for (const listener of listeners) listener();
}

/**
 * Wipe every change in this browser and reseed from the fixtures (relative dates re-anchored to now).
 * Other tabs follow through the storage event.
 */
export function resetDemoData(): void {
  dirty.clear();
  const next = freshSnapshot();
  writeSnapshot(next);
  reload(next);
  notify();
}

let watching = false;
function ensureWatching(): void {
  if (watching || typeof window === "undefined" || typeof window.addEventListener !== "function") return;
  watching = true;
  window.addEventListener("storage", (event: Event) => {
    const key = (event as Event & { key?: string | null }).key;
    if (key !== STORAGE_KEY && key !== null) return;
    // Another tab saved, reset or cleared the data: take its version.
    const stored = readSnapshot();
    const next = stored ?? freshSnapshot();
    if (!stored) writeSnapshot(next);
    reload(next);
    notify();
  });
}

/** Call `onChange` after the data changed underneath this tab (another tab's change, or a reset). */
export function watchDemoData(onChange: () => void): () => void {
  ensureWatching();
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}
