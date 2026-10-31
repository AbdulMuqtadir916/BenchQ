import type { FirmRole } from "@/lib/schemas/enums";
import type { User } from "@/lib/schemas/session";
import type { Principal } from "@/lib/schemas/tenancy";
import { canOpen, type RouteDef } from "@/lib/routes/registry";
import { isBde, isManager } from "./roles";

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

/**
 * Managing the firm and its team (07 Q15). `candidate.assign` also covers reassigning (07 Q43); who may be given which
 * candidate is `canAssignTo` below. `member.changeManager` moves a BDE to another manager (Q40); `firmSettings.edit`
 * is the OWNER's firm settings, such as the BDE capacity (Q46).
 */
export type TeamAction =
  | "member.invite"
  | "member.remove"
  | "member.changeRole"
  | "member.deactivate"
  | "member.changeManager"
  | "candidate.assign"
  | "firmSettings.edit";

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
export const TEAM_ACTIONS: readonly TeamAction[] = ["member.invite", "member.remove", "member.changeRole", "member.deactivate", "member.changeManager", "candidate.assign", "firmSettings.edit"];
export const PLATFORM_ACTIONS: readonly PlatformAction[] = ["firm.create", "firm.edit", "firm.suspend", "firm.viewWorkspace", "plan.edit", "invite.resend", "invite.revoke", "platformTeam.manage"];
export const ALL_ACTIONS: readonly Action[] = [...FIRM_ACTIONS, ...TEAM_ACTIONS, "team.view", ...PLATFORM_ACTIONS];

const ALL_ACTING: readonly FirmRole[] = ["OWNER", "MANAGER", "BDE"];
const OWNER_ONLY: readonly FirmRole[] = ["OWNER"];
const OWNER_AND_MANAGER: readonly FirmRole[] = ["OWNER", "MANAGER"];

