import { z } from "zod";
import { ApiError } from "@/lib/api/client";
import type { CaptureJob, Job } from "@/lib/schemas/job";
import type { JobSearches } from "@/lib/schemas/job-search";
import { toBackendId } from "./dto/demo-ids";
import { CandidatePostingDto, CapturedPostingDto, FirmJobDto, FirmJobListDto, JobSearchesDto, toBackendCapture, toCandidateJob, toCapturedJob, toFirmJob, toJobSearches } from "./dto/jobs";
import { http } from "./http";

/** The most jobs one list read returns (the backend's FIRM_LIST_MAX). */
export const JOBS_LIST_MAX = 400;
/** A job list's page (decided 2026-11-14, Q29): "Load more" reads the next one. */
export const JOBS_PAGE = 100;

export type JobSort = "match" | "newest" | "company";
/** The backend's source names for the list's source filter (portal-logo.tsx `PortalKey`). */
export type JobSourceFilter = "indeed" | "freehire" | "linkedin" | "manual" | "extension" | "other";

export interface JobListParams {
  limit?: number;
  /** One candidate's jobs only (docs/02 §6.z). */
  candidateId?: string;
  /** Sorted and filtered by the backend, over the whole list (decided 2026-11-14, Q47). `match`: one candidate's. */
  sort?: JobSort;
  minScore?: number;
  source?: JobSourceFilter;
  remote?: "REMOTE" | "HYBRID" | "ONSITE";
  q?: string;
  /** One candidate's jobs they have an application for past Saved, left out. */
  excludeApplied?: boolean;
  /** One of the candidate's searches (its id): the jobs it first found (decided 2026-11-17, Q109). */
  batch?: string;
  /** One of the candidate's Days (decided 2026-11-17, Q166): every batch of that Day in the current assignment. */
  day?: number;
  offset?: number;
}

export interface JobPage {
  jobs: Job[];
  /** Every job the list holds with these filters, not only this page's. */
  total: number;
  /** Where the next page starts, or null at the end. */
  nextOffset: number | null;
  /** The list's jobs by source before `source` narrows it, by backend source name (the source tabs, Q109). */
  sourceCounts: Record<string, number>;
}

/** The capture found the job the candidate already has; `jobId` is that job, for "View job". */
export function duplicateJobError(jobId: string): ApiError & { jobId: string } {
  return Object.assign(new ApiError("This job is already in this candidate's jobs.", "DUPLICATE_JOB", 409), { jobId });
}

