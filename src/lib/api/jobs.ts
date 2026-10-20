import { ApiError } from "@/lib/api/client";
import type { CaptureJob, Job } from "@/lib/schemas/job";

const mock = () => import("@/mocks/jobs").then((m) => m.jobsMock);

/** Firm-scoped (docs/07 T5): every call names the firm, and the backend/mock serves only that firm's rows. */
export const jobsApi = {
  list: async (firmId: string, params?: { limit?: number; offset?: number }): Promise<Job[]> => (await mock()).list(firmId, params),

  byId: async (firmId: string, id: string): Promise<Job> => (await mock()).byId(firmId, id),

  capture: async (firmId: string, body: CaptureJob): Promise<Job> => (await mock()).capture(firmId, body),
};

/** The capture was refused because the firm already has this listing; `jobId` is the existing job. */
export function isDuplicateJob(error: unknown): error is ApiError & { jobId: string } {
  return error instanceof ApiError && error.code === "DUPLICATE_JOB" && typeof (error as { jobId?: unknown }).jobId === "string";
}
