import { z } from "zod";

/** Why a search failed (backend/job_search/providers/base.py `ERROR_MESSAGES`); the screen words it. */
export const JobSearchErrorCode = z.enum(["timeout", "provider_unavailable", "provider_rejected", "bad_response", "too_large", "internal"]);
export type JobSearchErrorCode = z.infer<typeof JobSearchErrorCode>;

/** One search, or one captured job, of a candidate's (docs/02 §6.z). Every count is the backend's. */
export const JobSearchSchema = z.object({
  id: z.string(),
  kind: z.enum(["SEARCH", "CAPTURE"]),
  state: z.enum(["RUNNING", "SUCCESS", "EMPTY", "ERROR"]),
  /** The role searched; null for a capture. */
  query: z.string().nullable(),
  newCount: z.number().int(),
  seenAgainCount: z.number().int(),
  overLimitCount: z.number().int(),
  errorCode: JobSearchErrorCode.nullable(),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime().nullable(),
});
export type JobSearch = z.infer<typeof JobSearchSchema>;

/** Today's numbers since 6:30 PM IST: the candidate's new jobs, their BDE's searches and captures (null: no BDE). */
export const JobSearchUsageSchema = z.object({
  jobsToday: z.number().int(),
  jobsCap: z.number().int(),
  searchesToday: z.number().int().nullable(),
  searchesCap: z.number().int(),
  capturesToday: z.number().int().nullable(),
  capturesCap: z.number().int(),
  resetsAt: z.string().datetime(),
});
export type JobSearchUsage = z.infer<typeof JobSearchUsageSchema>;

export const JobSearchesSchema = z.object({
  running: JobSearchSchema.nullable(),
  /** Newest first, searches and captures. */
  searches: z.array(JobSearchSchema),
  usage: JobSearchUsageSchema,
});
export type JobSearches = z.infer<typeof JobSearchesSchema>;
