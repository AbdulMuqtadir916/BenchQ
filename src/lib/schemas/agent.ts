import { z } from "zod";
import { ResumeClaimSchema } from "./resume";

export const TailorResumeInputSchema = z.object({
  resumeVersionId: z.string().min(1),
  jobId: z.string().min(1),
});
export type TailorResumeInput = z.infer<typeof TailorResumeInputSchema>;

export const AgentDraftSchema = z.object({
  runId: z.string(),
  /** A17: agent runs are firm-scoped. */
  firmId: z.string(),
  resumeVersionId: z.string(),
  jobId: z.string(),
  stages: z.array(z.string()),
  claims: z.array(ResumeClaimSchema),
  generatedAt: z.string().datetime(),
});
export type AgentDraft = z.infer<typeof AgentDraftSchema>;
