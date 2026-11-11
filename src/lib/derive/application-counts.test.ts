import { describe, expect, it } from "vitest";
import { CLOSED, isClosed } from "@/components/app/applications/status-meta";
import { ApplicationStatus } from "@/lib/schemas/enums";
import { allApplications } from "@/mocks/applications";
import { fixtureCandidates as allCandidates } from "@/test/fixtures/candidates";
import { CLOSED_STATUSES, OPEN_STATUSES, applicationsInScope, applicationsSubmittedWithin, countApplications, describeApplicationCounts, isSubmitted } from "./application-counts";
import { deriveCandidateStats } from "./candidate-stats";
import { deriveFunnel } from "./funnel";

/**
 * BUG-005: the candidate screen counted applications three ways: the header said Applications 12 and Active 10 (saved jobs left
 * out), the tab said "13 active" (saved jobs counted as active), and the board showed 13 cards. A saved job is a draft or
 * favourite, "not proof of submission" (docs/02), so it is not an application; this file pins one definition for every screen.
 */
const some = (spec: Partial<Record<ApplicationStatus, number>>) =>
  Object.entries(spec).flatMap(([status, n]) => Array.from({ length: n }, () => ({ status: status as ApplicationStatus })));

describe("countApplications", () => {
  it("splits a candidate's list into saved, active, placed and closed, and the submitted ones are everything but saved", () => {
    // cand_06's shape: 15 in all, 3 of them only saved.
    const counts = countApplications(some({ SAVED: 3, APPLIED: 4, RESPONSE: 2, SCREENING: 2, INTERVIEW: 1, OFFER: 1, REJECTED: 1, WITHDRAWN: 1 }));
    expect(counts).toEqual({ saved: 3, open: 10, placed: 0, closed: 2, submitted: 12 });
  });

  it("is all zeros for no applications", () => {
    expect(countApplications([])).toEqual({ saved: 0, open: 0, placed: 0, closed: 0, submitted: 0 });
  });

  it("puts every status in exactly one bucket, so nothing is counted twice or lost", () => {
    for (const status of ApplicationStatus.options) {
      const c = countApplications([{ status }]);
      expect(c.saved + c.open + c.placed + c.closed, status).toBe(1);
      expect(c.submitted, status).toBe(status === "SAVED" ? 0 : 1);
    }
  });

  it("a saved job is not submitted; every other status is", () => {
    expect(isSubmitted("SAVED")).toBe(false);
    for (const status of ApplicationStatus.options.filter((s) => s !== "SAVED")) expect(isSubmitted(status), status).toBe(true);
  });

  it("agrees with the board's own idea of closed (status-meta), so the two lists cannot drift apart", () => {
    expect([...CLOSED_STATUSES].sort()).toEqual([...CLOSED].sort());
    for (const status of ApplicationStatus.options) expect(isClosed(status), status).toBe(CLOSED_STATUSES.includes(status));
    expect(OPEN_STATUSES.some((s) => CLOSED_STATUSES.includes(s))).toBe(false);
  });
});

describe("describeApplicationCounts, the line above the candidate's board", () => {
  it("says active and closed, then saved on its own, so 13 cards are not called 13 active", () => {
    expect(describeApplicationCounts({ saved: 3, open: 10, placed: 0, closed: 2, submitted: 12 })).toBe("10 active · 2 closed · 3 saved");
  });

  it("leaves saved out when there are none, and names placed ones when there are some", () => {
    expect(describeApplicationCounts({ saved: 0, open: 4, placed: 0, closed: 0, submitted: 4 })).toBe("4 active · 0 closed");
    expect(describeApplicationCounts({ saved: 0, open: 9, placed: 1, closed: 2, submitted: 12 })).toBe("9 active · 1 placed · 2 closed");
  });
});

