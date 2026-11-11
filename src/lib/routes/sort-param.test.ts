import { describe, expect, it } from "vitest";
import { formatSort, parseSort } from "./sort-param";

/** A list's sort as one URL value: the column id, with a leading `-` for descending (BUG-019). */
const columns = ["name", "apps", "lastActivity"] as const;

describe("parseSort", () => {
  it("reads ascending and descending", () => {
    expect(parseSort("apps", columns)).toEqual({ id: "apps", desc: false });
    expect(parseSort("-apps", columns)).toEqual({ id: "apps", desc: true });
    expect(parseSort("-lastActivity", columns)).toEqual({ id: "lastActivity", desc: true });
  });

  it("no sort, or a column the list does not have, is no sort (a stale or hand-typed URL never breaks the list)", () => {
    expect(parseSort("", columns)).toBeNull();
    expect(parseSort("nope", columns)).toBeNull();
    expect(parseSort("-nope", columns)).toBeNull();
    expect(parseSort("--apps", columns)).toBeNull();
    expect(parseSort("-", columns)).toBeNull();
  });
});

describe("formatSort", () => {
  it("is the inverse of parseSort", () => {
    expect(formatSort({ id: "apps", desc: false })).toBe("apps");
    expect(formatSort({ id: "apps", desc: true })).toBe("-apps");
    expect(formatSort(null)).toBe("");
    for (const raw of ["name", "-name", "lastActivity", "-lastActivity"]) expect(formatSort(parseSort(raw, columns))).toBe(raw);
  });
});
