import { describe, expect, it } from "vitest";
import type { JobSearch, JobSearches } from "@/lib/schemas/job-search";
import { blockedReason, placeLabel, resetTime, searchOutcome, searchRole, usageLine } from "./find-jobs";

const search = (over: Partial<JobSearch> = {}): JobSearch => ({
  id: "b1", kind: "SEARCH", state: "SUCCESS", query: "Java Developer", place: "Austin, TX", newCount: 12, seenAgainCount: 3, overLimitCount: 0,
  leftOutWorkAuthCount: 0, leftOutOldCount: 0, leftOutNotRemoteCount: 0, leftOutAdzunaCount: 0, leftOutLevelCount: 0, newBySource: {}, failedSources: [],
  errorCode: null, startedAt: "2026-11-11T14:00:00.000Z", finishedAt: "2026-11-11T14:00:09.000Z", workDate: "2026-11-11", day: 1, batch: 1, ...over,
});
const searches = (over: Partial<JobSearches["usage"]> = {}, places: JobSearches["places"] = [{ value: "Austin, TX", label: "Austin, TX", kind: "home" }]): JobSearches => ({
  running: null, searches: [],
  usage: { jobsToday: 47, jobsCap: 100, searchesToday: 3, searchesCap: 20, capturesToday: 2, capturesCap: 20, resetsAt: "2026-11-12T13:00:00.000Z", ...over },
  role: "Backend Engineer", places,
  workday: { start: "18:30", end: "04:00", timezone: "Asia/Kolkata", dayOne: "2026-11-11", today: "2026-11-11", todayDay: 1, daysWorked: [1] },
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

  it("says only what the BDE can act on: a failed search, or a source that didn't answer (2026-11-17)", () => {
    expect(searchOutcome(search({ overLimitCount: 5, leftOutLevelCount: 7, newBySource: { linkedin: 9 } }))).toBeNull();
    expect(searchOutcome(search({ state: "EMPTY", newCount: 0, seenAgainCount: 0 }))).toBeNull();
    expect(searchOutcome(search({ state: "ERROR", errorCode: "timeout" }))).toBe("The job source didn't answer in time. Try again.");
    expect(searchOutcome(search({ failedSources: ["linkedin", "indeed"] }))).toBe("LinkedIn, Indeed didn't answer: try again");
  });

  it("shows the work day's usage, with the reset in the firm's time zone", () => {
    expect(usageLine(searches())).toBe("47/100 jobs · 3/20 searches · 2/20 added manually · resets 6:30 PM IST");
    expect(usageLine(searches({ searchesToday: null, capturesToday: null }))).toBe("47/100 jobs · resets 6:30 PM IST");
    expect(resetTime("2026-11-12T14:00:00.000Z", "America/New_York")).toBe("9:00 AM EST");
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
  it("names a source that didn't answer, never each source's count", () => {
    expect(searchOutcome(search({ newBySource: { linkedin: 58, indeed: 30, freehire: 12 }, seenAgainCount: 0 }))).toBeNull();
    expect(searchOutcome(search({ newBySource: { indeed: 4 }, seenAgainCount: 0, failedSources: ["linkedin"] }))).toBe("LinkedIn didn't answer: try again");
  });

  it("names a hybrid search's place without its mode", () => {
    expect(placeLabel("hybrid:Austin, TX")).toBe("Austin, TX");
  });
});