describe("one definition across the candidate screen", () => {
  it("for every candidate, the header's Applications and Active use the shared counts", () => {
    expect(allCandidates.length).toBeGreaterThan(0);
    for (const candidate of allCandidates) {
      const mine = allApplications.filter((a) => a.candidateId === candidate.id);
      const stats = deriveCandidateStats(candidate, mine);
      const counts = countApplications(mine);
      expect(stats.applicationsSubmitted, `${candidate.id} applications`).toBe(counts.submitted);
      expect(stats.applicationsOpen, `${candidate.id} active`).toBe(counts.open);
      expect(counts.open + counts.placed + counts.closed, `${candidate.id} parts add up to submitted`).toBe(counts.submitted);
    }
  });
});

/**
 * BUG-008: the Analytics page kept every application with no `appliedAt` in every period (`!a.appliedAt || ...`), and those are
 * exactly the saved jobs. So the headline said "45 applications" over a funnel of zeros (7 and 30 days) and 320 over 275 (90
 * days), and "Source effectiveness" counted saved jobs as applications too. A period holds submitted applications only, dated by
 * when they were submitted.
 */
describe("applicationsSubmittedWithin, an Analytics period", () => {
  const NOW = new Date("2026-11-10T12:00:00.000Z");
  const app = (status: ApplicationStatus, daysAgo: number | null) => ({
    status, appliedAt: daysAgo === null ? null : new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString(),
  });

  it("never includes a saved job, whatever the period", () => {
    const saved = [app("SAVED", null), app("SAVED", null), app("SAVED", null)];
    for (const days of [7, 30, 90]) expect(applicationsSubmittedWithin(saved, days, NOW), `${days} days`).toEqual([]);
  });

  it("keeps submitted applications from inside the period and drops the older ones (the last day counts)", () => {
    const apps = [app("APPLIED", 0), app("RESPONSE", 7), app("APPLIED", -0.01), app("APPLIED", 7.01), app("INTERVIEW", 8), app("OFFER", 29), app("PLACED", 31), app("REJECTED", 89), app("EXPIRED", 120)];
    expect(applicationsSubmittedWithin(apps, 7, NOW).map((a) => a.status)).toEqual(["APPLIED", "RESPONSE"]);
    expect(applicationsSubmittedWithin(apps, 30, NOW).map((a) => a.status)).toEqual(["APPLIED", "RESPONSE", "APPLIED", "INTERVIEW", "OFFER"]);
    expect(applicationsSubmittedWithin(apps, 90, NOW)).toHaveLength(7);
  });

  it("a submitted application with no date cannot be placed in any period, so it is left out rather than counted everywhere", () => {
    expect(applicationsSubmittedWithin([app("APPLIED", null)], 90, NOW)).toEqual([]);
  });

  it("with real data, the headline for every period is exactly the funnel's first stage, with no saved job in it", () => {
    const newest = allApplications.map((a) => a.appliedAt).filter((d): d is string => d !== null).sort().at(-1)!;
    const now = new Date(newest);
    for (const days of [7, 30, 90]) {
      const inPeriod = applicationsSubmittedWithin(allApplications, days, now);
      expect(inPeriod.some((a) => a.status === "SAVED"), `${days} days has a saved job`).toBe(false);
      expect(inPeriod.length, `${days} days`).toBeGreaterThan(0);
      expect(deriveFunnel(inPeriod)[0]!.count, `${days} days: headline vs funnel Applied`).toBe(inPeriod.length);
    }
  });
});

// PR #128 review: Active excludes Saved and Placed, and the count, the board and the list use the same rule; All keeps everything.
describe("applicationsInScope", () => {
  const list = some({ SAVED: 2, APPLIED: 3, INTERVIEW: 1, OFFER: 1, PLACED: 2, REJECTED: 1, EXPIRED: 1 });

  it("Active keeps only the open stages, so Saved, Placed and the closed ones are left out", () => {
    const active = applicationsInScope(list, "active");
    expect(active).toHaveLength(5);
    expect(active.every((a) => OPEN_STATUSES.includes(a.status))).toBe(true);
  });

  it("All keeps every application", () => {
    expect(applicationsInScope(list, "all")).toHaveLength(list.length);
  });

  it("the Active count is exactly the number of Active rows", () => {
    expect(countApplications(list).open).toBe(applicationsInScope(list, "active").length);
  });
});
