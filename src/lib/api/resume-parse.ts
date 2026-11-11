import type { ResumeDraft } from "@/lib/schemas/resume-draft";
import { toBackendId } from "./dto/demo-ids";
import { BackendResumeParseResponseSchema, toResumeDraft } from "./dto/resume-parse";
import { http } from "./http";

/**
 * The résumé parser (docs/candidate-onboarding/04-wizard-steps.md §5, 06-backend.md §4): sends the file, gets a draft
 * back, saves nothing. A multipart upload to the backend, which keeps the file for 60 minutes for the create to claim.
 * There is no mock: a candidate is only ever made from a real résumé (decided 2026-11-11).
 */
export const resumeParseApi = {
  parse: async (firmId: string, file: File): Promise<ResumeDraft> => {
    const form = new FormData();
    form.append("file", file, file.name);
    return toResumeDraft(await http.postForm(`/api/firms/${toBackendId(firmId)}/candidates/parse-resume`, BackendResumeParseResponseSchema, form));
  },
};
