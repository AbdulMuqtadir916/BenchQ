import { describe, expect, it } from "vitest";
import type { JobSearch, JobSearches } from "@/lib/schemas/job-search";
import { blockedReason, placeLabel, searchOutcome, searchRole, usageLine } from "./find-jobs";

const search = (over: Partial<JobSearch> = {}): JobSearch => ({
  id: "b1", kind: "SEARCH", state: "SUCCESS", query: "Java Developer", place: "Austin, TX", newCount: 12, seenAgainCount: 3, overLimitCount: 0,
  leftOutWorkAuthCount: 0, leftOutOldCount: 0, leftOutNotRemoteCount: 0, leftOutAdzunaCount: 0, leftOutLevelCount: 0, newBySource: {}, failedSources: [],
  errorCode: null, startedAt: "2026-11-11T14:00:00.000Z", finishedAt: "2026-11-11T14:00:09.000Z", ...over,
});
const searches = (over: Partial<JobSearches["usage"]> = {}, places: JobSearches["places"] = [{ value: "Austin, TX", label: "Austin, TX", kind: "home" }]): JobSearches => ({
  running: null, searches: [],
  usage: { jobsToday: 47, jobsCap: 100, searchesToday: 3, searchesCap: 20, capturesToday: 2, capturesCap: 20, resetsAt: "2026-11-12T13:00:00.000Z", ...over },
  role: "Backend Engineer", places
});
const candidate = { targetRoles: ["Backend Engineer"], country: "US" };

describe("Find jobs (docs/02 §6.z)", () => {
  it("searches the target role only, the first one (decided 2026-11-14)", () => {
    expect(searchRole(candidate)).toBe("Backend Engineer");
    expect(searchRole({ targetRoles: [" ", " Backend   Engineer ", "Data Engineer"] })).toBe("Backend Engineer");
    expect(searchRole({ targetRoles: [] })).toBeNull();
  });

  it("names where a search looked", () => {
    expect(placeLabel("Austin, TX")).toBe("Austin, TX");
    expect(placeLabel("remote")).toBe("Remote");
    expect(placeLabel(null)).toBeNull();
  });

  it("says what a search did", () => {
    expect(searchOutcome(search(), 100)).toBe("12 new · 3 seen again");
    expect(searchOutcome(search({ overLimitCount: 5 }), 100)).toBe("12 new · 3 seen again · 5 over today's 100");
    expect(searchOutcome(search({ leftOutWorkAuthCount: 4, leftOutOldCount: 31, leftOutNotRemoteCount: 2 }), 100)).toBe(
      "12 new · 3 seen again · 4 left out: work authorization · 31 left out: posted over 14 days ago · 2 left out: not remote");
    expect(searchOutcome(search({ leftOutAdzunaCount: 3 }), 100)).toBe("12 new · 3 seen again · 3 left out: Adzuna preview");
    expect(searchOutcome(search({ leftOutLevelCount: 7 }), 100)).toBe("12 new · 3 seen again · 7 left out: level");
    expect(searchOutcome(search({ state: "EMPTY", newCount: 0, seenAgainCount: 0 }), 100)).toBe("No new jobs for Java Developer in Austin, TX right now.");
    expect(searchOutcome(search({ state: "EMPTY", place: "remote" }), 100)).toBe("No new jobs for Java Developer in Remote right now.");
    expect(searchOutcome(search({ state: "EMPTY", place: null }), 100)).toBe("No new jobs for Java Developer right now.");
    expect(searchOutcome(search({ state: "ERROR", errorCode: "timeout" }), 100)).toBe("The job source didn't answer in time. Try again.");
  });

  it("shows today's usage, with the reset in IST", () => {
    expect(usageLine(searches())).toBe("47/100 jobs · 3/20 searches · 2/20 captures · resets 6:30 PM IST");
    expect(usageLine(searches({ searchesToday: null, capturesToday: null }))).toBe("47/100 jobs · resets 6:30 PM IST");
  });

  it("is disabled with the reason: no role, no country, no place, the day's searches used, or the day's new jobs", () => {
    expect(blockedReason(candidate, searches())).toBeNull();
    expect(blockedReason({ ...candidate, targetRoles: [] }, searches())).toBe("Add a target role first");
    expect(blockedReason(candidate, searches({}, []))).toBe("Add a city and state on the résumé, or a preferred location");
    expect(blockedReason({ ...candidate, country: null }, searches())).toBe("Add the candidate's country on their résumé");
    expect(blockedReason(candidate, searches({ searchesToday: 20 }))).toBe("20/20 searches today · resets 6:30 PM IST");
    expect(blockedReason(candidate, searches({ jobsToday: 100 }))).toBe("100/100 new jobs today · resets 6:30 PM IST");
  });
});

describe("one click, several sources (decided 2026-11-17, Q90, Q93, Q122)", () => {
  it("says each source's new jobs and any source that didn't answer", () => {
    expect(searchOutcome(search({ newBySource: { linkedin: 58, indeed: 30, freehire: 12 }, seenAgainCount: 0 }), 200))
      .toBe("LinkedIn 58 · Indeed 30 · freehire.me 12 new");
    expect(searchOutcome(search({ newBySource: { indeed: 4 }, seenAgainCount: 0, failedSources: ["linkedin"] }), 200))
      .toBe("Indeed 4 new · LinkedIn didn't answer");
  });

  it("names a hybrid place", () => {
    expect(placeLabel("hybrid:Austin, TX")).toBe("Hybrid · Austin, TX");
  });
});
