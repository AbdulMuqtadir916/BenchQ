import { z } from "zod";
import { FirmRole } from "./enums";
import { FirmPrincipalSchema, FirmStatus, PlatformPrincipalSchema, PlatformUserSchema, SlugSchema } from "./tenancy";

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
 * Who is signed in (docs/07 §3). The principal is the source of truth; `user` / `firm` are the records
 * it points at, resolved by the session adapter so screens don't look them up. Usage (seats, active
 * candidates) is derived, never part of the session.
 */
export const FirmSessionSchema = z.object({
  principal: FirmPrincipalSchema,
  user: UserSchema,
  firm: FirmSchema,
});
export type FirmSession = z.infer<typeof FirmSessionSchema>;

/** A platform admin's session: `firm` is the support-view firm, or null. Served from Phase P. */
export const PlatformSessionSchema = z.object({
  principal: PlatformPrincipalSchema,
  platformUser: PlatformUserSchema,
  firm: FirmSchema.nullable(),
});
export type PlatformSession = z.infer<typeof PlatformSessionSchema>;

export const SessionSchema = z.union([FirmSessionSchema, PlatformSessionSchema]);
export type Session = z.infer<typeof SessionSchema>;
