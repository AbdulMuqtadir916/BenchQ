import type { Candidate } from "@/lib/schemas/candidate";
import type { Application, FollowUpTask } from "@/lib/schemas/application";
import type { BdeDashboard } from "@/lib/schemas/analytics";
import { deriveCandidateStats } from "./candidate-stats";
import { daysBetween } from "./dates";

function isSameLocalDay(iso: string, ref: Date): boolean {
  const d = new Date(iso);
  return (
    d.getFullYear() === ref.getFullYear() &&
    d.getMonth() === ref.getMonth() &&
    d.getDate() === ref.getDate()
  );
}

/**
 * The BDE "tonight" dashboard numbers — all derived from the candidate,
 * application and follow-up arrays for a given user.
 */
export function deriveBdeDashboard(
  userId: string,
  candidates: Candidate[],
  applications: Application[],
  followups: FollowUpTask[],
): BdeDashboard {
  const now = new Date();
  const myCandidates = candidates.filter((c) => c.bdeId === userId);
  const myCandidateIds = new Set(myCandidates.map((c) => c.id));
  const myApps = applications.filter((a) => myCandidateIds.has(a.candidateId));
  const myFollowups = followups.filter((f) => f.assignedToUserId === userId);

  const submittedThisWeek = myApps.filter(
    (a) => a.appliedAt && daysBetween(a.appliedAt, now) <= 7,
  );
  const responsesThisWeek = myApps.filter(
    (a) => a.firstResponseAt && daysBetween(a.firstResponseAt, now) <= 7,
  );

  const pendingFollowups = myFollowups.filter((f) => f.state === "PENDING");
  const atRisk = myCandidates.filter((c) => {
    const stats = deriveCandidateStats(
      c,
      myApps.filter((a) => a.candidateId === c.id),
    );
    return stats.isAtRisk;
  });

  return {
    queueCount: myCandidates.filter((c) => c.status === "ON_BENCH").length,
    followUpsDueToday: pendingFollowups.filter((f) => isSameLocalDay(f.dueAt, now)).length,
    followUpsOverdue: pendingFollowups.filter((f) => new Date(f.dueAt) < now && !isSameLocalDay(f.dueAt, now)).length,
    applicationsThisWeek: submittedThisWeek.length,
    responsesThisWeek: responsesThisWeek.length,
    interviewsScheduled: myApps.filter((a) => ["INTERVIEW", "INTERVIEW_SCHEDULED"].includes(a.status)).length,
    candidatesAssigned: myCandidates.length,
    atRiskCandidateIds: atRisk.map((c) => c.id),
  };
}
