import { describe, expect, it } from "vitest";
import { candidateLabel, candidateOptions, PICKED_CANDIDATE } from "./candidate-label";

describe("candidateLabel", () => {
  it("is a dash for an entry about no candidate", () => {
    expect(candidateLabel({ candidateId: null, candidateName: null })).toBe("—");
    expect(candidateLabel({})).toBe("—");
  });

  it("is the candidate's name", () => {
    expect(candidateLabel({ candidateId: "c1", candidateName: "Asha Rao" })).toBe("Asha Rao");
  });

  it("is a plain label, never a blank, for a candidate with no name or one that can't be found", () => {
    expect(candidateLabel({ candidateId: "c1", candidateName: "" })).toBe("Unnamed candidate");
    expect(candidateLabel({ candidateId: "c1", candidateName: "   " })).toBe("Unnamed candidate");
    expect(candidateLabel({ candidateId: "c1", candidateName: null })).toBe("Unnamed candidate");
  });
});

describe("the candidate picker's options (issue #152)", () => {
  const list = [{ id: "c1", name: "Asha Rao" }];
  it("lists all candidates, then the list", () => {
    expect(candidateOptions(list, undefined, []).map((option) => option.label)).toEqual(["All candidates", "Asha Rao"]);
    expect(candidateOptions(list, "c1", [])).toHaveLength(2);
  });
  it("keeps the picked candidate when the list doesn't have them, named from the rows on show", () => {
    expect(candidateOptions(list, "c2", [{ candidateId: "c2", candidateName: "Ravi Teja" }]).at(-1)).toEqual({ value: "c2", label: "Ravi Teja" });
    expect(candidateOptions(list, "c2", []).at(-1)).toEqual({ value: "c2", label: PICKED_CANDIDATE });
  });
});
