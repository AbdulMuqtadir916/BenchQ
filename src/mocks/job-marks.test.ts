import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase B fix PR 2 (audit W3): the job explorer's Save / Hide persist, per person (docs/02 §6.x). A
 * VIEWER and a support view are refused the writes (write-authorization.test.ts) and read no marks.
 */

class StubStorage {
  items = new Map<string, string>();
  getItem(key: string) { return this.items.get(key) ?? null; }
  setItem(key: string, value: string) { this.items.set(key, value); }
  removeItem(key: string) { this.items.delete(key); }
  clear() { this.items.clear(); }
}

type Globals = { __BENCHQ_DEMO_STORAGE__?: Storage | null };
const g = globalThis as Globals;
const FIRM = "firm_hts";
const EMAIL = { adnan: "user_adnan", sneha: "user_sneha", rohan: "user_rohan", sana: "padm_sana" };

async function load(email: string) {
  vi.resetModules();
  const [db, signIn, marks] = await Promise.all([import("./db"), import("./sign-in-as"), import("./job-marks")]);
  await signIn.signInAs(email);
  return { db, marks: marks.jobMarksMock, signIn: signIn.signInAs, supportView: signIn.signInAsSupportView };
}

const kinds = (rows: { jobId: string; kind: string }[]) => rows.map((row) => `${row.jobId}:${row.kind}`).sort();

beforeAll(() => {
  process.env.NEXT_PUBLIC_MOCK_DELAY_MS = "0";
});
beforeEach(() => {
  g.__BENCHQ_DEMO_STORAGE__ = new StubStorage() as unknown as Storage;
});
afterEach(() => {
  delete g.__BENCHQ_DEMO_STORAGE__;
});

describe("job marks", () => {
  it("a BDE saves and hides jobs; they are still there after a reload", async () => {
    const m = await load(EMAIL.adnan);
    await m.marks.mark(FIRM, "job_001", "SAVED");
    await m.marks.mark(FIRM, "job_002", "HIDDEN");
    await m.marks.mark(FIRM, "job_001", "SAVED"); // again: no duplicate
    expect(kinds(await m.marks.list(FIRM))).toEqual(["job_001:SAVED", "job_002:HIDDEN"]);
    m.db.flush();

    const later = await load(EMAIL.adnan);
    expect(kinds(await later.marks.list(FIRM))).toEqual(["job_001:SAVED", "job_002:HIDDEN"]);
    await later.marks.unmark(FIRM, "job_002", "HIDDEN");
    expect(kinds(await later.marks.list(FIRM))).toEqual(["job_001:SAVED"]);
  });

  it("marks are personal: another BDE doesn't see them, and their own don't touch yours", async () => {
    const m = await load(EMAIL.adnan);
    await m.marks.mark(FIRM, "job_001", "HIDDEN");
    await m.signIn(EMAIL.sneha);
    expect(await m.marks.list(FIRM)).toEqual([]);
    await m.marks.mark(FIRM, "job_003", "SAVED");
    await m.marks.unmark(FIRM, "job_001", "HIDDEN"); // not hers: nothing happens
    await m.signIn(EMAIL.adnan);
    expect(kinds(await m.marks.list(FIRM))).toEqual(["job_001:HIDDEN"]);
  });

  it("only a job of the firm can be marked", async () => {
    const m = await load(EMAIL.adnan);
    await expect(m.marks.mark(FIRM, "job_nope", "SAVED")).rejects.toMatchObject({ status: 404 });
  });

  it("a VIEWER reads no marks of anyone else; a support view reads none at all and can't write", async () => {
    const m = await load(EMAIL.adnan);
    await m.marks.mark(FIRM, "job_001", "SAVED");
    await m.signIn(EMAIL.rohan);
    expect(await m.marks.list(FIRM)).toEqual([]);
    await expect(m.marks.mark(FIRM, "job_001", "SAVED")).rejects.toMatchObject({ status: 403 });

    await m.signIn(EMAIL.sana);
    await m.supportView(EMAIL.sana, FIRM);
    expect(await m.marks.list(FIRM)).toEqual([]);
    await expect(m.marks.unmark(FIRM, "job_001", "SAVED")).rejects.toMatchObject({ status: 403 });
  });
});
