import { z } from "zod";
import { ResumeRemovalSchema, type ResumeRemoval, type ResumeShelf } from "@/lib/schemas/resume";
import type { OpenedResume, ResumeDocument, ResumeSaveResult } from "@/lib/schemas/resume-document";
import type { AutofillChange, AutofillSaveResult, ResumeAutofill } from "@/lib/schemas/resume-autofill";
import { ResumeShelfDto, ResumeVersionDto, toOpenedResume, toResumeShelf } from "./dto/resumes";
import { AutofillSavedDto, AutofillVersionDto, toAutofillChangeBody, toResumeAutofill, toVersionAutofill } from "./dto/resume-autofill";
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

/** backend/api/routes_firm_resumes.py (the firm's, read-only) and routes_candidate_resumes.py (a candidate's). */
const firmPath = (firmId: string, versionId?: string) => `/api/firms/${toBackendId(firmId)}/resumes${versionId ? `/${toBackendId(versionId)}` : ""}`;
const candidatePath = (firmId: string, candidateId: string) => `/api/firms/${toBackendId(firmId)}/candidates/${toBackendId(candidateId)}/resumes`;

/**
 * The versions this tab has read, by firm and id. A version never changes once saved (a save makes the next one), so
 * the save builds its body from the one `open` read instead of reading it again (Abdul's PR 7 review, #7); a version
 * not held here is read first. The oldest go past `KEPT`. Emptied when the signed-in person changes, with the query cache
 * (`clearReadVersions`; Abdul's re-review).
 */
const KEPT = 50;
const versionsRead = new Map<string, ResumeVersionDto>();
const versionKey = (firmId: string, versionId: string) => `${firmId}:${versionId}`;
/** Bumped by `clearReadVersions`: a read started before the principal changed must not refill the map after it. */
let generation = 0;
/** Hold `version`, unless the principal changed since the read that returned it began (`startedIn`). */
function keep(firmId: string, version: ResumeVersionDto, startedIn: number) {
  if (startedIn !== generation) return;
  const key = versionKey(firmId, fromBackendId(version.id));
  versionsRead.delete(key);
  versionsRead.set(key, version);
  if (versionsRead.size > KEPT) versionsRead.delete(versionsRead.keys().next().value as string);
}
/** Forget every version read (the principal changed: src/lib/query/principal-boundary.ts). */
export function clearReadVersions(): void {
  generation += 1;
  versionsRead.clear();
}
/** The version held for the save, or read from the backend when it isn't held. */
async function readVersion(firmId: string, versionId: string): Promise<ResumeVersionDto> {
  const held = versionsRead.get(versionKey(firmId, versionId));
  if (held) return held;
  const startedIn = generation;
  const version = await http.get(firmPath(firmId, versionId), ResumeVersionDto);
  keep(firmId, version, startedIn);
  return version;
}

/** Loads a candidate's list; the hook passes one that fills the query cache, so a save loads the list once. */
export type ShelfLoader = (candidateId: string) => Promise<ResumeShelf>;

