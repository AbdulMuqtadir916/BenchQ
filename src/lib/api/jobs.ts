import { ApiError } from "@/lib/api/client";
import type { CaptureJob, Job } from "@/lib/schemas/job";
import { arrayOf } from "./client";
import { BackendCompanySchema, BackendJobListSchema, companyLookup, toJob, type BackendJob } from "./dto/jobs";
import { http } from "./http";
import { toBackendId } from "./dto/demo-ids";

const mock = () => import("@/mocks/jobs").then((m) => m.jobsMock);

/** Firm-scoped (docs/07 T5): every call names the firm, and the backend/mock serves only that firm's rows. */
export const jobsApi = {
  list: async (firmId: string, params?: { limit?: number; offset?: number }): Promise<Job[]> => (await mock()).list(firmId, params),

  /** Candidate Jobs feed backed by candidate_jobs and candidate favorite state. */
  listForCandidate: async (firmId: string, candidateId: string): Promise<{ jobs: Job[]; favoriteJobIds: string[] }> => {
    const candidateJobs: BackendJob[] = [];
    let offset = 0;
    let total = Number.POSITIVE_INFINITY;
    let favoriteJobIds: string[] = [];
    while (offset < total) {
      const page = await http.get("/api/jobs", BackendJobListSchema, {
        query: { candidate_id: toBackendId(candidateId), limit: 200, offset, sort_by: "date" },
      });
      if (page.candidate_id !== toBackendId(candidateId)) throw new Error("The backend returned Jobs for a different candidate.");
      candidateJobs.push(...page.jobs);
      favoriteJobIds = page.favorite_job_ids ?? [];
      total = page.total;
      offset += page.jobs.length;
      if (page.jobs.length === 0) break;
    }
    const companyDtos = await http.get("/api/companies", arrayOf(BackendCompanySchema));
    const companies = companyLookup(companyDtos);
    return { jobs: candidateJobs.map((job) => toJob(job, firmId, companies)), favoriteJobIds };
  },

  byId: async (firmId: string, id: string): Promise<Job> => (await mock()).byId(firmId, id),

  capture: async (firmId: string, body: CaptureJob): Promise<Job> => (await mock()).capture(firmId, body),
};

/** The capture was refused because the firm already has this listing; `jobId` is the existing job. */
export function isDuplicateJob(error: unknown): error is ApiError & { jobId: string } {
  return error instanceof ApiError && error.code === "DUPLICATE_JOB" && typeof (error as { jobId?: unknown }).jobId === "string";
}
