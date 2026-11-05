import { z } from "zod";
import { ResumeRemovalSchema, type ResumeRemoval, type ResumeShelf } from "@/lib/schemas/resume";
import type { OpenedResume, ResumeDocument, ResumeSaveResult } from "@/lib/schemas/resume-document";
import { isLive } from "./config";
import { ResumeShelfDto, ResumeVersionDto, toOpenedResume, toResumeShelf } from "./dto/resumes";
import { toBackendContent } from "./dto/resume-content";
import { fromBackendId, toBackendId } from "./dto/demo-ids";
import { http } from "./http";
import { ApiError } from "./client";

/**
 * The same file the candidate already has (§4.6, 409): which base it is, and whether that base is hidden (the
 * screen then offers to show it again).
 */
export class DuplicateUploadError extends ApiError {
  baseId: string;
  isHidden: boolean;
  constructor(message: string, baseId: string, isHidden: boolean) {
    super(message, "CONFLICT", 409);
    this.baseId = baseId;
    this.isHidden = isHidden;
  }
}

const mock = () => import("@/mocks/resumes").then((m) => m.resumesMock);

/** backend/api/routes_firm_resumes.py (the firm's, read-only) and routes_candidate_resumes.py (a candidate's). */
const firmPath = (firmId: string, versionId?: string) => `/api/firms/${toBackendId(firmId)}/resumes${versionId ? `/${toBackendId(versionId)}` : ""}`;
const candidatePath = (firmId: string, candidateId: string) => `/api/firms/${toBackendId(firmId)}/candidates/${toBackendId(candidateId)}/resumes`;

const live = {
  shelf: async (firmId: string) => toResumeShelf(await http.get(firmPath(firmId), ResumeShelfDto), firmId),
  shelfByCandidate: async (firmId: string, candidateId: string) =>
    toResumeShelf(await http.get(candidatePath(firmId, candidateId), ResumeShelfDto), firmId),
  open: async (firmId: string, versionId: string) => {
    const version = await http.get(firmPath(firmId, versionId), ResumeVersionDto);
    return toOpenedResume(version, await live.shelfByCandidate(firmId, fromBackendId(version.candidate_id)));
  },
  /** Option 1 (2026-11-05): read the version again, lay the studio's edits over it, save that as the next version. */
  save: async (firmId: string, versionId: string, doc: ResumeDocument): Promise<ResumeSaveResult> => {
    const source = await http.get(firmPath(firmId, versionId), ResumeVersionDto);
    const candidateId = fromBackendId(source.candidate_id);
    const saved = await http.post(`${candidatePath(firmId, candidateId)}/${toBackendId(versionId)}/save`, SavedDto, { body: toBackendContent(doc, source) });
    return { opened: toOpenedResume(saved, await live.shelfByCandidate(firmId, candidateId)), notice: saved.notice };
  },
  useAsBase: async (firmId: string, candidateId: string, versionId: string) => {
    await http.post(`${candidatePath(firmId, candidateId)}/${toBackendId(versionId)}/use-as-base`, Ack);
  },
  upload: async (firmId: string, candidateId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    try {
      const answer = await http.postForm(`${candidatePath(firmId, candidateId)}/upload`, Uploaded, form);
      return { restored: answer.restored, fileName: file.name };
    } catch (error) {
      const base = error instanceof ApiError && error.status === 409 ? error.details?.base_resume_id : undefined;
      if (error instanceof ApiError && typeof base === "string") throw new DuplicateUploadError(error.message, fromBackendId(base), error.details?.hidden === true);
      throw error;
    }
  },
  baseRemoval: (firmId: string, candidateId: string, baseId: string) => http.get(`${candidatePath(firmId, candidateId)}/bases/${toBackendId(baseId)}/removal`, ResumeRemovalSchema),
  versionRemoval: (firmId: string, candidateId: string, versionId: string) => http.get(`${candidatePath(firmId, candidateId)}/${toBackendId(versionId)}/removal`, ResumeRemovalSchema),
  deleteBase: (firmId: string, candidateId: string, baseId: string, keepUsed: boolean) =>
    http.delete(`${candidatePath(firmId, candidateId)}/bases/${toBackendId(baseId)}`, ResumeRemovalSchema, { query: { keep_used: keepUsed } }),
  deleteVersion: (firmId: string, candidateId: string, versionId: string) => http.delete(`${candidatePath(firmId, candidateId)}/${toBackendId(versionId)}`, ResumeRemovalSchema),
  showBase: async (firmId: string, candidateId: string, baseId: string) => {
    const base = await http.post(`${candidatePath(firmId, candidateId)}/bases/${toBackendId(baseId)}/show`, z.object({ number: z.number().int() }));
    return { number: base.number };
  },
};

