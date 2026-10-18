import { arrayOf } from "@/lib/api/client";
import { JobSchema, type Job } from "@/lib/schemas/job";
import jobsSeed from "./data/jobs.json";
import { findInFirm, inFirm, mockResult } from "./_shared";

export const allJobs: Job[] = arrayOf(JobSchema).parse(jobsSeed);

export const jobsMock = {
  list: (firmId: string, params?: { limit?: number; offset?: number }): Promise<Job[]> => {
    const limit = params?.limit ?? 50;
    const offset = params?.offset ?? 0;
    return mockResult(inFirm(allJobs, firmId).slice(offset, offset + limit));
  },

  byId: (firmId: string, id: string): Promise<Job> => mockResult(findInFirm(allJobs, firmId, id, "Job")),
};
