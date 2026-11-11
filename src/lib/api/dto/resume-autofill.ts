import { z } from "zod";
import {
  AutofillAnswerSchema,
  AutofillAnswerTypeSchema,
  type AutofillChange,
  type AutofillEntry,
  type ResumeAutofill,
} from "@/lib/schemas/resume-autofill";
import { fromBackendId } from "./demo-ids";

/** One entry of `GET …/resumes/{id}?autofill=true&editor=true` (backend/candidates/autofill.py `merged`, docs/02 §8.3). */
const AutofillEntryDto = z.object({
  question: z.string(),
  answer: AutofillAnswerSchema,
  kind: z.enum(["FIXED", "EDITED", "CUSTOM"]),
  key: z.string().optional(),
  type: AutofillAnswerTypeSchema.optional(),
  built: AutofillAnswerSchema.optional(),
  replaced: AutofillAnswerSchema.optional(),
  also: z.array(z.string()).optional(),
});
type AutofillEntryDto = z.infer<typeof AutofillEntryDto>;

/** The version read with its autofill: the fields the screen needs, the rest of the version left out. */
export const AutofillVersionDto = z.object({ id: z.string(), candidate_id: z.string(), autofill: z.array(AutofillEntryDto) });
/** `PATCH …/resumes/{id}/autofill`'s answer. */
export const AutofillSavedDto = z.object({ autofill: z.array(AutofillEntryDto), changed: z.number().int() });

function toAutofillEntry({ key, type, also, built, replaced, ...entry }: AutofillEntryDto): AutofillEntry {
  return {
    ...entry,
    key: key ?? null,
    type: type ?? null,
    also: also ?? [],
    ...(built !== undefined ? { built } : {}),
    ...(replaced !== undefined ? { replaced } : {}),
  };
}

/** `candidateId` is the frontend's id (the read maps the backend's with `fromBackendId`). */
export function toResumeAutofill(versionId: string, candidateId: string, entries: AutofillEntryDto[]): ResumeAutofill {
  return { versionId, candidateId, entries: entries.map(toAutofillEntry) };
}

/** The read's answer for `versionId`. */
export function toVersionAutofill(versionId: string, version: z.infer<typeof AutofillVersionDto>): ResumeAutofill {
  return toResumeAutofill(versionId, fromBackendId(version.candidate_id), version.autofill);
}

/** A save's body in the backend's words. */
export function toAutofillChangeBody({ onlyThis, ...change }: AutofillChange) {
  return { ...change, only_this: onlyThis };
}