/** backend/api/routes_job_search.py (docs/02 §6.y–§6.z): the firm's jobs and a candidate's searches. */
const firmPath = (firmId: string) => `/api/firms/${toBackendId(firmId)}`;
const candidatePath = (firmId: string, candidateId: string) => `${firmPath(firmId)}/candidates/${toBackendId(candidateId)}`;
const live = {
  page: async (firmId: string, params?: JobListParams): Promise<JobPage> => {
    // The backend answers at most 400 (routes_job_search.py FIRM_LIST_MAX): a larger ask is a 422, so it is capped here.
    const query = {
      limit: Math.min(params?.limit ?? JOBS_LIST_MAX, JOBS_LIST_MAX),
      candidate_id: params?.candidateId ? toBackendId(params.candidateId) : undefined,
      sort: params?.sort, min_score: params?.minScore || undefined, source: params?.source, remote: params?.remote,
      q: params?.q?.trim() || undefined, exclude_applied: params?.excludeApplied || undefined, offset: params?.offset || undefined,
      batch: params?.batch || undefined, day: params?.day || undefined,
    };
    const { items, total, next_offset, source_counts } = await http.get(`${firmPath(firmId)}/job-postings`, FirmJobListDto, { query });
    return { jobs: items.map((item) => toFirmJob(item, firmId)), total: total ?? items.length, nextOffset: next_offset ?? null,
      sourceCounts: source_counts ?? {} };
  },
  byId: async (firmId: string, id: string): Promise<Job> => toFirmJob(await http.get(`${firmPath(firmId)}/job-postings/${id}`, FirmJobDto), firmId),
  /** The posting the BDE copied for a job that came without its text (a LinkedIn job, decided 2026-11-17, Q107). */
  pastePosting: async (firmId: string, candidateId: string, id: string, text: string): Promise<Job> =>
    toCandidateJob(await http.put(`${candidatePath(firmId, candidateId)}/job-postings/${id}/posting`, CandidatePostingDto, { body: { text } }), firmId),
  candidateJob: async (firmId: string, candidateId: string, id: string): Promise<Job> =>
    toCandidateJob(await http.get(`${candidatePath(firmId, candidateId)}/job-postings/${id}`, CandidatePostingDto), firmId),
  capture: async (firmId: string, body: CaptureJob): Promise<Job> => {
    const dto = await http.post(`${candidatePath(firmId, body.candidateId)}/job-postings`, CapturedPostingDto, { body: toBackendCapture(body) });
    if (!dto.created) throw duplicateJobError(dto.id);
    return toCapturedJob(dto, firmId);
  },
  searches: async (firmId: string, candidateId: string): Promise<JobSearches> =>
    toJobSearches(await http.get(`${candidatePath(firmId, candidateId)}/job-searches`, JobSearchesDto)),
  /** Starts a search of the candidate's target role in `place`, one of their places (`JobSearches.places`): the
   * place's mode says which sources one click asks (decided 2026-11-17, Q90, Q122). */
  startSearch: async (firmId: string, candidateId: string, place: string): Promise<string> =>
    (await http.post(`${candidatePath(firmId, candidateId)}/job-searches`, z.object({ batch_id: z.string() }), { body: { place } })).batch_id,
};

/**
 * Firm-scoped (docs/07 T5): every call names the firm, and the backend serves only the jobs of the candidates the
 * signed-in person sees. Jobs come only from the backend: there is no mock (decided 2026-11-11).
 */
export const jobsApi = {
  /** One page's jobs (a dashboard's, ⌘K's): the first `limit` of the list these params make. */
  list: async (firmId: string, params?: JobListParams): Promise<Job[]> => (await live.page(firmId, params)).jobs,

  /** A page of the list, with the whole list's total and where the next page starts (the job lists' "Load more"). */
  page: (firmId: string, params?: JobListParams): Promise<JobPage> => live.page(firmId, params),

  byId: (firmId: string, id: string): Promise<Job> => live.byId(firmId, id),

  /** One of the candidate's own jobs; another candidate's is not-found (Zuhair 2026-11-12: only their jobs). */
  candidateJob: (firmId: string, candidateId: string, id: string): Promise<Job> => live.candidateJob(firmId, candidateId, id),

  /** Paste a LinkedIn job's posting so it can be tailored (BenchQ never fetches LinkedIn postings). */
  pastePosting: (firmId: string, candidateId: string, id: string, text: string): Promise<Job> => live.pastePosting(firmId, candidateId, id, text),

  /** For one candidate (their BDE only); the same job again throws `DUPLICATE_JOB` naming the one they have. */
  capture: (firmId: string, body: CaptureJob): Promise<Job> => live.capture(firmId, body),

  /** The candidate's running search, past searches and captures, and today's usage. */
  searches: (firmId: string, candidateId: string): Promise<JobSearches> => live.searches(firmId, candidateId),

  /** "Find jobs": start a search for a role (the candidate's BDE only); it runs in the background. Its batch id. */
  startSearch: (firmId: string, candidateId: string, place: string): Promise<string> => live.startSearch(firmId, candidateId, place),
};

/** The capture was refused because the candidate already has this job; `jobId` is the existing job. */
export function isDuplicateJob(error: unknown): error is ApiError & { jobId: string } {
  return error instanceof ApiError && error.code === "DUPLICATE_JOB" && typeof (error as { jobId?: unknown }).jobId === "string";
}
