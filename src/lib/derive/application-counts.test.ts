import { describe, expect, it } from "vitest";
import { CLOSED, isActive, isClosed } from "@/components/app/applications/status-meta";
import { ApplicationStatus, LegacyApplicationStatus, type StoredApplicationStatus } from "@/lib/schemas/enums";
import { allApplications } from "@/mocks/applications";
import { allCandidates } from "@/mocks/candidates";
import { CLOSED_STATUSES, applicationsInScope, applicationsSubmittedWithin, countApplications, describeApplicationCounts, isSubmitted } from "./application-counts";
import { deriveCandidateStats } from "./candidate-stats";
import { deriveFunnel } from "./funnel";

/**
 * BUG-005: the candidate screen counted applications three ways: the header said Applications 12 and Active 10 (saved jobs left
 * out), the tab said "13 active" (saved jobs counted as active), and the board showed 13 cards. A saved job is a draft or
 * favourite, "not proof of submission" (docs/02), so it is not an application; this file pins one definition for every screen.
 */
const some = (spec: Partial<Record<StoredApplicationStatus, number>>) =>
  Object.entries(spec).flatMap(([status, n]) => Array.from({ length: n }, () => ({ status: status as StoredApplicationStatus })));
/** Every value an application can hold: the selectable stages and the preserved legacy ones (docs/02 §2.1). */
const EVERY_STATUS: StoredApplicationStatus[] = [...ApplicationStatus.options, ...LegacyApplicationStatus.options];

describe("countApplications", () => {
  it("splits a candidate's list into saved, active, placed and closed, and the submitted ones are everything but saved", () => {
    // cand_06's shape: 15 in all, 3 of them only saved.
    const counts = countApplications(some({ SAVED: 3, APPLIED: 4, SCREENING_CALL: 2, SHORTLISTED: 2, INTERVIEW_SCHEDULED: 1, OFFER: 1, MOVE_ON: 1, WITHDRAWN: 1 }));
    expect(counts).toEqual({ saved: 3, open: 10, placed: 0, closed: 2, submitted: 12 });
  });

  it("is all zeros for no applications", () => {
    expect(countApplications([])).toEqual({ saved: 0, open: 0, placed: 0, closed: 0, submitted: 0 });
  });

  it("puts every status in exactly one bucket, so nothing is counted twice or lost", () => {
    for (const status of EVERY_STATUS) {
      const c = countApplications([{ status }]);
      expect(c.saved + c.open + c.placed + c.closed, status).toBe(1);
      expect(c.submitted, status).toBe(status === "SAVED" ? 0 : 1);
    }
  });

  it("a saved job is not submitted; every other status is", () => {
    expect(isSubmitted("SAVED")).toBe(false);
    for (const status of EVERY_STATUS.filter((s) => s !== "SAVED")) expect(isSubmitted(status), status).toBe(true);
  });

  it("agrees with the board's own idea of closed (status-meta), so the two lists cannot drift apart", () => {
    // status-meta's CLOSED also holds a legacy Placed, which is counted on its own here.
    expect([...CLOSED_STATUSES].sort()).toEqual(CLOSED.filter((s) => s !== "PLACED").sort());
    for (const status of EVERY_STATUS) expect(isClosed(status), status).toBe(CLOSED_STATUSES.includes(status) || status === "PLACED");
    expect(EVERY_STATUS.some((s) => isActive(s) && isClosed(s))).toBe(false);
  });

  it("counts every new stage from Applied to Offer as active, and Move On as closed", () => {
    expect(countApplications(some({ APPLIED: 1, SCREENING_CALL: 1, SHORTLISTED: 1, INTERVIEW_SCHEDULE_REQUEST: 1, INTERVIEW_SCHEDULED: 1, ASSESSMENT: 1, OFFER: 1, INCOMPLETE_APPLICATION: 1 })).open).toBe(8);
    expect(countApplications(some({ MOVE_ON: 2 }))).toMatchObject({ open: 0, closed: 2, submitted: 2 });
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
  const app = (status: StoredApplicationStatus, daysAgo: number | null) => ({
    status, appliedAt: daysAgo === null ? null : new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString(),
  });

  it("never includes a saved job, whatever the period", () => {
    const saved = [app("SAVED", null), app("SAVED", null), app("SAVED", null)];
    for (const days of [7, 30, 90]) expect(applicationsSubmittedWithin(saved, days, NOW), `${days} days`).toEqual([]);
  });

  it("keeps submitted applications from inside the period and drops the older ones (the last day counts)", () => {
    const apps = [app("APPLIED", 0), app("SCREENING_CALL", 7), app("APPLIED", -0.01), app("APPLIED", 7.01), app("INTERVIEW_SCHEDULED", 8), app("OFFER", 29), app("PLACED", 31), app("MOVE_ON", 89), app("EXPIRED", 120)];
    expect(applicationsSubmittedWithin(apps, 7, NOW).map((a) => a.status)).toEqual(["APPLIED", "SCREENING_CALL"]);
    expect(applicationsSubmittedWithin(apps, 30, NOW).map((a) => a.status)).toEqual(["APPLIED", "SCREENING_CALL", "APPLIED", "INTERVIEW_SCHEDULED", "OFFER"]);
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

// PR #128 review: the count, the board and the list use the same rule; All keeps everything. On the PR 4 board Saved and Move On
// have their own columns, so Active shows them, and the line above the board names them (saved; Move On under closed).
describe("applicationsInScope", () => {
  const list = some({ SAVED: 2, APPLIED: 3, INTERVIEW_SCHEDULED: 1, OFFER: 1, MOVE_ON: 1, PLACED: 2, REJECTED: 1, EXPIRED: 1 });

  it("Active keeps what the board has a column for: Saved, the open stages and Move On; legacy Placed and closed are left out", () => {
    const active = applicationsInScope(list, "active");
    expect(active).toHaveLength(8);
    expect(active.some((a) => a.status === "PLACED" || a.status === "REJECTED" || a.status === "EXPIRED")).toBe(false);
  });

  it("All keeps every application", () => {
    expect(applicationsInScope(list, "all")).toHaveLength(list.length);
  });

  it("every Active row is named in the line: active, saved, or Move On under closed", () => {
    const counts = countApplications(list);
    const active = applicationsInScope(list, "active");
    expect(active.filter((a) => isActive(a.status))).toHaveLength(counts.open);
    expect(active.filter((a) => a.status === "SAVED")).toHaveLength(counts.saved);
    expect(active.filter((a) => a.status === "MOVE_ON").length).toBeLessThanOrEqual(counts.closed);
  });
});
