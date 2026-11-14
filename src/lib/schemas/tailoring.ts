import { z } from "zod";

/** Tailoring a résumé (docs/02 §8.3): a background run the BDE starts for one of the candidate's own jobs. */

/** What a running tailoring is doing: the tailor's five model steps, then the save (tailoring part 3, R2-Q1). */
export const TAILORING_STEPS = ["analyse", "draft", "review", "revise", "verify", "save"] as const;
export type TailoringStep = (typeof TAILORING_STEPS)[number];

export const StartTailoringSchema = z.object({
  candidateId: z.string(),
  /** The candidate's own posting (docs/04 §5.3). */
  jobId: z.string(),
  /** A base's version; absent: the active base's v1. */
  resumeId: z.string().optional(),
});
export type StartTailoring = z.infer<typeof StartTailoringSchema>;

export const TailoringRunSchema = z.object({
  runId: z.string(),
  status: z.enum(["running", "completed", "failed"]),
  /** While running only. */
  step: z.enum(TAILORING_STEPS).nullable(),
  /** The TAILORED version, once completed. */
  resumeId: z.string().nullable(),
  errorCode: z.string().nullable(),
  candidateId: z.string(),
  sourceResumeId: z.string().nullable(),
  /** Known at the start for a v1, else once completed. */
  baseResumeId: z.string().nullable(),
  jobId: z.string().nullable(),
  jobTitle: z.string(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
});
export type TailoringRun = z.infer<typeof TailoringRunSchema>;
