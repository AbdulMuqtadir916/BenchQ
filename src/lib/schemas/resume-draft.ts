import { z } from "zod";
import { WorkAuth } from "./enums";

/**
 * The résumé parser's answer after the DTO mapper (docs/02 §4, 07 Q49): it fills the new-candidate form and is never
 * saved. Every field is null when the résumé didn't have it. The backend's snake_case shape stays in src/lib/api/dto/.
 */
export const ResumeDraftSchema = z.object({
  /** The backend's handle on the uploaded file and its full parse; sent back as `resumeParseId` on create. */
  parseId: z.string(),
  fileName: z.string(),
  fullName: z.string().nullable(),
  /** The résumé's headline (`header.title`) — "Marketed as". */
  primaryRole: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  linkedinUrl: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  /** The country as the header prints it ("India", "USA"); null when it prints none, never guessed (docs/02 §8.1). */
  country: z.string().nullable(),
  /** Derived from the work history's dates by the mapper. */
  yearsExperience: z.number().nullable(),
  /** Matched from the printed work authorization; null when it didn't match. */
  workAuth: WorkAuth.nullable(),
  /** The work authorization as printed, shown when it didn't match. */
  workAuthText: z.string().nullable(),
  summary: z.string().nullable(),
  skills: z.array(z.object({ name: z.string(), family: z.string().nullable() })),
});
export type ResumeDraft = z.infer<typeof ResumeDraftSchema>;