const SavedDto = ResumeVersionDto.extend({ notice: z.string().nullable() });
const Ack = z.object({ id: z.string() });
const Uploaded = z.object({ restored: z.boolean() });

/**
 * Firm-scoped (docs/07 T5): every call names the firm, and the backend/mock serves only that firm's rows, in the
 * principal's scope. Live with `NEXT_PUBLIC_LIVE_MODULES=resumes` (résumé versioning PR 7).
 */
export const resumesApi = {
  /** Every base and résumé of the candidates the principal sees (the Resume Builder library). */
  shelf: async (firmId: string): Promise<ResumeShelf> => (isLive("resumes") ? live.shelf(firmId) : (await mock()).shelf(firmId)),

  /** One candidate's bases and résumés (their Résumés tab, an application's "résumé sent"). */
  shelfByCandidate: async (firmId: string, candidateId: string): Promise<ResumeShelf> =>
    isLive("resumes") ? live.shelfByCandidate(firmId, candidateId) : (await mock()).shelfByCandidate(firmId, candidateId),

  /** One version with its text, for the studio: its id alone names it. */
  open: async (firmId: string, versionId: string): Promise<OpenedResume> =>
    isLive("resumes") ? live.open(firmId, versionId) : (await mock()).open(firmId, versionId),

  /** Save the studio's edit of `versionId` as its résumé's next version (§4.3); a `notice` when another came first. */
  save: async (firmId: string, versionId: string, doc: ResumeDocument): Promise<ResumeSaveResult> =>
    isLive("resumes") ? live.save(firmId, versionId, doc) : (await mock()).save(firmId, versionId, doc),

  /** "Use this as the base?" Yes, and picking a base: a base's v1 makes it active; any other version promotes. */
  useAsBase: async (firmId: string, candidateId: string, versionId: string): Promise<void> =>
    isLive("resumes") ? live.useAsBase(firmId, candidateId, versionId) : (await mock()).useAsBase(firmId, candidateId, versionId),

  /** The BDE's later résumé (§4.6): a new active base. `restored` when the same file brought back a deleted base. */
  upload: async (firmId: string, candidateId: string, file: File): Promise<{ restored: boolean; fileName: string }> =>
    isLive("resumes") ? live.upload(firmId, candidateId, file) : (await mock()).upload(firmId, candidateId, file.name),

  /** What deleting a base or a version would do (the warning), and doing it (§4.7). */
  baseRemoval: async (firmId: string, candidateId: string, baseId: string): Promise<ResumeRemoval> =>
    isLive("resumes") ? live.baseRemoval(firmId, candidateId, baseId) : (await mock()).baseRemoval(firmId, candidateId, baseId),
  versionRemoval: async (firmId: string, candidateId: string, versionId: string): Promise<ResumeRemoval> =>
    isLive("resumes") ? live.versionRemoval(firmId, candidateId, versionId) : (await mock()).versionRemoval(firmId, candidateId, versionId),
  deleteBase: async (firmId: string, candidateId: string, baseId: string, keepUsed: boolean): Promise<ResumeRemoval> =>
    isLive("resumes") ? live.deleteBase(firmId, candidateId, baseId, keepUsed) : (await mock()).deleteBase(firmId, candidateId, baseId, keepUsed),
  deleteVersion: async (firmId: string, candidateId: string, versionId: string): Promise<ResumeRemoval> =>
    isLive("resumes") ? live.deleteVersion(firmId, candidateId, versionId) : (await mock()).deleteVersion(firmId, candidateId, versionId),
  /** Show a hidden base again; it isn't made active. */
  showBase: async (firmId: string, candidateId: string, baseId: string): Promise<{ number: number }> =>
    isLive("resumes") ? live.showBase(firmId, candidateId, baseId) : (await mock()).showBase(firmId, candidateId, baseId),
};
