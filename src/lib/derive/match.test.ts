import { describe, expect, it } from "vitest";
import { isJobForCandidate, matchFor, rankJobsForCandidate } from "./match";

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

describe("matchFor and the ranking read the stored Match (decided 2026-11-14; no placeholder, Q40)", () => {
  const job = (id: string, matches: Record<string, { score: number | null; note: string | null }>) =>
    ({ id, isActive: true, dedupe: { duplicateOfJobId: null }, candidateIds: ["cand_01"], allowedWorkAuth: [], matches }) as unknown as Parameters<typeof rankJobsForCandidate>[1][number];

  it("is the candidate's stored score and note, or null when there's none or no candidate", () => {
    const held = job("j1", { cand_01: { score: 40, note: "no C2C" } });
    expect(matchFor(held, "cand_01")).toEqual({ score: 40, note: "no C2C" });
    expect(matchFor(held, "cand_02")).toBeNull();
    expect(matchFor(held, null)).toBeNull();
    expect(matchFor(job("j2", { cand_01: { score: null, note: null } }), "cand_01")).toBeNull();
  });

  it("ranks best first, unscored last, applied left out", () => {
    const jobs = [job("low", { cand_01: { score: 40, note: "no C2C" } }), job("none", {}), job("high", { cand_01: { score: 91, note: null } }),
      job("applied", { cand_01: { score: 99, note: null } })];
    const ranked = rankJobsForCandidate({ ...candidate, workAuth: "H1B" } as Parameters<typeof rankJobsForCandidate>[0], jobs, new Set(["applied"]), 5);
    expect(ranked.map((r) => [r.job.id, r.score, r.note])).toEqual([["high", 91, null], ["low", 40, "no C2C"], ["none", null, null]]);
  });
});
