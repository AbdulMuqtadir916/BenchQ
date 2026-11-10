import { describe, expect, it } from "vitest";
import type { Application } from "@/lib/schemas/application";
import type { Candidate } from "@/lib/schemas/candidate";
import type { User } from "@/lib/schemas/session";
import { bdeRows, bdeStageRows, candidateRows, countActivity, managerRows, stackedByBde, trendBins, windowOf } from "./activity-numbers";

const NOW = new Date("2026-11-09T12:00:00Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
const window = windowOf("30d", NOW);

const app = (over: Partial<Application>): Application => ({
  id: "a", firmId: "f", candidateId: "c1", jobId: "j", resumeVersionId: null, submittedByUserId: "u", status: "APPLIED",
  companyNameAtApply: "Acme", jobTitleAtApply: "Engineer", appliedAt: daysAgo(2), firstResponseAt: null, interviewAt: null,
  offerAt: null, closedAt: null, expiresAt: null, coverLetterText: null, notes: null, events: [], createdAt: daysAgo(3), ...over,
});

const person = (id: string, role: User["role"], managerId: string | null = null) => ({ id, name: id, role, managerId, isActive: true }) as User;
const candidate = (id: string, managerId: string, bdeId: string | null) =>
  ({ id, managerId, bdeId, updatedAt: daysAgo(40), status: "ON_BENCH" }) as Candidate;

describe("the activity numbers", () => {
  it("counts each thing by when it happened in the period", () => {
    const counts = countActivity([
      app({ id: "1", firstResponseAt: daysAgo(1) }),
      app({ id: "2", appliedAt: daysAgo(45), interviewAt: daysAgo(5) }),       // an old application's interview this month
      app({ id: "3", status: "SAVED", appliedAt: null }),                          // saved, not submitted
      app({ id: "4", status: "PLACED", appliedAt: daysAgo(80), closedAt: daysAgo(3) }),
    ], window);
    expect(counts).toEqual({ applications: 1, responses: 1, interviews: 1, placements: 1 });
  });

  it("gives each manager their team, their active BDEs and their queue", () => {
    const users = [person("mira", "MANAGER"), person("bea", "BDE", "mira"), { ...person("old", "BDE", "mira"), isActive: false }];
    const candidates = [candidate("c1", "mira", "bea"), candidate("c2", "mira", null), candidate("c3", "zed", "cara")];
    const [row] = managerRows([users[0]], users, candidates, [app({ candidateId: "c1" }), app({ candidateId: "c3" })], window);
    expect(row).toMatchObject({ bdes: 1, candidates: 2, withoutBde: 1, counts: { applications: 1 } });
  });

  it("counts a BDE holding the manager's candidate in the team, even with no manager of their own", () => {
    const users = [person("mira", "MANAGER"), person("bea", "BDE", "mira"), person("kai", "BDE", null)];
    const candidates = [candidate("c1", "mira", "bea"), candidate("c2", "mira", "kai")];
    const [row] = managerRows([users[0]], users, candidates, [], window);
    expect(row.bdes).toBe(2);
  });

  it("gives each BDE only their own candidates", () => {
    const [row] = bdeRows([person("bea", "BDE", "mira")], [candidate("c1", "mira", "bea"), candidate("c2", "mira", null)],
      [app({ candidateId: "c1" }), app({ candidateId: "c2" })], window);
    expect(row).toMatchObject({ candidates: 1, counts: { applications: 1 } });
  });

  it("counts how far each BDE's applications of the period got, by the stages they reached", () => {
    const step = (toStatus: Application["status"]) => ({ toStatus }) as Application["events"][number];
    const [row] = bdeStageRows([person("bea", "BDE", "mira")], [candidate("c1", "mira", "bea"), candidate("c2", "mira", "zed")], [
      app({ id: "1", candidateId: "c1" }),
      app({ id: "2", candidateId: "c1", status: "INTERVIEW", events: [step("SCREENING"), step("INTERVIEW")] }),
      app({ id: "3", candidateId: "c1", status: "PLACED", events: [step("SCREENING"), step("INTERVIEW"), step("OFFER"), step("PLACED")] }),
      app({ id: "4", candidateId: "c1", appliedAt: daysAgo(60), status: "PLACED", events: [step("PLACED")] }), // submitted before the period
      app({ id: "5", candidateId: "c2" }),                                                                     // another BDE's candidate
    ], window);
    expect(row).toMatchObject({ applied: 3, shortlisted: 2, interview: 2, placed: 1 });
  });

  it("dates a candidate by the latest thing that happened, whenever it was", () => {
    const [row] = candidateRows([candidate("c1", "mira", "bea")], [app({ appliedAt: daysAgo(50), interviewAt: daysAgo(35) })], window);
    expect(row.lastActivity).toBe(daysAgo(35));
    expect(row.counts.applications).toBe(0);
  });

  it("splits the period into equal parts that add up to every submission", () => {
    const bins = trendBins([app({ appliedAt: daysAgo(29) }), app({ appliedAt: daysAgo(0) }), app({ appliedAt: daysAgo(31) })], window);
    expect(bins).toHaveLength(7);
    expect(bins.reduce((sum, bin) => sum + bin.count, 0)).toBe(2);
    expect(bins[0].count).toBe(1);
    expect(bins[6].count).toBe(1);
  });
});

describe("submissions by BDE", () => {
  it("adds up to every submission, the rest counted apart", () => {
    const candidates = [candidate("c1", "mira", "bea"), candidate("c2", "mira", null), candidate("c3", "mira", "cara")];
    const apps = [app({ id: "1", candidateId: "c1" }), app({ id: "2", candidateId: "c2" }), app({ id: "3", candidateId: "c3" }), app({ id: "4", candidateId: "c1", appliedAt: daysAgo(40) })];
    const bins = stackedByBde([person("bea", "BDE", "mira")], candidates, apps, window);
    expect(bins.reduce((sum, bin) => sum + bin.counts[0], 0)).toBe(1);
    expect(bins.reduce((sum, bin) => sum + bin.rest, 0)).toBe(2);
    expect(bins.reduce((sum, bin) => sum + bin.counts[0] + bin.rest, 0)).toBe(countActivity(apps, window).applications);
  });
});
