import type { Candidate } from "@/lib/schemas/candidate";
import type { Application } from "@/lib/schemas/application";
import type { BdeDashboard } from "@/lib/schemas/analytics";
import { deriveCandidateStats } from "./candidate-stats";
import { daysBetween } from "./dates";

/**
 * The BDE "tonight" dashboard numbers — all derived from the candidate,
 * application arrays for a given user.
 */
export function deriveBdeDashboard(
  userId: string,
  candidates: Candidate[],
  applications: Application[],
): BdeDashboard {
  const now = new Date();
  const myCandidates = candidates.filter((c) => c.bdeId === userId);
  const myCandidateIds = new Set(myCandidates.map((c) => c.id));
  const myApps = applications.filter((a) => myCandidateIds.has(a.candidateId));

  const submittedThisWeek = myApps.filter(
    (a) => a.appliedAt && daysBetween(a.appliedAt, now) <= 7,
  );
  const responsesThisWeek = myApps.filter(
    (a) => a.firstResponseAt && daysBetween(a.firstResponseAt, now) <= 7,
  );

  const atRisk = myCandidates.filter((c) => {
    const stats = deriveCandidateStats(
      c,
      myApps.filter((a) => a.candidateId === c.id),
    );
    return stats.isAtRisk;
  });

  return {
    queueCount: myCandidates.filter((c) => c.status === "ON_BENCH").length,
    applicationsThisWeek: submittedThisWeek.length,
    responsesThisWeek: responsesThisWeek.length,
    interviewsScheduled: myApps.filter((a) => a.status === "INTERVIEW_SCHEDULED" || a.status === "INTERVIEW").length,
    candidatesAssigned: myCandidates.length,
    atRiskCandidateIds: atRisk.map((c) => c.id),
  };
}
