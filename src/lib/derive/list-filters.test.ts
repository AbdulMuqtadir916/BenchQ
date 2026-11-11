import { describe, expect, it } from "vitest";
import { benchHealth } from "@/features/dashboard/activity/activity-insights";
import { countActivity, windowOf } from "@/features/dashboard/activity/activity-numbers";
import type { Application } from "@/lib/schemas/application";
import type { Candidate } from "@/lib/schemas/candidate";
import { ApplicationsSearch, CandidatesSearch } from "@/lib/schemas/list-search";
import { deriveFunnel } from "./funnel";
import { benchDays, filterApplications, filterCandidates, roleKey } from "./list-filters";

const NOW = new Date("2026-11-10T12:00:00Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

const app = (over: Partial<Application>): Application => ({
  id: "a", firmId: "f", candidateId: "c1", jobId: "j", resumeVersionId: null, submittedByUserId: "u", status: "APPLIED",
  companyNameAtApply: "Acme", jobTitleAtApply: "Engineer", appliedAt: daysAgo(2), firstResponseAt: null, interviewAt: null,
  offerAt: null, closedAt: null, expiresAt: null, coverLetterText: null, notes: null, events: [], createdAt: daysAgo(3), ...over,
});
const candidate = (id: string, over: Partial<Candidate> = {}) =>
  ({ id, managerId: "mira", bdeId: "bea", status: "ON_BENCH", benchStartDate: daysAgo(5), createdAt: daysAgo(90), primaryRole: "Data Engineer", ...over }) as Candidate;

const appsFilter = (query: Record<string, string>) => ApplicationsSearch.parse(query);
const candidatesFilter = (query: Record<string, string>) => CandidatesSearch.parse(query);

const candidates = [candidate("c1"), candidate("c2", { managerId: "zed", bdeId: "cara" })];
const applications = [
  app({ id: "1", firstResponseAt: daysAgo(1) }),
  app({ id: "2", appliedAt: daysAgo(45), interviewAt: daysAgo(5), status: "INTERVIEW" }),
  app({ id: "3", status: "SAVED", appliedAt: null }),
  app({ id: "4", candidateId: "c2", status: "PLACED", appliedAt: daysAgo(80), closedAt: daysAgo(3), events: [{ toStatus: "INTERVIEW" } as Application["events"][number]] }),
  app({ id: "5", candidateId: "c2", appliedAt: daysAgo(10), status: "REJECTED" }),
];

describe("the list filters agree with the dashboard", () => {
  it("gives the same applications, interviews and placements for a period", () => {
    const counts = countActivity(applications, windowOf("30d", NOW));
    expect(filterApplications(applications, appsFilter({ period: "30d" }), candidates, NOW)).toHaveLength(counts.applications);
    expect(filterApplications(applications, appsFilter({ period: "30d", by: "interview" }), candidates, NOW)).toHaveLength(counts.interviews);
    expect(filterApplications(applications, appsFilter({ period: "30d", by: "placed" }), candidates, NOW)).toHaveLength(counts.placements);
  });

  it("gives each funnel stage's count", () => {
    const submitted = filterApplications(applications, appsFilter({ period: "90d" }), candidates, NOW);
    for (const stage of deriveFunnel(submitted)) {
      const listed = filterApplications(applications, appsFilter({ period: "90d", reached: stage.status }), candidates, NOW);
      expect(listed, stage.status).toHaveLength(stage.count);
    }
  });

  it("narrows by team, BDE, candidate and status", () => {
    expect(filterApplications(applications, appsFilter({ manager: "zed" }), candidates, NOW).map((a) => a.id)).toEqual(["4", "5"]);
    expect(filterApplications(applications, appsFilter({ bde: "bea" }), candidates, NOW).map((a) => a.id)).toEqual(["1", "2", "3"]);
    expect(filterApplications(applications, appsFilter({ candidate: "c2", status: "PLACED" }), candidates, NOW).map((a) => a.id)).toEqual(["4"]);
  });

  it("falls back to no filter for a stale or hand-edited link", () => {
    expect(appsFilter({ status: "NOPE", period: "5y", view: "grid" })).toMatchObject({ status: "", period: "", view: "kanban" });
    expect(candidatesFilter({ bench: "forever", status: "x" })).toMatchObject({ bench: "", status: "ALL" });
  });

  it("gives the bench bands' counts", () => {
    const bench = [
      candidate("fresh"), candidate("month", { benchStartDate: daysAgo(45) }), candidate("edge", { benchStartDate: daysAgo(60) }),
      candidate("long", { benchStartDate: daysAgo(70) }), candidate("placed", { status: "PLACED", benchStartDate: daysAgo(90) }),
    ];
    const aging = benchHealth(bench, [], NOW).aging;
    const band = (value: string) => filterCandidates(bench, candidatesFilter({ bench: value }), NOW).length;
    expect([band("under30"), band("30to60"), band("over60"), band("over30")]).toEqual([aging.under30, aging.from30to60, aging.over60, aging.from30to60 + aging.over60]);
  });

  it("matches a role however it is written", () => {
    expect(roleKey(" Senior Java  Developer ")).toBe("senior-java-developer");
    expect(filterCandidates([candidate("a"), candidate("b", { primaryRole: "QA" })], candidatesFilter({ role: "data-engineer" }), NOW).map((c) => c.id)).toEqual(["a"]);
    expect(benchDays(candidate("x", { benchStartDate: null }), NOW)).toBe(90);
  });
});