const live = {
  shelf: async (firmId: string) => toResumeShelf(await http.get(firmPath(firmId), ResumeShelfDto), firmId),
  shelfByCandidate: async (firmId: string, candidateId: string) =>
    toResumeShelf(await http.get(candidatePath(firmId, candidateId), ResumeShelfDto), firmId),
  open: async (firmId: string, versionId: string) => {
    const startedIn = generation;
    const version = await http.get(firmPath(firmId, versionId), ResumeVersionDto);
    keep(firmId, version, startedIn);
    return toOpenedResume(version, await live.shelfByCandidate(firmId, fromBackendId(version.candidate_id)));
  },
  /** Option 1 (2026-11-05): lay the studio's edits over the version opened, save that as the next version, then load
   *  the list once (the new version's place in it). */
  save: async (firmId: string, versionId: string, doc: ResumeDocument, loadShelf?: ShelfLoader): Promise<ResumeSaveResult> => {
    const source = await readVersion(firmId, versionId);
    const candidateId = fromBackendId(source.candidate_id);
    const startedIn = generation;
    const { notice, ...saved } = await http.post(`${candidatePath(firmId, candidateId)}/${toBackendId(versionId)}/save`, SavedDto, { body: toBackendContent(doc, source) });
    keep(firmId, saved, startedIn);
    const shelf = await (loadShelf ?? ((id: string) => live.shelfByCandidate(firmId, id)))(candidateId);
    return { opened: toOpenedResume(saved, shelf), notice };
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
  autofill: async (firmId: string, versionId: string): Promise<ResumeAutofill> =>
    toVersionAutofill(versionId, await http.get(firmPath(firmId, versionId), AutofillVersionDto, { query: { autofill: true, editor: true } })),
  saveAutofill: async (firmId: string, candidateId: string, versionId: string, change: AutofillChange): Promise<AutofillSaveResult> => {
    const saved = await http.patch(`${candidatePath(firmId, candidateId)}/${toBackendId(versionId)}/autofill`, AutofillSavedDto, { body: toAutofillChangeBody(change) });
    return { autofill: toResumeAutofill(versionId, candidateId, saved.autofill), changed: saved.changed };
  },
};

const SavedDto = ResumeVersionDto.extend({ notice: z.string().nullable() });
const Ack = z.object({ id: z.string() });
const Uploaded = z.object({ restored: z.boolean() });

/**
 * Firm-scoped (docs/07 T5): every call names the firm, and the backend serves only that firm's rows, in the principal's
 * scope. Résumés come only from the backend: there is no mock (decided 2026-11-11).
 */
export const resumesApi = {
  /** Every base and résumé of the candidates the principal sees (the Resume Builder library). */
  shelf: (firmId: string): Promise<ResumeShelf> => live.shelf(firmId),

  /** One candidate's bases and résumés (their Résumés tab, an application's "résumé sent"). */
  shelfByCandidate: (firmId: string, candidateId: string): Promise<ResumeShelf> => live.shelfByCandidate(firmId, candidateId),

  /** One version with its text, for the studio: its id alone names it. */
  open: (firmId: string, versionId: string): Promise<OpenedResume> => live.open(firmId, versionId),

  /** Save the studio's edit of `versionId` as its résumé's next version (§4.3); a `notice` when another came first.
   *  `loadShelf` loads the candidate's list afterwards (default: a plain read). */
  save: (firmId: string, versionId: string, doc: ResumeDocument, loadShelf?: ShelfLoader): Promise<ResumeSaveResult> => live.save(firmId, versionId, doc, loadShelf),

  /** "Use this as the base?" Yes, and picking a base: a base's v1 makes it active; any other version promotes. */
  useAsBase: (firmId: string, candidateId: string, versionId: string): Promise<void> => live.useAsBase(firmId, candidateId, versionId),

  /** The BDE's later résumé (§4.6): a new active base. `restored` when the same file brought back a deleted base. */
  upload: (firmId: string, candidateId: string, file: File): Promise<{ restored: boolean; fileName: string }> => live.upload(firmId, candidateId, file),

  /** What deleting a base or a version would do (the warning), and doing it (§4.7). */
  baseRemoval: (firmId: string, candidateId: string, baseId: string): Promise<ResumeRemoval> => live.baseRemoval(firmId, candidateId, baseId),
  versionRemoval: (firmId: string, candidateId: string, versionId: string): Promise<ResumeRemoval> => live.versionRemoval(firmId, candidateId, versionId),
  deleteBase: (firmId: string, candidateId: string, baseId: string, keepUsed: boolean): Promise<ResumeRemoval> => live.deleteBase(firmId, candidateId, baseId, keepUsed),
  deleteVersion: (firmId: string, candidateId: string, versionId: string): Promise<ResumeRemoval> => live.deleteVersion(firmId, candidateId, versionId),
  /** Show a hidden base again; it isn't made active. */
  showBase: (firmId: string, candidateId: string, baseId: string): Promise<{ number: number }> => live.showBase(firmId, candidateId, baseId),

  /** One version's autofill for the Autofill screen (docs/02 §8.3): every question, the unanswered ones too. */
  autofill: (firmId: string, versionId: string): Promise<ResumeAutofill> => live.autofill(firmId, versionId),
  /** Change a version's autofill in place (07 Q7); for the rest of its résumé that answers the same unless `onlyThis`. */
  saveAutofill: (firmId: string, candidateId: string, versionId: string, change: AutofillChange): Promise<AutofillSaveResult> =>
    live.saveAutofill(firmId, candidateId, versionId, change),
};
