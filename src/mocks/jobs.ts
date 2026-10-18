import { arrayOf } from "@/lib/api/client";
import { JobSchema, type Job } from "@/lib/schemas/job";
import jobsSeed from "./data/jobs.json";
import { inDevFirm, mockResult, notFound } from "./_shared";

export const allJobs: Job[] = arrayOf(JobSchema).parse(jobsSeed);
const jobs: Job[] = inDevFirm(allJobs);

export const jobsMock = {
  list: (params?: { limit?: number; offset?: number }): Promise<Job[]> => {
    const limit = params?.limit ?? 50;
    const offset = params?.offset ?? 0;
    return mockResult(jobs.slice(offset, offset + limit));
  },

  byId: (id: string): Promise<Job> => mockResult(jobs.find((item) => item.id === id) ?? notFound("Job", id)),
};
