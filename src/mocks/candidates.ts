import { arrayOf } from "@/lib/api/client";
import { CandidateSchema, UpdateCandidateSchema, type Candidate, type UpdateCandidate } from "@/lib/schemas/candidate";
import candidatesSeed from "./data/candidates.json";
import { inDevFirm, mockResult, notFound } from "./_shared";

/** Every firm's candidates, validated. */
export const allCandidates: Candidate[] = arrayOf(CandidateSchema).parse(candidatesSeed);
export const candidates: Candidate[] = inDevFirm(allCandidates);

export const candidatesMock = {
  list: (): Promise<Candidate[]> => mockResult(candidates),

  byId: (id: string): Promise<Candidate> =>
    mockResult(candidates.find((item) => item.id === id) ?? notFound("Candidate", id)),

  update: (id: string, body: UpdateCandidate): Promise<Candidate> => {
    const candidate = candidates.find((item) => item.id === id) ?? notFound("Candidate", id);
    Object.assign(candidate, UpdateCandidateSchema.parse(body), { updatedAt: new Date().toISOString() });
    return mockResult(CandidateSchema.parse(candidate));
  },
};
