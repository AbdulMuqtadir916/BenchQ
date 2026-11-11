import { describe, expect, it } from "vitest";
import { loadAllPages } from "./paging";

/**
 * BUG-022: the Ledger page asked for the latest 100 entries, so the 19 older ones of a 119-entry ledger could not be reached on
 * an audit screen. `loadAllPages` reads a list that the backend serves in pages (`offset` + `limit`) until it runs out, up to a cap
 * so that a huge ledger cannot freeze the page, and says whether more exist beyond the cap.
 */
function source(total: number) {
  const all = Array.from({ length: total }, (_, i) => i + 1);
  const calls: Array<[number, number]> = [];
  return { calls, fetchPage: async (offset: number, limit: number) => { calls.push([offset, limit]); return all.slice(offset, offset + limit); }, all };
}
const options = { pageSize: 500, maxItems: 2000 };

describe("loadAllPages", () => {
  it("a list that fits in one page is read once, and nothing is left out (119 entries, the case that was cut to 100)", async () => {
    const s = source(119);
    const result = await loadAllPages(s.fetchPage, options);
    expect(result.items).toEqual(s.all);
    expect(result.hasMore).toBe(false);
    expect(s.calls).toEqual([[0, 500]]);
  });

  it("reads page after page until a short page, keeping the order", async () => {
    const s = source(1250);
    const result = await loadAllPages(s.fetchPage, options);
    expect(result.items).toEqual(s.all);
    expect(result.hasMore).toBe(false);
    expect(s.calls).toEqual([[0, 500], [500, 500], [1000, 500]]);
  });

  it("a list that is exactly a whole number of pages ends on an empty page, not an endless loop", async () => {
    const s = source(500);
    const result = await loadAllPages(s.fetchPage, options);
    expect(result.items).toHaveLength(500);
    expect(result.hasMore).toBe(false);
    expect(s.calls).toEqual([[0, 500], [500, 500]]);
  });

  it("an empty list is empty", async () => {
    const result = await loadAllPages(source(0).fetchPage, options);
    expect(result).toEqual({ items: [], hasMore: false });
  });

  it("stops at the cap and says more exist when they do", async () => {
    const s = source(2500);
    const result = await loadAllPages(s.fetchPage, options);
    expect(result.items).toEqual(s.all.slice(0, 2000));
    expect(result.hasMore).toBe(true);
    expect(s.calls).toEqual([[0, 500], [500, 500], [1000, 500], [1500, 500], [2000, 1]]);
  });

  it("a list that is exactly the cap is not reported as cut", async () => {
    const result = await loadAllPages(source(2000).fetchPage, options);
    expect(result.items).toHaveLength(2000);
    expect(result.hasMore).toBe(false);
  });

  it("a failing page fails the whole read, so a partial list is never shown as if it were complete", async () => {
    let calls = 0;
    const fetchPage = async (offset: number, limit: number) => {
      if (++calls === 2) throw new Error("boom");
      return Array.from({ length: limit }, (_, i) => offset + i);
    };
    await expect(loadAllPages(fetchPage, options)).rejects.toThrow("boom");
  });
});
