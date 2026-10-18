import type { CandidateDocument, UploadDocument } from "@/lib/schemas/document";

const mock = () => import("@/mocks/documents").then((m) => m.documentsMock);

/** Firm-scoped (docs/07 T5): every call names the firm, and the backend/mock serves only that firm's rows. */
export const documentsApi = {
  byCandidate: async (firmId: string, candidateId: string): Promise<CandidateDocument[]> => (await mock()).byCandidate(firmId, candidateId),

  upload: async (firmId: string, candidateId: string, body: UploadDocument): Promise<CandidateDocument> =>
    (await mock()).upload(firmId, candidateId, body),

  remove: async (firmId: string, id: string): Promise<CandidateDocument> => (await mock()).remove(firmId, id),
};
