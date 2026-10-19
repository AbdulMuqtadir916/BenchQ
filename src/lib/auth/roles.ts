import type { TagTone } from "@/components/ui/tag";
import type { FirmRole } from "@/lib/schemas/enums";

/**
 * Facts about a *record's* role (a user, an invite) — not about who is signed in, which is the policy's
 * job (./policy). Kept here so role comparisons live in one place (docs/07 Phase C exit grep).
 */
type Role = FirmRole | "PLATFORM_ADMIN";

/** The firm's one OWNER (A10): can't be deactivated, is invited by a Super Admin, activates the firm. */
export const isOwner = (record: { role: Role }): boolean => record.role === "OWNER";

/** A BDE: the people the per-BDE numbers are about. */
export const isBde = (record: { role: Role }): boolean => record.role === "BDE";

/** A platform-team invite or account (firmId null ⇔ PLATFORM_ADMIN, A11). */
export const isPlatformRole = (record: { role: Role }): boolean => record.role === "PLATFORM_ADMIN";

export const ROLE_LABEL: Record<Role, string> = { OWNER: "Owner", MANAGER: "Manager", BDE: "BDE", VIEWER: "Viewer", PLATFORM_ADMIN: "Super Admin" };

export const ROLE_TONE: Record<FirmRole, TagTone> = { OWNER: "violet", MANAGER: "blue", BDE: "neutral", VIEWER: "neutral" };
