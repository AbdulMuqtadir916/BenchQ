import type { Candidate, CandidateStats } from "@/lib/schemas/candidate";
import type { Application } from "@/lib/schemas/application";
import { daysBetween, maxDate, minDate, round1 } from "./dates";

const CLOSED_STATUSES = ["MOVE_ON", "REJECTED", "WITHDRAWN", "EXPIRED", "PLACED"];

/**
 * Derive per-candidate stats from the application + event arrays.
 * CLAUDE.md: every number is computed here, never stored as a fixture literal.
 */
export function deriveCandidateStats(
  candidate: Candidate,
  applications: Application[],
): CandidateStats {
  const submitted = applications.filter((a) => a.status !== "SAVED");
  const lastActivity = maxDate([
    ...submitted.map((a) => a.appliedAt),
    ...submitted.map((a) => a.firstResponseAt),
    candidate.updatedAt,
  ]);

  const daysSinceActivity = lastActivity
    ? daysBetween(lastActivity, new Date())
    : Number.POSITIVE_INFINITY;

  return {
    candidateId: candidate.id,
    status: candidate.status,
    applicationsSubmitted: submitted.length,
    distinctCompanies: new Set(submitted.map((a) => a.companyNameAtApply)).size,
    distinctRoles: new Set(submitted.map((a) => a.jobTitleAtApply)).size,
    responsesReceived: submitted.filter((a) => a.firstResponseAt).length,
    interviewsScheduled: submitted.filter((a) => a.interviewAt).length,
    offersReceived: submitted.filter((a) => a.offerAt).length,
    applicationsOpen: submitted.filter((a) => !CLOSED_STATUSES.includes(a.status)).length,
    responseRatePct: submitted.length
      ? round1((100 * submitted.filter((a) => a.firstResponseAt).length) / submitted.length)
      : 0,
    daysOnBench: candidate.benchStartDate
      ? daysBetween(candidate.benchStartDate, new Date())
      : 0,
    firstApplicationAt: minDate(submitted.map((a) => a.appliedAt)),
    lastActivityAt: lastActivity,
    isAtRisk:
      candidate.status === "ON_BENCH" && daysSinceActivity > 7,
    workAuthExpiringSoon: candidate.workAuthExpiry
      ? daysBetween(new Date(), candidate.workAuthExpiry) < 90 &&
        new Date(candidate.workAuthExpiry) > new Date()
      : false,
  };
}
