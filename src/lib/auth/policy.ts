import type { FirmRole } from "@/lib/schemas/enums";
import type { Principal } from "@/lib/schemas/tenancy";
import { canOpen, type RouteDef } from "@/lib/routes/registry";

/**
 * The permission policy (docs/07 Phase C): what a principal may do, and may open. Pure, so the UI
 * (`useCan`, `<Can>`), the route guard and the mock backend (src/mocks/membership.ts, platform.ts) all
 * read this one table. Nothing else checks roles.
 *
 * - **Firm users:** the role table below — firm work, team management (Q15) and team visibility.
 * - **A platform admin:** every platform action; no firm action. In a read-only support view (07 §4)
 *   still none — they only see the whole firm (`team.view`).
 * - **Routes:** `can(principal, "route.view", route)` — the registry's access table (07 §2).
 *
 * In the UI this is UX, not security; the mock backend refuses the same writes with this same table, and
 * in Phase D the real backend does.
 */

/** Firm work. */
export type FirmAction =
  | "candidate.create"
  | "candidate.edit"
  | "job.capture"
  | "job.apply"
  | "application.move"
  | "resume.edit"
  | "outreach.act"
  | "followup.act";

/** Managing the firm's team (07 Q15). The invite controls arrive with Phase M; the rules are here now. */
export type TeamAction = "member.invite" | "member.remove" | "member.changeRole" | "member.deactivate" | "candidate.assign";

/** Not an action: whether the person sees the team (members, owner, assignments) on firm pages (Q15). */
export type FirmVisibility = "team.view";

/** The platform tier (07 §2.3): PLATFORM_ADMIN only. */
export type PlatformAction =
  | "firm.create"
  | "firm.edit"
  | "firm.suspend"
  | "firm.viewWorkspace"
  | "plan.edit"
  | "invite.resend"
  | "invite.revoke"
  | "platformTeam.manage";

export type Action = FirmAction | TeamAction | FirmVisibility | PlatformAction;

export const FIRM_ACTIONS: readonly FirmAction[] = ["candidate.create", "candidate.edit", "job.capture", "job.apply", "application.move", "resume.edit", "outreach.act", "followup.act"];
export const TEAM_ACTIONS: readonly TeamAction[] = ["member.invite", "member.remove", "member.changeRole", "member.deactivate", "candidate.assign"];
export const PLATFORM_ACTIONS: readonly PlatformAction[] = ["firm.create", "firm.edit", "firm.suspend", "firm.viewWorkspace", "plan.edit", "invite.resend", "invite.revoke", "platformTeam.manage"];
export const ALL_ACTIONS: readonly Action[] = [...FIRM_ACTIONS, ...TEAM_ACTIONS, "team.view", ...PLATFORM_ACTIONS];

const ALL_ACTING: readonly FirmRole[] = ["OWNER", "MANAGER", "BDE"];
const OWNER_ONLY: readonly FirmRole[] = ["OWNER"];
const OWNER_AND_MANAGER: readonly FirmRole[] = ["OWNER", "MANAGER"];

/** Who in a firm may take each action. VIEWER reads everything it can open and acts on nothing. */
const FIRM_TABLE: Record<FirmAction | TeamAction | FirmVisibility, readonly FirmRole[]> = {
  "candidate.create": ALL_ACTING,
  "candidate.edit": ALL_ACTING,
  "job.capture": ALL_ACTING,
  "job.apply": ALL_ACTING,
  "application.move": ALL_ACTING,
  "resume.edit": ALL_ACTING,
  "outreach.act": ALL_ACTING,
  "followup.act": ALL_ACTING,
  "member.invite": OWNER_ONLY,
  "member.remove": OWNER_ONLY,
  "member.changeRole": OWNER_ONLY,
  "member.deactivate": OWNER_ONLY,
  "candidate.assign": OWNER_AND_MANAGER,
  "team.view": OWNER_AND_MANAGER,
};

const isPlatformAction = (action: Action): action is PlatformAction => (PLATFORM_ACTIONS as readonly string[]).includes(action);

export function can(principal: Principal, action: Action): boolean;
export function can(principal: Principal, action: "route.view", route: RouteDef): boolean;
export function can(principal: Principal, action: Action | "route.view", route?: RouteDef): boolean {
  if (action === "route.view") return route ? canOpen(route, principal) : false;
  if (isPlatformAction(action)) return principal.kind === "platform";
  if (principal.kind === "platform") return principal.support !== null && action === "team.view";
  return FIRM_TABLE[action].includes(principal.role);
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

/** The ledger a principal sees (07 §2.2 `ledger`: BDE `own`): a BDE, only the entries they made; everyone else the firm's. */
export function scopeLedger<T extends { actorUserId: string | null }>(principal: Principal, entries: readonly T[]): T[] {
  return isOwnScope(principal) ? entries.filter((entry) => entry.actorUserId === principal.userId) : [...entries];
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
