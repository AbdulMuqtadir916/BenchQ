import { z } from "zod";
import type { JobSourceFilter } from "@/lib/api/jobs";

/** The Jobs list shows one source at a time (decided by Zuhair 2026-11-21); a search still asks every source. */
export const JobSourceKey = z.enum(["INDEED", "FREEHIRE", "LINKEDIN", "OTHER_SOURCE", "MANUAL", "EXTENSION"]);
export type JobSourceKey = z.infer<typeof JobSourceKey>;

/** The source filter's backend names (backend/api/routes_job_search.py `list_firm_jobs`). */
export const SOURCE_FILTER: Record<JobSourceKey, JobSourceFilter> = {
  INDEED: "indeed",
  FREEHIRE: "freehire",
  LINKEDIN: "linkedin",
  MANUAL: "manual",
  EXTENSION: "extension",
  OTHER_SOURCE: "other",
};

/** freehire.me, then Indeed, then LinkedIn; the others so a captured job is never hidden behind an empty list. */
const OPENS_ON: readonly JobSourceKey[] = ["FREEHIRE", "INDEED", "LINKEDIN", "MANUAL", "EXTENSION", "OTHER_SOURCE"];

/** The source a list opens on: the first in `OPENS_ON` with a job. No jobs anywhere: freehire.me. */
export function defaultJobSource(counts: Record<string, number>): JobSourceKey {
  return OPENS_ON.find((key) => (counts[SOURCE_FILTER[key]] ?? 0) > 0) ?? "FREEHIRE";
}

/** The `source` URL parameter, or null when it is missing or names no source. */
export function readJobSource(value: string | null): JobSourceKey | null {
  const parsed = JobSourceKey.safeParse(value);
  return parsed.success ? parsed.data : null;
}
