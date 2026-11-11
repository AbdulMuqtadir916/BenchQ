import type { Job } from "@/lib/schemas/job";

/**
 * Where a job is, as one line. A backend job has one location text, kept in `city` with no `state` (docs/02 §6.z);
 * a fixture job has a city and a state, or is remote.
 */
export function jobLocation(job: Pick<Job, "city" | "state" | "remoteMode">): string {
  if (job.city && job.state) return job.remoteMode === "REMOTE" ? "Remote" : `${job.city}, ${job.state}`;
  if (job.city) return job.city;
  return job.remoteMode === "REMOTE" ? "Remote" : "Location not given";
}
