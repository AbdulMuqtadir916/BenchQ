import type { Candidate } from "@/lib/schemas/candidate";
import type { Job, JobMatch } from "@/lib/schemas/job";

/**
 * A candidate's Match for a job (decided 2026-11-14): the score the backend stored (backend/match, the ATS calculator
 * v18) and why it is held at 40, or null when it isn't worked out yet or the job isn't theirs. Never computed here:
 * the title-only placeholder (`deriveMatchScore`) is gone (Q40).
 */
export function matchFor(job: Pick<Job, "matches">, candidateId: string | null | undefined): JobMatch | null {
  if (!candidateId) return null;
  const match = job.matches[candidateId];
  return match && match.score !== null ? match : null;
}

/**
 * A job shown for a candidate (docs/02 §6.z): one found or captured for them, whose work authorization allows
 * theirs or is unknown (a searched job's is: it is shown, never hidden as if it were refused).
 */
export function isJobForCandidate(job: Pick<Job, "candidateIds" | "allowedWorkAuth">, candidate: Pick<Candidate, "id" | "workAuth">): boolean {
  return job.candidateIds.includes(candidate.id) && (job.allowedWorkAuth.length === 0 || job.allowedWorkAuth.includes(candidate.workAuth));
}

/** Rank a candidate's best not-yet-applied jobs. */
export function rankJobsForCandidate(
  candidate: Candidate,
  jobs: Job[],
  appliedJobIds: Set<string>,
  limit = 8,
): Array<{ job: Job; score: number | null; note: string | null }> {
  return jobs
    .filter((j) => j.isActive && !appliedJobIds.has(j.id) && j.dedupe.duplicateOfJobId === null)
    .filter((j) => isJobForCandidate(j, candidate))
    .map((job) => ({ job, score: matchFor(job, candidate.id)?.score ?? null, note: matchFor(job, candidate.id)?.note ?? null }))
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
    .slice(0, limit);
}

/** "Newest" orders by the posted date, or the captured date when a job has none (one captured by hand); never an invented posted date. */
export function newestDate(job: Pick<Job, "postedAt" | "provenance">): string {
  return job.postedAt ?? job.provenance.ingestedAt;
}
