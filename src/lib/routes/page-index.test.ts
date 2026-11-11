import { describe, expect, it } from "vitest";
import { pageIndexFor } from "./page-index";

/** BUG-002: the Candidates list kept its page only in the table's own state, so a reload went back to page 1. */
describe("pageIndexFor: the 1-based ?page= value as the table's 0-based index", () => {
  it("page 1 is index 0, page 2 is index 1", () => {
    expect(pageIndexFor(1, 24, 15)).toBe(0);
    expect(pageIndexFor(2, 24, 15)).toBe(1);
  });

  it("a page past the end lands on the last page that exists, never an empty one", () => {
    expect(pageIndexFor(9, 24, 15)).toBe(1);
    expect(pageIndexFor(3, 30, 15)).toBe(1); // exactly 2 pages
  });

  it("no rows (still loading, or filtered to nothing) is index 0 and does not lose the number in the URL", () => {
    expect(pageIndexFor(2, 0, 15)).toBe(0);
  });

  it("a nonsense number never goes below the first page", () => {
    expect(pageIndexFor(0, 24, 15)).toBe(0);
    expect(pageIndexFor(-4, 24, 15)).toBe(0);
  });
});
