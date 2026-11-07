import { ApiError } from "@/lib/api/client";
import type { CaptureJob, Job } from "@/lib/schemas/job";
import { isLive } from "./config";
import { http } from "./http";
import { toBackendId } from "./dto/demo-ids";
import { BackendJobListSchema, BackendJobSchema, toJob } from "./dto/jobs";

const mock = () => import("@/mocks/jobs").then((m) => m.jobsMock);

/** The backend serves at most 200 jobs per request (`GET /api/jobs`, `limit ≤ 200`). */
const PAGE = 200;

/** The backend takes the firm from the session. An empty feed is an empty list, never an error. */
const live = {
  list: async (firmId: string, params?: { limit?: number; offset?: number }): Promise<Job[]> => {
    const wanted = params?.limit ?? PAGE;
    const start = params?.offset ?? 0;
    const rows = [];
    for (let offset = start; rows.length < wanted; offset += PAGE) {
      const limit = Math.min(PAGE, wanted - rows.length);
      const page = await http.get("/api/jobs", BackendJobListSchema, { query: { limit, offset } });
      rows.push(...page.jobs);
      if (page.jobs.length < limit || offset + page.jobs.length >= page.total) break;
    }
    return [...new Map(rows.map((row) => [row.id, row])).values()].map((row) => toJob(row, firmId));
  },

  byId: async (firmId: string, id: string): Promise<Job> => toJob(await http.get(`/api/jobs/${encodeURIComponent(toBackendId(id))}`, BackendJobSchema), firmId),

  /** Hand capture has no backend endpoint yet (Jobs track 02); refused rather than written to the mock. */
  capture: async (): Promise<Job> => {
    throw new ApiError("Adding a job by hand is not connected to the backend yet.", "NOT_AVAILABLE", 501);
  },
};

/** Firm-scoped (docs/07 T5): every call names the firm, and the backend/mock serves only that firm's rows. */
export const jobsApi = {
  list: async (firmId: string, params?: { limit?: number; offset?: number }): Promise<Job[]> =>
    isLive("jobs") ? live.list(firmId, params) : (await mock()).list(firmId, params),

  byId: async (firmId: string, id: string): Promise<Job> => (isLive("jobs") ? live.byId(firmId, id) : (await mock()).byId(firmId, id)),

  capture: async (firmId: string, body: CaptureJob): Promise<Job> => (isLive("jobs") ? live.capture() : (await mock()).capture(firmId, body)),
};

/** The capture was refused because the firm already has this listing; `jobId` is the existing job. */
export function isDuplicateJob(error: unknown): error is ApiError & { jobId: string } {
  return error instanceof ApiError && error.code === "DUPLICATE_JOB" && typeof (error as { jobId?: unknown }).jobId === "string";
}
