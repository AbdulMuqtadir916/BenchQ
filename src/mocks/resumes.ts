import { arrayOf } from "@/lib/api/client";
import { ResumeSchema, type Resume } from "@/lib/schemas/resume";
import resumesSeed from "./data/resumes.json";
import { findInFirm, inFirm, mockResult } from "./_shared";
import { firmScoped } from "./membership";

export const allResumes: Resume[] = arrayOf(ResumeSchema).parse(resumesSeed);

export const resumesMock = firmScoped("resumes", {
  list: (firmId: string): Promise<Resume[]> => mockResult(inFirm(allResumes, firmId)),

  byCandidate: (firmId: string, candidateId: string): Promise<Resume[]> =>
    mockResult(inFirm(allResumes, firmId).filter((resume) => resume.candidateId === candidateId)),

  byId: (firmId: string, id: string): Promise<Resume> => mockResult(findInFirm(allResumes, firmId, id, "Resume")),
});
