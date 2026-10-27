import type { ResumeDraft } from "@/lib/schemas/resume-draft";
import { isLive } from "./config";
import { toResumeDraft } from "./dto/resume-parse";

const mock = () => import("@/mocks/candidates");

/**
 * The résumé parser (docs/candidate-onboarding/04-wizard-steps.md §5, 06-backend.md §4): sends the file, gets a draft
 * back, saves nothing. On mocks the answer is a fixture in the backend's own format, mapped by the real mapper.
 * The backend endpoint goes live with the candidates module (onboarding 07).
 */
export const resumeParseApi = {
  parse: async (firmId: string, file: File): Promise<ResumeDraft> => {
    const answer = await (await mock()).candidatesMock.parseResume(firmId, { fileName: file.name, sizeBytes: file.size, mimeType: file.type });
    return toResumeDraft(answer);
  },

  /** "Try a sample" résumés: only while candidates run on mocks (README assumption A1). */
  sampleNames: async (): Promise<readonly string[]> => (isLive("candidates") ? [] : (await mock()).SAMPLE_RESUME_NAMES),
};
