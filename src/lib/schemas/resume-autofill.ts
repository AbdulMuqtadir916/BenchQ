import { z } from "zod";

/**
 * One résumé version's autofill on the Autofill screen (docs/02 §8.3): every question an application form can ask,
 * built from the version and the candidate's profile, with the user's edits of those answers and their own questions.
 * The backend builds it on each read; only the user's entries are stored.
 */

/** An answer keeps its JSON type: text, a list of texts, a number, yes/no, a list of records (jobs…), or none yet. */
export const AutofillAnswerSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.array(z.record(z.string(), z.unknown())),
  z.null(),
]);
export type AutofillAnswer = z.infer<typeof AutofillAnswerSchema>;

/** What a fixed question's answer is: `texts` is a list of short texts, `date` is "YYYY-MM-DD", `entries` a list of
 * records (the work history…) that's changed in the résumé itself, never here. */
export const AutofillAnswerTypeSchema = z.enum(["text", "texts", "number", "boolean", "date", "entries"]);
export type AutofillAnswerType = z.infer<typeof AutofillAnswerTypeSchema>;

export const AutofillEntrySchema = z.object({
  question: z.string(),
  answer: AutofillAnswerSchema,
  /** FIXED: built; EDITED: the user's answer to a fixed question; CUSTOM: a question the user added. */
  kind: z.enum(["FIXED", "EDITED", "CUSTOM"]),
  /** What a fixed question asks, whatever its wording; null on the user's own questions. */
  key: z.string().nullable(),
  type: AutofillAnswerTypeSchema.nullable(),
  /** EDITED: the built answer a reset gives back. */
  built: AutofillAnswerSchema.optional(),
  /** FIXED: the user's edit that stopped applying when the built answer changed (07 Q15). */
  replaced: AutofillAnswerSchema.optional(),
  /** CUSTOM: other wordings the answer is for. */
  also: z.array(z.string()),
});
export type AutofillEntry = z.infer<typeof AutofillEntrySchema>;

export const ResumeAutofillSchema = z.object({
  versionId: z.string(),
  candidateId: z.string(),
  entries: z.array(AutofillEntrySchema),
});
export type ResumeAutofill = z.infer<typeof ResumeAutofillSchema>;

/** One save (07 Q14): `built` holds the built answer the user was shown for each edited key. `onlyThis` keeps the
 * change to this version instead of every job of the candidate (07 Q30). */
export const AutofillChangeSchema = z.object({
  edit: z.record(z.string(), AutofillAnswerSchema),
  built: z.record(z.string(), AutofillAnswerSchema),
  /** Each edited or reset key's answer the user was shown (their edit, else the built one): a save over one changed
   * since is refused (409). */
  answered: z.record(z.string(), AutofillAnswerSchema).optional(),
  reset: z.array(z.string()),
  add: z.record(z.string(), z.string()),
  remove: z.array(z.string()),
  onlyThis: z.boolean(),
});
export type AutofillChange = z.infer<typeof AutofillChangeSchema>;

/** The version's autofill after the save, and how many versions changed. */
export const AutofillSaveResultSchema = z.object({ autofill: ResumeAutofillSchema, changed: z.number().int() });
export type AutofillSaveResult = z.infer<typeof AutofillSaveResultSchema>;
