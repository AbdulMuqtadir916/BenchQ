"use client";

import type { FirmRole } from "@/lib/schemas/enums";
import type { Principal } from "@/lib/schemas/tenancy";
import { useSignedInPrincipal } from "@/lib/stores/session-store";

/**
 * The permission policy (docs/07 Phase C, brought into P4 by Q32): what a principal may *do* on a firm
 * page. Route access (may it open the page?) stays in the registry. Pages ask `can()` / `useCan()`
 * instead of checking roles inline, and filter records through the scope helpers below.
 *
 * - Firm users: the matrix below.
 * - A platform admin in a read-only support view (07 §4): **every action false**; they see the whole
 *   firm. Without a support view a platform admin has no firm actions at all.
 *
 * UX, not security: the mock backend (and in Phase D the real one) refuses the same writes.
 * Phase C proper adds the platform actions and the full principal × action table test.
 */

export type FirmAction =
  | "candidate.create"
  | "candidate.edit"
  | "job.capture"
  | "job.apply"
  | "application.move"
  | "resume.edit"
  | "outreach.act"
  | "followup.act";

/** Not an action: whether the person sees the team (owner and assignments) on firm pages (Q15). */
export type FirmVisibility = "team.view";

const ALL_ACTING: readonly FirmRole[] = ["OWNER", "MANAGER", "BDE"];

/** Who may take each action. VIEWER reads everything it can open and acts on nothing. */
const MATRIX: Record<FirmAction | FirmVisibility, readonly FirmRole[]> = {
  "candidate.create": ALL_ACTING,
  "candidate.edit": ALL_ACTING,
  "job.capture": ALL_ACTING,
  "job.apply": ALL_ACTING,
  "application.move": ALL_ACTING,
  "resume.edit": ALL_ACTING,
  "outreach.act": ALL_ACTING,
  "followup.act": ALL_ACTING,
  "team.view": ["OWNER", "MANAGER"],
};

export function can(principal: Principal, action: FirmAction | FirmVisibility): boolean {
  if (principal.kind === "platform") return principal.support !== null && action === "team.view";
  return MATRIX[action].includes(principal.role);
}

export function useCan(action: FirmAction | FirmVisibility): boolean {
  return can(useSignedInPrincipal(), action);
}

/** True inside a read-only support view (07 §4). */
export const isSupportView = (principal: Principal): boolean => principal.kind === "platform" && principal.support !== null;

/**
 * Whose work a page shows (07 §2.2 data scope): a BDE sees their own (assigned candidates, their
 * applications and follow-ups); everyone else who can open the page, a support view included, sees the
 * whole firm. Records outside the scope are not rendered.
 */
const isOwnScope = (principal: Principal): principal is Extract<Principal, { kind: "firm" }> => principal.kind === "firm" && principal.role === "BDE";

/** True when the page shows only the principal's own work (a BDE), e.g. to word a subtitle "Your assigned bench". */
export const hasOwnScope = (principal: Principal): boolean => isOwnScope(principal);

export function scopeCandidates<T extends { assignedUserIds: readonly string[] }>(principal: Principal, candidates: readonly T[]): T[] {
  return isOwnScope(principal) ? candidates.filter((candidate) => candidate.assignedUserIds.includes(principal.userId)) : [...candidates];
}

export function scopeApplications<T extends { submittedByUserId: string }>(principal: Principal, applications: readonly T[]): T[] {
  return isOwnScope(principal) ? applications.filter((application) => application.submittedByUserId === principal.userId) : [...applications];
}

/** The follow-ups to load: one person's for a BDE, the whole firm's (undefined) otherwise. */
export function scopeFollowupsUserId(principal: Principal): string | undefined {
  return isOwnScope(principal) ? principal.userId : undefined;
}

/** Which dashboard composition a principal gets (docs/04 §3); a support view sees the owner's whole-firm view. */
export function dashboardFor(principal: Principal): "BDE" | "OWNER" | "MANAGER" | "VIEWER" {
  if (principal.kind === "platform") return "OWNER";
  return principal.role;
}
