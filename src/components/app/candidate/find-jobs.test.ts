import { describe, expect, it } from "vitest";
import type { JobSearch, JobSearches } from "@/lib/schemas/job-search";
import { blockedReason, searchOutcome, searchRole, usageLine } from "./find-jobs";

const search = (over: Partial<JobSearch> = {}): JobSearch => ({
  id: "b1", kind: "SEARCH", state: "SUCCESS", query: "Java Developer", newCount: 12, seenAgainCount: 3, overLimitCount: 0,
  errorCode: null, startedAt: "2026-11-11T14:00:00.000Z", finishedAt: "2026-11-11T14:00:09.000Z", ...over,
});
const searches = (over: Partial<JobSearches["usage"]> = {}): JobSearches => ({
  running: null, searches: [],
  usage: { jobsToday: 47, jobsCap: 100, searchesToday: 3, searchesCap: 20, capturesToday: 2, capturesCap: 20, resetsAt: "2026-11-12T13:00:00.000Z", ...over },
});
const candidate = { primaryRole: "Java Developer", targetRoles: ["Backend Engineer"], country: "US" };

describe("Find jobs (docs/02 §6.z)", () => {
  it("searches the main role, else the first target role", () => {
    expect(searchRole(candidate)).toBe("Java Developer");
    expect(searchRole({ primaryRole: null, targetRoles: [" ", "Backend Engineer"] })).toBe("Backend Engineer");
    expect(searchRole({ primaryRole: "", targetRoles: [] })).toBeNull();
  });

  it("says what a search did", () => {
    expect(searchOutcome(search(), 100)).toBe("12 new · 3 seen again");
    expect(searchOutcome(search({ overLimitCount: 5 }), 100)).toBe("12 new · 3 seen again · 5 over today's 100");
    expect(searchOutcome(search({ state: "EMPTY", newCount: 0, seenAgainCount: 0 }), 100)).toBe("No new jobs for Java Developer right now.");
    expect(searchOutcome(search({ state: "ERROR", errorCode: "timeout" }), 100)).toBe("The job source didn't answer in time. Try again.");
  });

  it("shows today's usage, with the reset in IST", () => {
    expect(usageLine(searches())).toBe("47/100 jobs · 3/20 searches · 2/20 captures · resets 6:30 PM IST");
    expect(usageLine(searches({ searchesToday: null, capturesToday: null }))).toBe("47/100 jobs · resets 6:30 PM IST");
  });

  it("is disabled with the reason: no role, no country, or the day's searches used", () => {
    expect(blockedReason(candidate, searches())).toBeNull();
    expect(blockedReason({ ...candidate, primaryRole: null, targetRoles: [] }, searches())).toBe("Add a target role first");
    expect(blockedReason({ ...candidate, country: null }, searches())).toBe("Add the candidate's country on their résumé");
    expect(blockedReason(candidate, searches({ searchesToday: 20 }))).toBe("20/20 searches today · resets 6:30 PM IST");
  });
});
