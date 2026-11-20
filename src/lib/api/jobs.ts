import { z } from "zod";
import { ApiError } from "@/lib/api/client";
import type { CaptureJob, Job } from "@/lib/schemas/job";
import type { JobSearches } from "@/lib/schemas/job-search";
import { toBackendId } from "./dto/demo-ids";
import { CandidatePostingDto, CapturedPostingDto, FirmJobDto, FirmJobListDto, JobSearchesDto, toBackendCapture, toCandidateJob, toCapturedJob, toFirmJob, toJobSearches } from "./dto/jobs";
import { http } from "./http";

/** The most jobs one list read returns (the backend's FIRM_LIST_MAX). */
export const JOBS_LIST_MAX = 400;

export interface JobListParams {
  limit?: number;
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
    // The backend answers at most 400 (routes_job_search.py FIRM_LIST_MAX): a larger ask is a 422, so it is capped here.
    const query = { limit: Math.min(params?.limit ?? JOBS_LIST_MAX, JOBS_LIST_MAX), candidate_id: params?.candidateId ? toBackendId(params.candidateId) : undefined };
    const { items } = await http.get(`${firmPath(firmId)}/job-postings`, FirmJobListDto, { query });
    return items.map((item) => toFirmJob(item, firmId));
  },
  byId: async (firmId: string, id: string): Promise<Job> => toFirmJob(await http.get(`${firmPath(firmId)}/job-postings/${id}`, FirmJobDto), firmId),
  candidateJob: async (firmId: string, candidateId: string, id: string): Promise<Job> =>
    toCandidateJob(await http.get(`${candidatePath(firmId, candidateId)}/job-postings/${id}`, CandidatePostingDto), firmId),
  capture: async (firmId: string, body: CaptureJob): Promise<Job> => {
    const dto = await http.post(`${candidatePath(firmId, body.candidateId)}/job-postings`, CapturedPostingDto, { body: toBackendCapture(body) });
    if (!dto.created) throw duplicateJobError(dto.id);
    return toCapturedJob(dto, firmId);
  },
  searches: async (firmId: string, candidateId: string): Promise<JobSearches> =>
    toJobSearches(await http.get(`${candidatePath(firmId, candidateId)}/job-searches`, JobSearchesDto)),
  startSearch: async (firmId: string, candidateId: string, query: string): Promise<string> =>
    (await http.post(`${candidatePath(firmId, candidateId)}/job-searches`, z.object({ batch_id: z.string() }), { body: { query } })).batch_id,
};

/**
 * Firm-scoped (docs/07 T5): every call names the firm, and the backend serves only the jobs of the candidates the
 * signed-in person sees. Jobs come only from the backend: there is no mock (decided 2026-11-11).
 */
export const jobsApi = {
  list: (firmId: string, params?: JobListParams): Promise<Job[]> => live.list(firmId, params),

  byId: (firmId: string, id: string): Promise<Job> => live.byId(firmId, id),

  /** One of the candidate's own jobs; another candidate's is not-found (Zuhair 2026-11-12: only their jobs). */
  candidateJob: (firmId: string, candidateId: string, id: string): Promise<Job> => live.candidateJob(firmId, candidateId, id),

  /** For one candidate (their BDE only); the same job again throws `DUPLICATE_JOB` naming the one they have. */
  capture: (firmId: string, body: CaptureJob): Promise<Job> => live.capture(firmId, body),

  /** The candidate's running search, past searches and captures, and today's usage. */
  searches: (firmId: string, candidateId: string): Promise<JobSearches> => live.searches(firmId, candidateId),

  /** "Find jobs": start a search for a role (the candidate's BDE only); it runs in the background. Its batch id. */
  startSearch: (firmId: string, candidateId: string, query: string): Promise<string> => live.startSearch(firmId, candidateId, query),
};

/** The capture was refused because the candidate already has this job; `jobId` is the existing job. */
export function isDuplicateJob(error: unknown): error is ApiError & { jobId: string } {
  return error instanceof ApiError && error.code === "DUPLICATE_JOB" && typeof (error as { jobId?: unknown }).jobId === "string";
}
