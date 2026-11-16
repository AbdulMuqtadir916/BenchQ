import { describe, expect, it } from "vitest";
import { candidateLabel } from "./candidate-label";

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
