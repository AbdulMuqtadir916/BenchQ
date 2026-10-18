import { arrayOf } from "@/lib/api/client";
import {
  CandidateDocumentSchema,
  UploadDocumentSchema,
  type CandidateDocument,
  type UploadDocument,
} from "@/lib/schemas/document";
import documentsSeed from "./data/documents.json";
import { candidates } from "./candidates";
import { currentUser } from "./team";
import { inDevFirm, mockResult, notFound } from "./_shared";

export const allDocuments: CandidateDocument[] = arrayOf(CandidateDocumentSchema).parse(documentsSeed);
const documents: CandidateDocument[] = inDevFirm(allDocuments);

export const documentsMock = {
  byCandidate: (candidateId: string): Promise<CandidateDocument[]> =>
    mockResult(documents.filter((document) => document.candidateId === candidateId)),

  upload: (candidateId: string, body: UploadDocument): Promise<CandidateDocument> => {
    const candidate = candidates.find((item) => item.id === candidateId) ?? notFound("Candidate", candidateId);
    const id = `doc_local_${Date.now().toString(36)}`;
    const document = CandidateDocumentSchema.parse({
      ...UploadDocumentSchema.parse(body),
      id,
      firmId: candidate.firmId,
      candidateId,
      uploadedAt: new Date().toISOString(),
      uploadedByUserId: currentUser().id,
      shareUrl: `https://files.benchq.app/s/${id}`,
    });
    documents.unshift(document);
    return mockResult(document);
  },

  remove: (id: string): Promise<CandidateDocument> => {
    const index = documents.findIndex((document) => document.id === id);
    if (index < 0) return notFound("Document", id);
    const [removed] = documents.splice(index, 1);
    return mockResult(removed!);
  },
};
