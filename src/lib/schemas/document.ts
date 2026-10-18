import { z } from "zod";

/**
 * Files a BDE keeps per candidate and sends to vendors on request — visa
 * papers, ID, certifications, original resumes. The same files are the
 * evidence behind verified claims (RecordEvidence.documentId points here).
 */
export const DocumentKind = z.enum(["WORK_AUTH", "IDENTITY", "RESUME", "CERTIFICATION", "EDUCATION", "EMPLOYMENT", "OTHER"]);
export type DocumentKind = z.infer<typeof DocumentKind>;

export const CandidateDocumentSchema = z.object({
  id: z.string(),
  firmId: z.string(),
  candidateId: z.string(),
  kind: DocumentKind,
  title: z.string(),
  fileName: z.string(),
  mimeType: z.string(),
  sizeKb: z.number().int(),
  uploadedAt: z.string().datetime(),
  uploadedByUserId: z.string(),
  expiresAt: z.string().datetime().nullable(),
  shareUrl: z.string(),
});
export type CandidateDocument = z.infer<typeof CandidateDocumentSchema>;

export const UploadDocumentSchema = z.object({
  kind: DocumentKind,
  title: z.string().min(1),
  fileName: z.string().min(1),
  mimeType: z.string(),
  sizeKb: z.number().int().nonnegative(),
  expiresAt: z.string().datetime().nullable(),
});
export type UploadDocument = z.infer<typeof UploadDocumentSchema>;