/** Who in a firm may take each action. VIEWER reads everything it can open and acts on nothing. */
const FIRM_TABLE: Record<FirmAction | TeamAction | FirmVisibility, readonly FirmRole[]> = {
  /** 07 Q41: only the OWNER and MANAGERs add candidates; a BDE no longer does. */
  "candidate.create": OWNER_AND_MANAGER,
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
  "member.changeManager": OWNER_ONLY,
  "candidate.assign": OWNER_AND_MANAGER,
  "firmSettings.edit": OWNER_ONLY,
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

/** The firm users the scope and assignment helpers read (a `User`, or the fields of one). */
type Member = Pick<User, "id" | "role" | "managerId" | "isActive">;

/**
 * Who may give `candidate` (null = a new one) this manager and BDE (07 Q41, Q43). Everyone: `target.managerId` is an
 * active MANAGER, and `target.bdeId`, if set, an active BDE reporting to that manager. The OWNER may pick any such
 * target. A MANAGER only their own team — themself as the manager, a BDE when creating, and only candidates they
 * already manage. BDE, VIEWER and a support view never. `team` is the firm's users.
 */
export function canAssignTo(
  principal: Principal,
  candidate: { managerId: string } | null,
  target: { managerId: string; bdeId: string | null },
  team: readonly Member[],
): boolean {
  if (!can(principal, "candidate.assign") || principal.kind !== "firm") return false;
  const manager = team.find((user) => user.id === target.managerId && user.isActive && isManager(user));
  if (!manager) return false;
  if (target.bdeId !== null) {
    const bde = team.find((user) => user.id === target.bdeId && user.isActive && isBde(user));
    if (!bde || bde.managerId !== manager.id) return false;
  }
  if (principal.role === "OWNER") return true;
  if (manager.id !== principal.userId) return false;
  return candidate === null ? target.bdeId !== null : candidate.managerId === principal.userId;
}

/**
 * Whose work a page shows (07 §2.2 data scope, Q47): the OWNER, a VIEWER and a support view see the whole firm; a
 * MANAGER their team (the candidates they manage, and their BDEs' work); a BDE their own (assigned candidates, their
 * applications and follow-ups). Records outside the scope are not rendered.
 */
export type Scope = { kind: "firm" } | { kind: "team"; managerId: string } | { kind: "own"; userId: string };

export function scopeOf(principal: Principal): Scope {
  if (principal.kind !== "firm") return { kind: "firm" };
  if (principal.role === "MANAGER") return { kind: "team", managerId: principal.userId };
  if (principal.role === "BDE") return { kind: "own", userId: principal.userId };
  return { kind: "firm" };
}

/** True when the page shows only the principal's own work (a BDE), e.g. to word a subtitle "Your assigned bench". */
export const hasOwnScope = (principal: Principal): boolean => scopeOf(principal).kind === "own";

/** True when the page shows the principal's team (a MANAGER), e.g. "Your team's bench". */
export const hasTeamScope = (principal: Principal): boolean => scopeOf(principal).kind === "team";

/**
 * A MANAGER's team (Q40): themself, the BDEs who report to them, and the BDE of any candidate they manage. The last
 * keeps the team whole while the live team doesn't yet carry `managerId` (docs/candidate-onboarding/06-backend.md PR 1).
 */
export function teamMemberIds(managerId: string, users: readonly Pick<User, "id" | "role" | "managerId">[], candidates: readonly { managerId: string; bdeId: string | null }[]): Set<string> {
  const ids = new Set([managerId]);
  for (const user of users) if (isBde(user) && user.managerId === managerId) ids.add(user.id);
  for (const candidate of candidates) if (candidate.managerId === managerId && candidate.bdeId !== null) ids.add(candidate.bdeId);
  return ids;
}

export function scopeCandidates<T extends { managerId: string; bdeId: string | null }>(principal: Principal, candidates: readonly T[]): T[] {
  const scope = scopeOf(principal);
  if (scope.kind === "team") return candidates.filter((candidate) => candidate.managerId === scope.managerId);
  if (scope.kind === "own") return candidates.filter((candidate) => candidate.bdeId === scope.userId);
  return [...candidates];
}

/**
 * Applications in scope: a MANAGER's are the ones for the candidates they manage, so a candidate's history moves with
 * it (Q43); a BDE's are the ones they submitted. `candidates` is the firm's (only read for a MANAGER).
 */
export function scopeApplications<T extends { submittedByUserId: string | null; candidateId: string }>(
  principal: Principal,
  applications: readonly T[],
  candidates: readonly { id: string; managerId: string; bdeId: string | null }[],
): T[] {
  const scope = scopeOf(principal);
  if (scope.kind === "team") {
    const mine = new Set(scopeCandidates(principal, candidates).map((candidate) => candidate.id));
    return applications.filter((application) => mine.has(application.candidateId));
  }
  if (scope.kind === "own") {
    const mine = new Set(scopeCandidates(principal, candidates).map((candidate) => candidate.id));
    return applications.filter((application) => mine.has(application.candidateId));
  }
  return [...applications];
}

/** Anything keyed to people (resumes, documents…) through its candidate: in scope when its candidate is. */
export function scopeByCandidate<T extends { candidateId: string }>(
  principal: Principal,
  records: readonly T[],
  candidates: readonly { id: string; managerId: string; bdeId: string | null }[],
): T[] {
  if (scopeOf(principal).kind === "firm") return [...records];
  const visible = new Set(scopeCandidates(principal, candidates).map((candidate) => candidate.id));
  return records.filter((record) => visible.has(record.candidateId));
}

/** The firm data a MANAGER's team scope is worked out from. */
export interface TeamContext {
  users: readonly Pick<User, "id" | "role" | "managerId">[];
  candidates: readonly { id: string; managerId: string; bdeId: string | null }[];
}

/**
 * The ledger a principal sees (07 §2.2 `ledger`): a BDE, the entries they made and the ASSIGN entries about the
 * candidates they work now (07 Q52: who assigned them, and the note); a MANAGER, the entries their team made and every
 * entry about a candidate they manage; everyone else the firm's. The backend enforces the same (routes_ledger.py).
 */
export function scopeLedger<T extends { actorUserId: string | null; entityType: string; entityId: string; action: string }>(
  principal: Principal,
  entries: readonly T[],
  context: TeamContext,
): T[] {
  const scope = scopeOf(principal);
  if (scope.kind === "own") {
    const theirs = new Set(context.candidates.filter((candidate) => candidate.bdeId === scope.userId).map((candidate) => candidate.id));
    return entries.filter((entry) => entry.actorUserId === scope.userId || (entry.action === "ASSIGN" && entry.entityType === "candidate" && theirs.has(entry.entityId)));
  }
  if (scope.kind === "team") {
    const team = teamMemberIds(scope.managerId, context.users, context.candidates);
    const managed = new Set(scopeCandidates(principal, context.candidates).map((candidate) => candidate.id));
    return entries.filter((entry) => (entry.actorUserId !== null && team.has(entry.actorUserId)) || (entry.entityType === "candidate" && managed.has(entry.entityId)));
  }
  return [...entries];
}

/** The follow-ups to load: one person's for a BDE, the whole firm's (undefined) otherwise (a MANAGER's are then narrowed by `scopeFollowups`). */
export function scopeFollowupsUserId(principal: Principal): string | undefined {
  const scope = scopeOf(principal);
  return scope.kind === "own" ? scope.userId : undefined;
}

/** Follow-ups in scope: a MANAGER's team's, a BDE's own, the firm's for everyone else. */
export function scopeFollowups<T extends { assignedToUserId: string }>(principal: Principal, followups: readonly T[], context: TeamContext): T[] {
  const scope = scopeOf(principal);
  if (scope.kind === "own") return followups.filter((followup) => followup.assignedToUserId === scope.userId);
  if (scope.kind === "team") {
    const team = teamMemberIds(scope.managerId, context.users, context.candidates);
    return followups.filter((followup) => team.has(followup.assignedToUserId));
  }
  return [...followups];
}

/** The firm's people a page shows: a MANAGER sees themself and their team (Q47); everyone else the whole firm. */
export function scopeTeam<T extends Pick<User, "id" | "role" | "managerId">>(principal: Principal, users: readonly T[], candidates: TeamContext["candidates"]): T[] {
  const scope = scopeOf(principal);
  if (scope.kind !== "team") return [...users];
  const team = teamMemberIds(scope.managerId, users, candidates);
  return users.filter((user) => team.has(user.id));
}

/** Which dashboard composition a principal gets (docs/04 §3); a support view sees the owner's whole-firm view. */
export function dashboardFor(principal: Principal): "BDE" | "OWNER" | "MANAGER" | "VIEWER" {
  if (principal.kind === "platform") return "OWNER";
  return principal.role;
}
