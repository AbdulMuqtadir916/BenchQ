import { z } from "zod";
import { FirmRole } from "./enums";

/**
 * Tenancy contracts approved 2026-10-14 (docs/02 §3.1, docs/07 §0 Q16–Q21).
 * The session store and query keys move to these in Phase T PR 2 (T4–T5).
 */

/** docs/07 §2.4: rejected as a firm slug, because they are (or will be) top-level routes. */
export const RESERVED_SLUGS = [
  "admin", "api", "health", "sign-in", "sign-up", "forgot-password", "reset-password", "invite", "dev",
  "_next", "static", "assets", "favicon.ico", "robots.txt", "sitemap.xml", "www", "app", "support",
  "help", "status", "settings", "new",
] as const;

/**
 * Firm slug (A7): lowercase a–z, 0–9 and hyphens; 3–32 characters; starts with a letter; no leading,
 * trailing or double hyphens; not reserved. Uniqueness across firms is a store/backend check.
 */
export const SLUG_PATTERN = /^[a-z](?:[a-z0-9]|-(?=[a-z0-9])){2,31}$/;
export const SlugSchema = z
  .string()
  .regex(SLUG_PATTERN, "3–32 characters: lowercase letters, digits and single hyphens, starting with a letter")
  .refine((slug) => !(RESERVED_SLUGS as readonly string[]).includes(slug), "This slug is reserved");

/** A5: no TRIAL until billing. ONBOARDING → ACTIVE when the OWNER accepts; only Super Admin suspends. */
export const FirmStatus = z.enum(["ONBOARDING", "ACTIVE", "SUSPENDED"]);
export type FirmStatus = z.infer<typeof FirmStatus>;

/** A plan is a template (A3): its limits are copied onto a firm when assigned. No prices (no billing). */
export const PlanSchema = z.object({
  id: z.string(),
  name: z.string(),
  seatLimit: z.number().int().positive(),
  candidateLimit: z.number().int().positive(),
  /** Display labels only (A15). */
  features: z.array(z.string()),
  isActive: z.boolean(),
});
export type Plan = z.infer<typeof PlanSchema>;

export const PlatformRole = z.literal("PLATFORM_ADMIN");

export const InviteStatus = z.enum(["PENDING", "ACCEPTED", "REVOKED", "EXPIRED"]);
export type InviteStatus = z.infer<typeof InviteStatus>;

/**
 * The invite's fields, without the cross-field rule, so `.extend` / `.pick` / `.omit` keep working
 * (a refined schema can't be extended). Use `InviteSchema` to validate a whole invite.
 */
export const InviteBaseSchema = z.object({
  id: z.string(),
  /** null = an invite to the BenchQ platform team. */
  firmId: z.string().nullable(),
  email: z.string().email(),
  role: z.union([FirmRole, PlatformRole]),
  /** A firm user, or a PlatformUser (the firm's one OWNER is invited by a Super Admin). */
  invitedByUserId: z.string(),
  status: InviteStatus,
  /** createdAt + 7 days (A9). Resend keeps the row, issues a new token and resets this. */
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
});

/** A11: firmId is null if and only if the role is PLATFORM_ADMIN. */
export const InviteSchema = InviteBaseSchema.superRefine((invite, ctx) => {
  if ((invite.firmId === null) !== (invite.role === "PLATFORM_ADMIN")) {
    ctx.addIssue({
      code: "custom",
      path: ["firmId"],
      message: "firmId must be null exactly when role is PLATFORM_ADMIN",
    });
  }
});
export type Invite = z.infer<typeof InviteSchema>;

export const PlatformUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  role: PlatformRole,
  isActive: z.boolean(),
  lastActiveAt: z.string().datetime().nullable(),
});
export type PlatformUser = z.infer<typeof PlatformUserSchema>;

/** A12: fixed 60 minutes, no extension. To continue, start a new view. */
export const SUPPORT_VIEW_MINUTES = 60;

export const SupportViewSchema = z.object({
  id: z.string(),
  firmId: z.string(),
  /** Shown to the firm exactly as written. */
  reason: z.string().min(10),
  startedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});
export type SupportView = z.infer<typeof SupportViewSchema>;

export const PrincipalSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("firm"),
    userId: z.string(),
    firmId: z.string(),
    role: FirmRole,
  }),
  z.object({
    kind: z.literal("platform"),
    userId: z.string(),
    role: PlatformRole,
    support: SupportViewSchema.nullable(),
  }),
]);
export type Principal = z.infer<typeof PrincipalSchema>;
