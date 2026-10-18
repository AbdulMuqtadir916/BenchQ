import { arrayOf } from "@/lib/api/client";
import { CandidateSchema, UpdateCandidateSchema, type Candidate, type UpdateCandidate } from "@/lib/schemas/candidate";
import candidatesSeed from "./data/candidates.json";
import { findInFirm, inFirm, mockResult } from "./_shared";
import { firmScoped } from "./membership";

/** Every firm's candidates, validated. */
export const allCandidates: Candidate[] = arrayOf(CandidateSchema).parse(candidatesSeed);

export const candidatesMock = firmScoped("candidates", {
  list: (firmId: string): Promise<Candidate[]> => mockResult(inFirm(allCandidates, firmId)),

  byId: (firmId: string, id: string): Promise<Candidate> => mockResult(findInFirm(allCandidates, firmId, id, "Candidate")),

  update: (firmId: string, id: string, body: UpdateCandidate): Promise<Candidate> => {
    const candidate = findInFirm(allCandidates, firmId, id, "Candidate");
    Object.assign(candidate, UpdateCandidateSchema.parse(body), { updatedAt: new Date().toISOString() });
    return mockResult(CandidateSchema.parse(candidate));
  },
});
