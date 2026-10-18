import type { Record_ } from "@/lib/schemas/record";

const mock = () => import("@/mocks/records").then((m) => m.recordsMock);

/** Firm-scoped (docs/07 T5): every call names the firm, and the backend/mock serves only that firm's rows. */
export const recordsApi = {
  byCandidate: async (firmId: string, candidateId: string): Promise<Record_> => (await mock()).byCandidate(firmId, candidateId),
};
