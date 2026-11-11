import { describe, expect, it } from "vitest";
import { paletteResults } from "./palette-results";

const entries = [
  { id: "nav", group: "Navigation", label: "Jobs" },
  { id: "job", group: "Jobs", label: "Engineer", keywords: "Acme" },
  { id: "action", group: "Actions", label: "New application" },
  { id: "candidate", group: "Candidates", label: "Ravi", keywords: "Java developer" },
] as const;

describe("palette results", () => {
  it("orders the groups and only shows accessible recent commands with no query", () => {
    expect(paletteResults(entries, "", ["missing", "candidate"]).map(({ id, group }) => [id, group])).toEqual([
      ["action", "Actions"], ["candidate", "Recent"], ["job", "Jobs"], ["nav", "Navigation"],
    ]);
    expect(paletteResults(entries, "java rav", ["candidate"])).toEqual([entries[3]]);
  });
});
