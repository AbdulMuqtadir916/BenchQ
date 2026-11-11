import { describe, expect, it } from "vitest";
import type { Application } from "@/lib/schemas/application";
import type { Candidate } from "@/lib/schemas/candidate";
import type { Job } from "@/lib/schemas/job";
import type { User } from "@/lib/schemas/session";
import { averageDaysToPlace, benchHealth, candidateProgress, changeFrom, compareActivity, needsAttention, previousWindow, ratios, roleDemand, sourceEffectiveness, stageSpeeds } from "./activity-insights";
import { windowOf } from "./activity-numbers";

const NOW = new Date("2026-11-10T12:00:00Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
const window = windowOf("30d", NOW);

const app = (over: Partial<Application>): Application => ({
  id: "a", firmId: "f", candidateId: "c1", jobId: "j", resumeVersionId: null, submittedByUserId: "u", status: "APPLIED",
  companyNameAtApply: "Acme", jobTitleAtApply: "Engineer", appliedAt: daysAgo(2), firstResponseAt: null, interviewAt: null,
  offerAt: null, closedAt: null, expiresAt: null, coverLetterText: null, notes: null, events: [], createdAt: daysAgo(3), ...over,
});
const candidate = (id: string, over: Partial<Candidate> = {}) =>
  ({ id, managerId: "mira", bdeId: "bea", status: "ON_BENCH", benchStartDate: daysAgo(5), createdAt: daysAgo(90), primaryRole: "Data Engineer", ...over }) as Candidate;
const bde = (id: string) => ({ id, name: id, role: "BDE", managerId: "mira", isActive: true }) as User;

describe("this period against the one before", () => {
  it("is the same length, just before", () => {
    const before = previousWindow(window);
    expect(before.end).toBeLessThan(window.start);
    expect(window.start - before.start).toBe(window.end - window.start);
  });

  it("says up, down or the same", () => {
    expect(changeFrom(5, 2)).toEqual({ text: "+3", trend: "up" });
    expect(changeFrom(1, 4)).toEqual({ text: "−3", trend: "down" });
    expect(changeFrom(0, 0)).toEqual({ text: null, trend: "neutral" });
    const change = compareActivity([app({ appliedAt: daysAgo(1) }), app({ appliedAt: daysAgo(40) }), app({ appliedAt: daysAgo(45) })], window);
    expect(change.applications).toEqual({ text: "−1", trend: "down" });
  });
});

describe("speed and ratios", () => {
  it("averages each step finished in the period, and flags the slowest", () => {
    const speeds = stageSpeeds([
      app({ appliedAt: daysAgo(20), firstResponseAt: daysAgo(18), interviewAt: daysAgo(8) }),
      app({ appliedAt: daysAgo(10), firstResponseAt: daysAgo(6) }),
    ], window);
    expect(speeds.map((speed) => speed.averageDays)).toEqual([3, 10, null, null]);
    expect(speeds.find((speed) => speed.isSlowest)?.label).toBe("Response → interview");
  });

  it("counts days to place only for placements in the period", () => {
    expect(averageDaysToPlace([app({ status: "PLACED", appliedAt: daysAgo(40), closedAt: daysAgo(10) }), app({ status: "PLACED", appliedAt: daysAgo(90), closedAt: daysAgo(60) })], window)).toBe(30);
    expect(averageDaysToPlace([], window)).toBeNull();
    // A placement dated before its application can't have taken negative time: it is left out, not averaged in.
    expect(averageDaysToPlace([app({ status: "PLACED", appliedAt: daysAgo(10), closedAt: daysAgo(20) }), app({ status: "PLACED", appliedAt: daysAgo(40), closedAt: daysAgo(10) })], window)).toBe(30);
    expect(averageDaysToPlace([app({ status: "PLACED", appliedAt: daysAgo(10), closedAt: daysAgo(20) })], window)).toBeNull();
  });

  it("gives the submission, interview and placement ratios", () => {
    const result = ratios([
      app({ id: "1", interviewAt: daysAgo(1), offerAt: daysAgo(0) }),
      app({ id: "2", interviewAt: daysAgo(1) }),
      app({ id: "3" }),
      app({ id: "4", status: "PLACED", appliedAt: daysAgo(4), closedAt: daysAgo(1) }),
    ], window);
    expect(result).toEqual({ submissionToInterviewPct: 50, interviewToOfferPct: 50, applicationsPerPlacement: 4 });
    expect(ratios([], window)).toEqual({ submissionToInterviewPct: null, interviewToOfferPct: null, applicationsPerPlacement: null });
  });
});

describe("the bench", () => {
  const candidates = [
    candidate("fresh"),
    candidate("month", { benchStartDate: daysAgo(45) }),
    candidate("long", { benchStartDate: daysAgo(70) }),
    candidate("placed", { status: "PLACED" }),
    candidate("paused", { status: "PAUSED" }),
  ];

  it("counts utilization among those worked or placed, and ages the bench", () => {
    const health = benchHealth(candidates, [app({ candidateId: "fresh", appliedAt: daysAgo(1) })], NOW);
    expect(health.utilizationPct).toBe(25);
    expect(health.aging).toEqual({ under30: 1, from30to60: 1, over60: 1 });
    expect(health.idle).toBe(2);
    expect(health.longest.map((row) => row.candidate.id)).toEqual(["long", "month"]);
  });

  it("lists what needs attention", () => {
    const people = [bde("bea"), bde("ben")];
    const list = [...candidates, candidate("queue", { bdeId: null })];
    const health = benchHealth(list, [], NOW);
    const items = needsAttention(people, list, [], window, health);
    expect(items.map((item) => item.kind)).toEqual(["without-bde", "quiet-bde", "aging"]);
    expect(needsAttention(people, [], [], window, benchHealth([], [], NOW))).toEqual([]);
  });
});

describe("roles in demand", () => {
  it("ranks open jobs by role beside bench candidates in that role", () => {
    const job = (title: string, isActive = true) => ({ title, normalisedTitle: title.toLowerCase().replaceAll(" ", "-"), isActive }) as Job;
    const rows = roleDemand([job("Data Engineer"), job("Data Engineer"), job("QA Engineer"), job("Closed", false)],
      [candidate("a"), candidate("b", { status: "PLACED" })]);
    expect(rows).toEqual([{ key: "data-engineer", role: "Data Engineer", jobs: 2, onBench: 1 }, { key: "qa-engineer", role: "QA Engineer", jobs: 1, onBench: 0 }]);
  });
});

describe("sources", () => {
  it("counts the period's applications by job source, with the reply rate", () => {
    const job = (id: string, sourceType: string) => ({ id, provenance: { sourceType } }) as unknown as Job;
    const rows = sourceEffectiveness([
      app({ id: "1", jobId: "a", firstResponseAt: daysAgo(1) }), app({ id: "2", jobId: "a" }), app({ id: "3", jobId: "b" }),
      app({ id: "4", jobId: "b", appliedAt: daysAgo(60) }), app({ id: "5", jobId: "missing" }),
    ], [job("a", "CONNECTOR"), job("b", "MANUAL")], window);
    expect(rows).toEqual([{ source: "CONNECTOR", applications: 2, responsePct: 50 }, { source: "MANUAL", applications: 1, responsePct: 0 }]);
  });
});

describe("a BDE's candidates", () => {
  it("gives the furthest stage, today's count, and flags the quiet ones first", () => {
    const rows = candidateProgress([candidate("busy", { fullName: "Busy" }), candidate("quiet", { fullName: "Quiet" }), candidate("done", { fullName: "Done", status: "PLACED" })], [
      app({ candidateId: "busy", appliedAt: daysAgo(0.5) }),
      app({ candidateId: "busy", status: "INTERVIEW", appliedAt: daysAgo(3) }),
      app({ candidateId: "quiet", appliedAt: daysAgo(20) }),
      app({ candidateId: "done", status: "PLACED", appliedAt: daysAgo(40) }),
    ], NOW);
    expect(rows.map((row) => [row.candidate.id, row.stage, row.today, row.isQuiet])).toEqual([
      ["quiet", 1, 0, true], ["done", 6, 0, false], ["busy", 4, 1, false],
    ]);
  });
});
