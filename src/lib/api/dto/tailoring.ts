import { z } from "zod";
import { TAILORING_STEPS, TailoringRunSchema, type StartTailoring, type TailoringRun } from "@/lib/schemas/tailoring";
import { fromBackendId, toBackendId } from "./demo-ids";
import { toIsoOrNull } from "./shared";

/** backend/resume_tailor/runs.py `run_json` → `TailoringRun` (docs/02 §8.3). */
export const TailoringRunDto = z.object({
  run_id: z.string(),
  status: z.enum(["running", "completed", "failed"]),
  step: z.string().nullable().optional(),
  resume_id: z.string().nullable(),
  error_code: z.string().nullable(),
  candidate_id: z.string().nullable().optional(),
  source_resume_id: z.string().nullable().optional(),
  base_resume_id: z.string().nullable().optional(),
  job_posting_id: z.string().nullable().optional(),
  job_title: z.string().optional(),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
});
export type TailoringRunDto = z.infer<typeof TailoringRunDto>;

const id = (value: string | null | undefined) => (value ? fromBackendId(value) : null);
const isStep = (value: string | null | undefined): value is (typeof TAILORING_STEPS)[number] =>
  (TAILORING_STEPS as readonly string[]).includes(value ?? "");

export function toTailoringRun(dto: TailoringRunDto): TailoringRun {
  return TailoringRunSchema.parse({
    runId: dto.run_id,
    status: dto.status,
    // A step this screen doesn't know (a newer backend) shows as no step rather than breaking the panel.
    step: dto.status === "running" && isStep(dto.step) ? dto.step : null,
    resumeId: id(dto.resume_id),
    errorCode: dto.error_code,
    candidateId: id(dto.candidate_id) ?? "",
    sourceResumeId: id(dto.source_resume_id),
    baseResumeId: id(dto.base_resume_id),
    jobId: dto.job_posting_id ?? null,
    jobTitle: dto.job_title ?? "",
    startedAt: toIsoOrNull(dto.started_at),
    finishedAt: toIsoOrNull(dto.finished_at),
  });
}

/** The start's body: the job is the candidate's own posting id, as the job screens hold it. */
export function toStartBody(input: StartTailoring): { job_posting_id: string; resume_id?: string } {
  return { job_posting_id: input.jobId, ...(input.resumeId ? { resume_id: toBackendId(input.resumeId) } : {}) };
}
