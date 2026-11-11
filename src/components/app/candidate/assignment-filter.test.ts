import { describe, expect, it } from "vitest";
import { CandidatesSearch } from "@/lib/schemas/list-search";

/**
 * The candidates list's URL (CLAUDE.md: filters, tabs and pagination live in the URL, parsed with Zod).
 * BUG-002: no `page`. BUG-019: the status filter, the search and the sort were not in it either.
 */
const defaults = { assignment: "all", status: "ALL", q: "", sort: "", page: 1 };

describe("CandidatesSearch", () => {
  it("a clean URL is the default view: all candidates, every status, no search, no sort, page 1", () => {
    expect(CandidatesSearch.parse({})).toMatchObject(defaults);
  });

  it("reads the page, the assignment, the status, the search and the sort", () => {
    expect(CandidatesSearch.parse({ page: "2" }).page).toBe(2);
    expect(CandidatesSearch.parse({ assignment: "needs-bde", status: "ON_BENCH", q: "meera krishnan", sort: "-apps", page: "2" }))
      .toMatchObject({ assignment: "needs-bde", status: "ON_BENCH", q: "meera krishnan", sort: "-apps", page: 2 });
  });

  it("a hand-edited or stale page falls back to page 1 instead of breaking the list", () => {
    for (const page of ["abc", "0", "-3", "1.5", ""]) expect(CandidatesSearch.parse({ page }).page, page).toBe(1);
  });

  it("a status that does not exist falls back to every status", () => {
    for (const status of ["nope", "on_bench", "ALL ", ""]) expect(CandidatesSearch.parse({ status }).status, status).toBe("ALL");
    for (const status of ["ALL", "ON_BENCH", "INTERVIEWING", "OFFER", "PLACED", "PAUSED", "INACTIVE"]) {
      expect(CandidatesSearch.parse({ status }).status, status).toBe(status);
    }
  });

  it("a sort that is not a column id with an optional leading minus falls back to no sort", () => {
    for (const sort of ["--apps", "a b", "apps;drop", "-", "apps/x"]) expect(CandidatesSearch.parse({ sort }).sort, sort).toBe("");
    expect(CandidatesSearch.parse({ sort: "lastActivity" }).sort).toBe("lastActivity");
  });

  it("one bad value does not take the others with it", () => {
    expect(CandidatesSearch.parse({ assignment: "nope", status: "nope", sort: "--x", q: "meera", page: "3" }))
      .toMatchObject({ assignment: "all", status: "ALL", q: "meera", sort: "", page: 3 });
  });
});
