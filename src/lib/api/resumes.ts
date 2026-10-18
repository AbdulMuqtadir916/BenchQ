import type { Resume } from "@/lib/schemas/resume";

const mock = () => import("@/mocks/resumes").then((m) => m.resumesMock);

/** Firm-scoped (docs/07 T5): every call names the firm, and the backend/mock serves only that firm's rows. */
export const resumesApi = {
  list: async (firmId: string): Promise<Resume[]> => (await mock()).list(firmId),

  byCandidate: async (firmId: string, candidateId: string): Promise<Resume[]> => (await mock()).byCandidate(firmId, candidateId),

  byId: async (firmId: string, id: string): Promise<Resume> => (await mock()).byId(firmId, id),
};
