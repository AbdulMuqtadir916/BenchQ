import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import demoIds from "./dto/demo-ids.json";

/**
 * `ledgerApi.listAll` on the live backend (BUG-022): the whole ledger, not the first page. The backend serves `limit` (1 to 500) and
 * a cursor, newest first; the adapter pages through them and reports whether entries remain beyond its cap.
 */
const { ledgerApi } = await import("./analytics");

const HTS = demoIds.firm_hts;
const wire = (n: number) => ({
  id: `6f1c0000-0000-4000-8000-${String(n).padStart(12, "0")}`, firm_id: HTS, actor_user_id: demoIds.user_imran, actor_type: "USER",
  actor_name: "Imran", entity_type: "candidate", entity_id: `6f1c0000-0000-4000-8000-${String(n).padStart(12, "0")}`, entity_label: `Row ${n}`,
  action: "UPDATE", summary: `Row ${n}`, model_id: null, prompt_version: null, created_at: "2026-10-23T10:00:00+00:00",
});

let total = 0;
const urls: string[] = [];

beforeEach(() => {
  urls.length = 0;
  vi.stubGlobal("fetch", async (url: string) => {
    urls.push(url);
    const params = new URL(url, "http://x").searchParams;
    const offset = Number(params.get("cursor_id")?.slice(-12) ?? 0);
    const limit = Number(params.get("limit") ?? 50);
    const rows = Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, i) => wire(offset + i + 1));
    return new Response(JSON.stringify(rows), { status: 200 });
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("ledgerApi.listAll", () => {
  it("reads every entry of a 119-entry ledger in one request (it used to stop at 100)", async () => {
    total = 119;
    const result = await ledgerApi.listAll("firm_hts");
    expect(result.items).toHaveLength(119);
    expect(result.hasMore).toBe(false);
    expect(urls).toEqual([`/api/firms/${HTS}/ledger?limit=500`]);
    expect(result.items[0]!.summary).toBe("Row 1");
    expect(result.items.at(-1)!.summary).toBe("Row 119");
  });

  it("pages with the backend's limit and last-row cursor, and keeps the order", async () => {
    total = 1230;
    const result = await ledgerApi.listAll("firm_hts");
    expect(result.items).toHaveLength(1230);
    expect(urls).toEqual([
      `/api/firms/${HTS}/ledger?limit=500`,
      `/api/firms/${HTS}/ledger?limit=500&cursor_at=2026-10-23T10%3A00%3A00%2B00%3A00&cursor_id=6f1c0000-0000-4000-8000-000000000500`,
      `/api/firms/${HTS}/ledger?limit=500&cursor_at=2026-10-23T10%3A00%3A00%2B00%3A00&cursor_id=6f1c0000-0000-4000-8000-000000001000`,
    ]);
    expect(result.items.map((e) => e.summary).slice(498, 502)).toEqual(["Row 499", "Row 500", "Row 501", "Row 502"]);
  });

  it("stops at its cap and says so when the ledger is longer", async () => {
    total = 2300;
    const result = await ledgerApi.listAll("firm_hts");
    expect(result.items).toHaveLength(2000);
    expect(result.hasMore).toBe(true);
  });

  it("carries the other filters (one record's history, one action) on every page", async () => {
    total = 700;
    await ledgerApi.listAll("firm_hts", { action: "ASSIGN" });
    expect(urls).toEqual([
      `/api/firms/${HTS}/ledger?limit=500&action=ASSIGN`,
      `/api/firms/${HTS}/ledger?limit=500&cursor_at=2026-10-23T10%3A00%3A00%2B00%3A00&cursor_id=6f1c0000-0000-4000-8000-000000000500&action=ASSIGN`,
    ]);
  });
});
