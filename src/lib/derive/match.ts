import type { Candidate } from "@/lib/schemas/candidate";
import type { Job } from "@/lib/schemas/job";

/**
 * A lightweight, deterministic match score derived from real fields:
 * overlap between the candidate's role/target roles and the job's title +
 * requirement values. No stored score — computed on demand, stable per pair.
 */
// Generic role words carry no signal; the distinctive skill/domain tokens do.
const STOPWORDS = new Set([
  "senior", "junior", "lead", "staff", "principal", "developer", "engineer",
  "backend", "frontend", "fullstack", "full", "stack", "software", "sr", "jr",
  "remote", "hybrid", "onsite", "contract", "term", "long", "the", "and", "of",
]);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .filter((t) => t.length > 1);
}

function distinctive(text: string): Set<string> {
  return new Set(tokens(text).filter((t) => !STOPWORDS.has(t)));
}

/**
 * Title-driven similarity: how much of the job's distinctive skill/domain
 * vocabulary the candidate's role and target roles cover. A Java candidate
 * scores high on Java roles and low on Python roles — the discriminating
 * token (java/python/react/…) drives the result, not generic words.
 */
export function deriveMatchScore(candidate: Candidate, job: Job): number {
  const candidateTokens = distinctive(
    [candidate.primaryRole ?? "", ...candidate.targetRoles].join(" "),
  );
  const jobTokens = distinctive(job.title + " " + job.normalisedTitle.replaceAll("-", " "));
  if (candidateTokens.size === 0 || jobTokens.size === 0) return 45;

  let overlap = 0;
  for (const t of jobTokens) if (candidateTokens.has(t)) overlap++;
  const sim = overlap / jobTokens.size;

  // 45 floor (any active role is plausible) up to 98 for a full skill match.
  return Math.max(40, Math.min(98, Math.round(45 + sim * 53)));
}

/** Rank a candidate's best not-yet-applied jobs. */
export function rankJobsForCandidate(
  candidate: Candidate,
  jobs: Job[],
  appliedJobIds: Set<string>,
  limit = 8,
): Array<{ job: Job; score: number }> {
  return jobs
    .filter((j) => j.isActive && !appliedJobIds.has(j.id) && j.dedupe.duplicateOfJobId === null)
    .filter((j) => j.allowedWorkAuth.includes(candidate.workAuth))
    .map((job) => ({ job, score: deriveMatchScore(candidate, job) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** "Newest" orders by the posted date, or the captured date when a job has none (one captured by hand); never an invented posted date. */
export function newestDate(job: Pick<Job, "postedAt" | "provenance">): string {
  return job.postedAt ?? job.provenance.ingestedAt;
}
