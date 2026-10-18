import { z } from "zod";
import { FirmRole } from "./enums";
import { FirmStatus, SlugSchema } from "./tenancy";

export const FirmSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Set and changed only by Super Admin (Q12); rules in SlugSchema (A7). */
  slug: SlugSchema,
  logoUrl: z.string().url().nullable(),
  primaryTimezone: z.string().default("Asia/Kolkata"),
  clientTimezone: z.string().default("America/New_York"),
  truthGuardMode: z.enum(["STRICT", "BALANCED", "LENIENT"]).default("BALANCED"),
  applicationExpiryDays: z.number().int().default(30),
  status: FirmStatus,
  /** Required in every status, ONBOARDING included (A16). */
  planId: z.string(),
  /** Effective limits, copied from the plan when it is assigned (A3). Usage is derived, never stored. */
  seatLimit: z.number().int().positive(),
  candidateLimit: z.number().int().positive(),
  /** The only profile addition (A6). The OWNER is the primary contact, derived. */
  contactPhone: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type Firm = z.infer<typeof FirmSchema>;

export const UserSchema = z.object({
  id: z.string(),
  firmId: z.string(),
  name: z.string(),
  email: z.string().email(),
  role: FirmRole,
  avatarUrl: z.string().url().nullable(),
  isActive: z.boolean(),
  lastActiveAt: z.string().datetime().nullable(),
});
export type User = z.infer<typeof UserSchema>;

/**
 * The limits now live on Firm and usage is derived (src/lib/derive/tenancy.ts), so the session no
 * longer stores seatsUsed / seatLimit / activeCandidates / candidateLimit. Phase T PR 2 replaces this
 * user + firm pair with a Principal.
 */
export const SessionSchema = z.object({
  user: UserSchema,
  firm: FirmSchema,
});
export type Session = z.infer<typeof SessionSchema>;
