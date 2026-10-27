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
  /** Effective limits, copied from the plan when it is assigned (A3). Usage is derived, never stored. `seatLimit` counts BDE seats (07 Q44). */
  seatLimit: z.number().int().positive(),
  candidateLimit: z.number().int().positive(),
  /** The only profile addition (A6). The OWNER is the primary contact, derived. */
  contactPhone: z.string().nullable(),
  /** 07 Q46: a BDE's comfortable load (working candidates). A warning when assigning, never a block. Edited by the OWNER. */
  bdeCapacity: z.number().int().positive().default(10),
  createdAt: z.string().datetime(),
});
export type Firm = z.infer<typeof FirmSchema>;

/** A firm user's fields, without the cross-field rule, so `.pick` / `.extend` keep working (as `InviteBaseSchema`). */
export const UserBaseSchema = z.object({
  id: z.string(),
  firmId: z.string(),
  name: z.string(),
  email: z.string().email(),
  role: FirmRole,
  /**
   * 07 Q40: the MANAGER this BDE reports to. null for every non-BDE. A BDE from before the hierarchy may be null
   * ("No manager") until the OWNER sets one (07 Q51).
   */
  managerId: z.string().nullable(),
  avatarUrl: z.string().url().nullable(),
  isActive: z.boolean(),
  lastActiveAt: z.string().datetime().nullable(),
});

/** 07 Q40: only a BDE has a manager. */
export const UserSchema = UserBaseSchema.superRefine((user, ctx) => {
  if (user.managerId !== null && user.role !== "BDE") {
    ctx.addIssue({ code: "custom", path: ["managerId"], message: "Only a BDE has a manager" });
  }
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
