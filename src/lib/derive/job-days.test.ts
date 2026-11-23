import { describe, expect, it } from "vitest";
import type { JobSearch, JobSearchWorkday } from "@/lib/schemas/job-search";
import { ALL_DAYS, NEWEST, dayDates, dayOptions, readPick } from "./job-days";

const WORKDAY: JobSearchWorkday = { start: "18:30", end: "04:00", timezone: "Asia/Kolkata", dayOne: "2026-11-17", today: "2026-11-21", todayDay: 5, daysWorked: [1, 3] };

// 7:42 PM IST on a work date is 14:12 UTC.
const search = (id: string, day: number | null, batch: number | null, startedAt: string, over: Partial<JobSearch> = {}): JobSearch => ({
  id, kind: "SEARCH", state: "SUCCESS", query: "Java Developer", place: "Austin, TX", newCount: 3, seenAgainCount: 0, overLimitCount: 0,
  leftOutWorkAuthCount: 0, leftOutOldCount: 0, leftOutNotRemoteCount: 0, leftOutAdzunaCount: 0, leftOutLevelCount: 0, newBySource: {},
  failedSources: [], errorCode: null, startedAt, finishedAt: startedAt, workDate: null, day, batch, ...over,
});

const SEARCHES = [
  search("b1", 1, 1, "2026-11-17T14:12:00.000Z"),
  search("b2", 1, 2, "2026-11-17T16:00:00.000Z"),
  search("b3", 3, 3, "2026-11-19T14:12:00.000Z"),
  search("old", null, null, "2026-11-10T14:12:00.000Z"),
  search("running", null, null, "2026-11-21T14:00:00.000Z", { state: "RUNNING", finishedAt: null }),
  search("capture", null, null, "2026-11-19T15:00:00.000Z", { kind: "CAPTURE" }),
];

describe("the Day picker (decided 2026-11-17, Q156–Q174)", () => {
  it("groups batches under their Day, newest first, numbered on across Days", () => {
    const { options, newestBatchId } = dayOptions(SEARCHES, WORKDAY, { showEmptyDays: false });
    expect(newestBatchId).toBe("b3");
    expect(options.map((o) => o.label)).toEqual([
      "Day 3 · Nov 19–20", "Batch 3 · 7:42 PM",
      "Day 1 · Nov 17–18", "Batch 2 · 9:30 PM", "Batch 1 · 7:42 PM",
      "Earlier searches", "Nov 10, 7:42 PM",
      "All days",
    ]);
    expect(options[1]).toMatchObject({ value: NEWEST, indent: true });
    expect(options.find((o) => o.label === "Earlier searches")?.disabled).toBe(true);
  });

  it("shows the owner and manager the empty Days, folded, up to today", () => {
    const { options } = dayOptions(SEARCHES, WORKDAY, { showEmptyDays: true });
    const empty = options.filter((o) => o.disabled && o.label.includes("no searches"));
    expect(empty.map((o) => o.label)).toEqual(["Days 4–5 · no searches", "Day 2 · Nov 18–19 · no searches"]);
    expect(options.map((o) => o.label).slice(0, 3)).toEqual(["Days 4–5 · no searches", "Day 3 · Nov 19–20", "Batch 3 · 7:42 PM"]);
  });

  it("has no Days without a BDE: every batch is an earlier search", () => {
    const { options } = dayOptions([search("x", null, null, "2026-11-17T14:12:00.000Z")], { ...WORKDAY, dayOne: null, todayDay: null, daysWorked: [] }, { showEmptyDays: true });
    expect(options.map((o) => o.label)).toEqual(["Earlier searches", "Nov 17, 7:42 PM", "All days"]);
    expect(options[1].value).toBe(NEWEST);
  });

  it("reads a pick as a batch, a Day or everything", () => {
    expect(readPick(NEWEST, "b3")).toEqual({ batch: "b3" });
    expect(readPick("b1", "b3")).toEqual({ batch: "b1" });
    expect(readPick("day:3", "b3")).toEqual({ day: 3 });
    expect(readPick(ALL_DAYS, "b3")).toEqual({});
  });

  it("names a Day by its dates: two across midnight, one for a daytime shift, across a month", () => {
    expect(dayDates("2026-11-17", { start: "18:30", end: "04:00" })).toBe("Nov 17–18");
    expect(dayDates("2026-11-17", { start: "09:00", end: "18:00" })).toBe("Nov 17");
    expect(dayDates("2026-11-30", { start: "18:30", end: "04:00" })).toBe("Nov 30 – Dec 1");
  });
});
