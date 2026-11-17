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
  /** Where it searched: "City, ST", "remote", or null (a capture, or a search from before places, 2026-11-14). */
  place: z.string().nullable(),
  newCount: z.number().int(),
  seenAgainCount: z.number().int(),
  overLimitCount: z.number().int(),
  /** Left out by the search (decided 2026-11-14): the job's text rules out the candidate's work authorization,
   * it was posted over 14 days ago, or it isn't remote on a Remote search. */
  leftOutWorkAuthCount: z.number().int(),
  leftOutOldCount: z.number().int(),
  leftOutNotRemoteCount: z.number().int(),
  /** Left out because freehire.me passed it on from Adzuna, as a preview only (decided 2026-11-16, Q64). */
  leftOutAdzunaCount: z.number().int(),
  /** Left out because Match holds it at 40 for the candidate's level: far more years asked, or two rungs away (Q70). */
  leftOutLevelCount: z.number().int(),
  /** New jobs by source, for a click that asked several (decided 2026-11-17, Q90): backend source name → count. */
  newBySource: z.record(z.string(), z.number().int()),
  /** Sources that failed in that click (Q93): backend source names. */
  failedSources: z.array(z.string()),
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

/** One of the candidate's places a search can use (backend/job_search/places.py): the résumé's city and state, a
 * preferred location, or remote anywhere in the country. `value` is what a search sends. */
export const JobSearchPlaceSchema = z.object({
  value: z.string(),
  label: z.string(),
  kind: z.enum(["home", "preferred", "remote"]),
});
export type JobSearchPlace = z.infer<typeof JobSearchPlaceSchema>;

export const JobSearchesSchema = z.object({
  running: JobSearchSchema.nullable(),
  /** Newest first, searches and captures. */
  searches: z.array(JobSearchSchema),
  usage: JobSearchUsageSchema,
  /** The role a search asks for: the candidate's target role (decided 2026-11-14); null without one. */
  role: z.string().nullable(),
  /** The places the BDE picks from, in order; empty when the candidate has none (no search then). */
  places: z.array(JobSearchPlaceSchema),
});
export type JobSearches = z.infer<typeof JobSearchesSchema>;
