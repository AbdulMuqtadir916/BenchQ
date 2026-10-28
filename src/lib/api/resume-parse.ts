import type { ResumeDraft } from "@/lib/schemas/resume-draft";
import { isLive } from "./config";
import { toBackendId } from "./dto/demo-ids";
import { BackendResumeParseResponseSchema, toResumeDraft } from "./dto/resume-parse";
import { http } from "./http";

const mock = () => import("@/mocks/candidates");

/**
 * The résumé parser (docs/candidate-onboarding/04-wizard-steps.md §5, 06-backend.md §4): sends the file, gets a draft
 * back, saves nothing. Live with `NEXT_PUBLIC_LIVE_MODULES=candidates`: a multipart upload to the backend, which keeps
 * the file for 60 minutes for the create to claim. On mocks the answer is a fixture in the backend's own format,
 * mapped by the same mapper.
 */
export const resumeParseApi = {
  parse: async (firmId: string, file: File): Promise<ResumeDraft> => {
    if (isLive("candidates")) {
      const form = new FormData();
      form.append("file", file, file.name);
      return toResumeDraft(await http.postForm(`/api/firms/${toBackendId(firmId)}/candidates/parse-resume`, BackendResumeParseResponseSchema, form));
    }
    const answer = await (await mock()).candidatesMock.parseResume(firmId, { fileName: file.name, sizeBytes: file.size, mimeType: file.type });
    return toResumeDraft(answer);
  },

  /** "Try a sample" résumés: only while candidates run on mocks (README assumption A1). */
  sampleNames: async (): Promise<readonly string[]> => (isLive("candidates") ? [] : (await mock()).SAMPLE_RESUME_NAMES),
};
