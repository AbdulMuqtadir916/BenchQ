import { describe, expect, it } from "vitest";
import { isJobForCandidate } from "./match";

const candidate = { id: "cand_01", workAuth: "H1B" as const };

describe("isJobForCandidate (docs/02 §6.z)", () => {
  it("a job found for the candidate, with their work authorization allowed or unknown, is theirs to see", () => {
    expect(isJobForCandidate({ candidateIds: ["cand_01"], allowedWorkAuth: ["H1B", "GC"] }, candidate)).toBe(true);
    expect(isJobForCandidate({ candidateIds: ["cand_01"], allowedWorkAuth: [] }, candidate)).toBe(true);
  });

  it("a job that refuses their work authorization, or was found for someone else, isn't", () => {
    expect(isJobForCandidate({ candidateIds: ["cand_01"], allowedWorkAuth: ["USC", "GC"] }, candidate)).toBe(false);
    expect(isJobForCandidate({ candidateIds: ["cand_02"], allowedWorkAuth: [] }, candidate)).toBe(false);
    expect(isJobForCandidate({ candidateIds: [], allowedWorkAuth: [] }, candidate)).toBe(false);
  });
});
