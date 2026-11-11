import { describe, expect, it } from "vitest";
import { candidateListShortcuts } from "./list-shortcuts";

describe("Candidates shortcuts", () => {
  it("describes the list keys and includes New candidate when available", () => {
    expect(candidateListShortcuts(true).flatMap((hint) => hint.keys))
      .toEqual(expect.arrayContaining(["J", "K", "Enter", "X", "/", "N"]));
  });

  it("omits New candidate for users who can't open it", () => {
    expect(candidateListShortcuts(false).flatMap((hint) => hint.keys)).not.toContain("N");
  });
});
