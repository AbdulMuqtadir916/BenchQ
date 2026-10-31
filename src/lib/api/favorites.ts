import { z } from "zod";
import type { Job } from "@/lib/schemas/job";
import { http } from "./http";
import { toBackendId } from "./dto/demo-ids";

const SavedResultSchema = z.object({
  id: z.string(),
  job_id: z.string(),
  candidate_id: z.string(),
  status: z.string(),
  favorite: z.literal(true),
});

const UnfavoriteResultSchema = z.object({
  favorite: z.literal(false),
  application_id: z.string(),
  application_preserved: z.boolean(),
  status: z.string().nullable(),
});

/** Candidate-scoped favorite writes backed by favorite_jobs and applications. */
export const candidateFavoritesApi = {
  save: async (candidateId: string, job: Job) => http.post("/api/applications", SavedResultSchema, {
    body: {
      title: job.title,
      company: job.company.name,
      url: job.applyUrl ?? job.provenance.sourceUrl ?? "https://jobs.example.invalid/unknown",
      candidate_id: toBackendId(candidateId),
      job_id: job.id,
      status: "saved",
    },
  }),

  unfavorite: async (applicationId: string) => http.patch(
    `/api/applications/${applicationId}`,
    UnfavoriteResultSchema,
    { body: { unfavorite: true } },
  ),
};
