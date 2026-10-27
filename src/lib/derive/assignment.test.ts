import { describe, expect, it } from "vitest";
import { allCandidates } from "@/mocks/candidates";
import type { Candidate } from "@/lib/schemas/candidate";
import type { LedgerEntry } from "@/lib/schemas/analytics";
import { deriveNewAssignments, isWaitingForBde, latestHandoff, queueByManager } from "./assignment";

const NOW = new Date("2026-10-27T18:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
const base = allCandidates[0]!;
const candidate = (id: string, overrides: Partial<Candidate> = {}): Candidate => ({ ...base, id, managerId: "user_fatima", bdeId: "user_adnan", status: "ON_BENCH", ...overrides });

let sequence = 0;
const assign = (candidateId: string, at: string, note: string | null = null): LedgerEntry => ({
  id: `led_${sequence++}`, firmId: "firm_hts", actorUserId: "user_fatima", actorType: "USER", actorName: "Fatima Reddy", entityType: "candidate",
  entityId: candidateId, entityLabel: candidateId, action: "ASSIGN", summary: "Assigned", note, modelId: null, promptVersion: null,
  evidenceIds: [], claimState: null, createdAt: at,
});

describe("the Needs a BDE queue (07 Q42)", () => {
  it("is the working candidates without a BDE, counted per manager", () => {
    const candidates = [
      candidate("c1", { bdeId: null }),
      candidate("c2", { bdeId: null, status: "INTERVIEWING" }),
      candidate("c3", { bdeId: null, status: "PLACED" }),
      candidate("c4", { bdeId: null, managerId: "user_priya" }),
      candidate("c5"),
    ];
    expect(candidates.filter(isWaitingForBde).map((c) => c.id)).toEqual(["c1", "c2", "c4"]);
    expect(Object.fromEntries(queueByManager(candidates))).toEqual({ user_fatima: 2, user_priya: 1 });
  });
});

describe("New assignments (A5)", () => {
  it("shows a 6-day-old assignment and not an 8-day-old one, newest first", () => {
    const candidates = [candidate("c1"), candidate("c2"), candidate("c3")];
    const entries = [assign("c1", daysAgo(6)), assign("c2", daysAgo(8)), assign("c3", daysAgo(1))];
    expect(deriveNewAssignments("user_adnan", candidates, entries, NOW).map((item) => item.candidate.id)).toEqual(["c3", "c1"]);
  });

  it("reads only the latest ASSIGN: an old move followed by a recent one counts, a recent one followed by nothing new does too", () => {
    const entries = [assign("c1", daysAgo(20)), assign("c1", daysAgo(2), "Push banking.")];
    expect(deriveNewAssignments("user_adnan", [candidate("c1")], entries, NOW)).toEqual([expect.objectContaining({ entry: expect.objectContaining({ note: "Push banking." }) })]);
  });

  it("drops a candidate reassigned away, and ignores other actions and other BDEs", () => {
    const entries = [assign("c1", daysAgo(1)), { ...assign("c2", daysAgo(1)), action: "UPDATE" as const }];
    expect(deriveNewAssignments("user_adnan", [candidate("c1", { bdeId: "user_sneha" }), candidate("c2")], entries, NOW)).toEqual([]);
    expect(deriveNewAssignments("user_sneha", [candidate("c1", { bdeId: "user_sneha" })], entries, NOW)).toHaveLength(1);
  });
});

describe("the handoff note on the candidate page (05 §6)", () => {
  it("is the latest ASSIGN's note, or nothing when the latest move had none", () => {
    expect(latestHandoff("c1", [assign("c1", daysAgo(3), "First"), assign("c1", daysAgo(1), "Second")])?.note).toBe("Second");
    expect(latestHandoff("c1", [assign("c1", daysAgo(3), "First"), assign("c1", daysAgo(1))])).toBeNull();
    expect(latestHandoff("c1", [assign("c2", daysAgo(1), "Other")])).toBeNull();
  });
});
