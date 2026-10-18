import { arrayOf } from "@/lib/api/client";
import { ResumeSchema, type Resume } from "@/lib/schemas/resume";
import resumesSeed from "./data/resumes.json";
import { inDevFirm, mockResult, notFound } from "./_shared";

export const allResumes: Resume[] = arrayOf(ResumeSchema).parse(resumesSeed);
const resumes: Resume[] = inDevFirm(allResumes);

/** The firm that owns a resume version (agent runs are firm-scoped, A17). */
export function firmIdForResumeVersion(resumeVersionId: string): string | null {
  return allResumes.find((resume) => resume.versions.some((version) => version.id === resumeVersionId))?.firmId ?? null;
}

export const resumesMock = {
  list: (): Promise<Resume[]> => mockResult(resumes),

  byCandidate: (candidateId: string): Promise<Resume[]> =>
    mockResult(resumes.filter((resume) => resume.candidateId === candidateId)),

  byId: (id: string): Promise<Resume> =>
    mockResult(resumes.find((item) => item.id === id) ?? notFound("Resume", id)),
};
