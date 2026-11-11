import { arrayOf } from "@/lib/api/client";
import {
  CandidateDocumentSchema,
  UploadDocumentSchema,
  type CandidateDocument,
  type UploadDocument,
} from "@/lib/schemas/document";
import documentsSeed from "./data/documents.json";
import { candidatesApi } from "@/lib/api/candidates";
import { currentUser } from "./auth";
import { findInFirm, inFirm, mockResult } from "./_shared";
import { firmScoped } from "./membership";
import { changed, table } from "./db";

export const allDocuments: CandidateDocument[] = table("documents", CandidateDocumentSchema, () => arrayOf(CandidateDocumentSchema).parse(documentsSeed));

export const documentsMock = firmScoped("documents", {
  byCandidate: (firmId: string, candidateId: string): Promise<CandidateDocument[]> =>
    mockResult(inFirm(allDocuments, firmId).filter((document) => document.candidateId === candidateId)),

  upload: async (firmId: string, candidateId: string, body: UploadDocument): Promise<CandidateDocument> => {
    // A candidate the principal sees, from the backend (no candidates mock): another is its 404.
    const candidate = await candidatesApi.byId(firmId, candidateId);
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
    allDocuments.unshift(document);
    changed("documents");
    return mockResult(document);
  },

  remove: (firmId: string, id: string): Promise<CandidateDocument> => {
    const document = findInFirm(allDocuments, firmId, id, "Document");
    allDocuments.splice(allDocuments.indexOf(document), 1);
    changed("documents");
    return mockResult(document);
  },
}, { upload: "candidate.edit", remove: "candidate.edit" });
