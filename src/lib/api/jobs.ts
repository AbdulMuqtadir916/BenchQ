import { z } from "zod";
import { ApiError } from "@/lib/api/client";
import type { CaptureJob, Job } from "@/lib/schemas/job";
import type { JobSearches } from "@/lib/schemas/job-search";
import { isLive } from "./config";
import { toBackendId } from "./dto/demo-ids";
import { CapturedPostingDto, FirmJobDto, FirmJobListDto, JobSearchesDto, toBackendCapture, toCapturedJob, toFirmJob, toJobSearches } from "./dto/jobs";
import { http } from "./http";

const mock = () => import("@/mocks/jobs").then((m) => m.jobsMock);

export interface JobListParams {
  limit?: number;
  offset?: number;
  /** One candidate's jobs only (docs/02 §6.z). */
  candidateId?: string;
}

/** The capture found the job the candidate already has; `jobId` is that job, for "View job". */
export function duplicateJobError(jobId: string): ApiError & { jobId: string } {
  return Object.assign(new ApiError("This job is already in this candidate's jobs.", "DUPLICATE_JOB", 409), { jobId });
}

/** backend/api/routes_job_search.py (docs/02 §6.y–§6.z): the firm's jobs and a candidate's searches. */
const firmPath = (firmId: string) => `/api/firms/${toBackendId(firmId)}`;
const candidatePath = (firmId: string, candidateId: string) => `${firmPath(firmId)}/candidates/${toBackendId(candidateId)}`;
const live = {
  list: async (firmId: string, params?: JobListParams): Promise<Job[]> => {
    const query = { limit: params?.limit, candidate_id: params?.candidateId ? toBackendId(params.candidateId) : undefined };
    const { items } = await http.get(`${firmPath(firmId)}/job-postings`, FirmJobListDto, { query });
    return items.map((item) => toFirmJob(item, firmId));
  },
  byId: async (firmId: string, id: string): Promise<Job> => toFirmJob(await http.get(`${firmPath(firmId)}/job-postings/${id}`, FirmJobDto), firmId),
  capture: async (firmId: string, body: CaptureJob): Promise<Job> => {
    const dto = await http.post(`${candidatePath(firmId, body.candidateId)}/job-postings`, CapturedPostingDto, { body: toBackendCapture(body) });
    if (!dto.created) throw duplicateJobError(dto.id);
    return toCapturedJob(dto, firmId);
  },
  searches: async (firmId: string, candidateId: string): Promise<JobSearches> =>
    toJobSearches(await http.get(`${candidatePath(firmId, candidateId)}/job-searches`, JobSearchesDto)),
  startSearch: async (firmId: string, candidateId: string, query: string): Promise<void> => {
    await http.post(`${candidatePath(firmId, candidateId)}/job-searches`, z.object({ batch_id: z.string() }), { body: { query } });
  },
};

/**
 * Firm-scoped (docs/07 T5): every call names the firm, and the backend/mock serves only that firm's rows. Live with
 * `NEXT_PUBLIC_LIVE_MODULES=jobs`: then only the backend's jobs show, never the mock's (decided 2026-11-11).
 */
export const jobsApi = {
  list: async (firmId: string, params?: JobListParams): Promise<Job[]> => (isLive("jobs") ? live.list(firmId, params) : (await mock()).list(firmId, params)),

  byId: async (firmId: string, id: string): Promise<Job> => (isLive("jobs") ? live.byId(firmId, id) : (await mock()).byId(firmId, id)),

  /** For one candidate (their BDE only); the same job again throws `DUPLICATE_JOB` naming the one they have. */
  capture: async (firmId: string, body: CaptureJob): Promise<Job> => (isLive("jobs") ? live.capture(firmId, body) : (await mock()).capture(firmId, body)),

  /** The candidate's running search, past searches and captures, and today's usage. */
  searches: async (firmId: string, candidateId: string): Promise<JobSearches> => (isLive("jobs") ? live.searches(firmId, candidateId) : (await mock()).searches(firmId, candidateId)),

  /** "Find jobs": start a search for a role (the candidate's BDE only); it runs in the background. */
  startSearch: async (firmId: string, candidateId: string, query: string): Promise<void> => (isLive("jobs") ? live.startSearch(firmId, candidateId, query) : (await mock()).startSearch(firmId, candidateId, query)),
};

/** The capture was refused because the candidate already has this job; `jobId` is the existing job. */
export function isDuplicateJob(error: unknown): error is ApiError & { jobId: string } {
  return error instanceof ApiError && error.code === "DUPLICATE_JOB" && typeof (error as { jobId?: unknown }).jobId === "string";
}
