import type { Candidate, CreateCandidate, UpdateCandidate } from "@/lib/schemas/candidate";

const mock = () => import("@/mocks/candidates").then((m) => m.candidatesMock);

/** Firm-scoped (docs/07 T5): every call names the firm, and the backend/mock serves only that firm's rows. */
export const candidatesApi = {
  list: async (firmId: string): Promise<Candidate[]> => (await mock()).list(firmId),

  byId: async (firmId: string, id: string): Promise<Candidate> => (await mock()).byId(firmId, id),

  create: async (firmId: string, body: CreateCandidate): Promise<Candidate> => (await mock()).create(firmId, body),

  update: async (firmId: string, id: string, body: UpdateCandidate): Promise<Candidate> => (await mock()).update(firmId, id, body),

  /** After a BDE's manager changes, their candidates follow (07 Q43). Mock-only: the live backend moves them itself. */
  followBde: async (firmId: string, bdeId: string, managerId: string): Promise<number> => (await mock()).followBde(firmId, bdeId, managerId),
};
