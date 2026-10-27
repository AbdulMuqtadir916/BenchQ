import type { Candidate } from "@/lib/schemas/candidate";
import { isOwner } from "@/lib/auth/roles";
import type { LedgerEntry } from "@/lib/schemas/analytics";
import type { Firm, User } from "@/lib/schemas/session";
import { RESERVED_SLUGS, SUPPORT_VIEW_MINUTES, type FirmStatus, type Invite } from "@/lib/schemas/tenancy";
import { deriveFirmUsage, effectiveInviteStatus, type FirmUsage } from "./tenancy";

/**
 * The Super Admin area's derived values (docs/04 §14). Every count, flag and status here is computed
 * from the records (firms, users, invites, candidates, the ledger), never stored. `now` is a parameter
 * so results are stable in tests.
 */

/** Ledger entity types (lowercase, as the fixtures write them). */
export const ENTITY = { firm: "firm", firmLimits: "firm_limits", invite: "invite", plan: "plan", user: "user", platformUser: "platform_user", supportView: "support_view" } as const;

/** docs/04 §14.2: an onboarding firm whose owner invite is still pending after this long needs attention. */
export const STALLED_ONBOARDING_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface PlatformData {
  firms: readonly Firm[];
  users: readonly User[];
  invites: readonly Invite[];
  candidates: readonly Pick<Candidate, "firmId" | "status">[];
  ledger: readonly LedgerEntry[];
}

export const usageOf = (firm: Firm, data: Pick<PlatformData, "users" | "invites" | "candidates">, now: Date): FirmUsage =>
  deriveFirmUsage(firm, data, now);

/** The over-limit block's reason (docs/02 A4, docs/04 §0): names the limit. */
export function seatBlockReason(usage: Pick<FirmUsage, "seatsUsed" | "seatLimit">): string {
  return `Your plan allows ${usage.seatLimit} BDE seat${usage.seatLimit === 1 ? "" : "s"}; ${usage.seatsUsed} ${usage.seatsUsed === 1 ? "is" : "are"} in use.`;
}

/** The over-limit block on a new candidate (A4), word for word on the button and from the mock. */
export function candidateBlockReason(usage: Pick<FirmUsage, "activeCandidates" | "candidateLimit">): string {
  return `Your plan allows ${usage.candidateLimit} active candidate${usage.candidateLimit === 1 ? "" : "s"}; ${usage.activeCandidates} ${usage.activeCandidates === 1 ? "is" : "are"} active.`;
}

export type OwnerStatus =
  | { kind: "active"; name: string; email: string; userId: string; isActive: boolean }
  | { kind: "pending"; email: string; name: string | null; invite: Invite }
  | { kind: "expired"; email: string; name: string | null; invite: Invite }
  | { kind: "none" };

/** The firm's one OWNER (A10): the user, else the latest owner invite that is pending or expired. */
export function ownerStatus(firmId: string, data: Pick<PlatformData, "users" | "invites">, now: Date): OwnerStatus {
  const owner = data.users.find((user) => user.firmId === firmId && isOwner(user));
  if (owner) return { kind: "active", name: owner.name, email: owner.email, userId: owner.id, isActive: owner.isActive };
  const invite = data.invites
    .filter((item) => item.firmId === firmId && isOwner(item))
    .filter((item) => ["PENDING", "EXPIRED"].includes(effectiveInviteStatus(item, now)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!invite) return { kind: "none" };
  return effectiveInviteStatus(invite, now) === "PENDING" ? { kind: "pending", email: invite.email, name: invite.inviteeName, invite } : { kind: "expired", email: invite.email, name: invite.inviteeName, invite };
}

const newestFirst = (a: LedgerEntry, b: LedgerEntry) => b.createdAt.localeCompare(a.createdAt);

/** A firm's ledger, newest first. */
export function firmLedger(firmId: string, ledger: readonly LedgerEntry[]): LedgerEntry[] {
  return ledger.filter((entry) => entry.firmId === firmId).sort(newestFirst);
}

/** docs/04 §14.3: the latest ledger entry with that firmId. */
export function lastActivityAt(firmId: string, ledger: readonly LedgerEntry[]): string | null {
  let latest: string | null = null;
  for (const entry of ledger) if (entry.firmId === firmId && (latest === null || entry.createdAt > latest)) latest = entry.createdAt;
  return latest;
}

/** docs/04 §14.5 Plan tab: the firm's plan history, from its PLAN_CHANGED entries (A14). */
export function planHistory(firmId: string, ledger: readonly LedgerEntry[]): LedgerEntry[] {
  return firmLedger(firmId, ledger).filter((entry) => entry.action === "PLAN_CHANGED");
}

/** docs/07 Q30: "custom limits" while the firm's latest PLAN_CHANGED is a limits adjustment. */
export function hasCustomLimits(firmId: string, ledger: readonly LedgerEntry[]): boolean {
  return planHistory(firmId, ledger)[0]?.entityType === ENTITY.firmLimits;
}

/**
 * Support views open now (docs/04 §14.2): an ADMIN_ACCESS with no later ADMIN_ACCESS_END for the
 * same view (entityId), started less than 60 minutes ago (A12). Support views start in P4.
 */
export function openSupportViews(ledger: readonly LedgerEntry[], now: Date): LedgerEntry[] {
  const ended = new Set(ledger.filter((entry) => entry.action === "ADMIN_ACCESS_END").map((entry) => entry.entityId));
  return ledger
    .filter((entry) => entry.action === "ADMIN_ACCESS" && !ended.has(entry.entityId))
    .filter((entry) => now.getTime() - new Date(entry.createdAt).getTime() < SUPPORT_VIEW_MINUTES * 60 * 1000)
    .sort(newestFirst);
}

export type AttentionItem =
  | { kind: "over-limit"; firm: Firm; limit: "seats" | "candidates"; used: number; allowed: number }
  | { kind: "owner-invite-expired"; firm: Firm; email: string }
  | { kind: "stalled-onboarding"; firm: Firm; days: number }
  | { kind: "support-view-open"; firm: Firm; entry: LedgerEntry };

/** docs/04 §14.2 "Needs attention". */
export function needsAttention(data: PlatformData, now: Date): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const firm of data.firms) {
    const usage = usageOf(firm, data, now);
    if (usage.isOverSeatLimit) items.push({ kind: "over-limit", firm, limit: "seats", used: usage.seatsUsed, allowed: usage.seatLimit });
    if (usage.isOverCandidateLimit) items.push({ kind: "over-limit", firm, limit: "candidates", used: usage.activeCandidates, allowed: usage.candidateLimit });
    if (firm.status !== "ONBOARDING") continue;
    const owner = ownerStatus(firm.id, data, now);
    if (owner.kind === "expired") items.push({ kind: "owner-invite-expired", firm, email: owner.email });
    const days = Math.floor((now.getTime() - new Date(firm.createdAt).getTime()) / DAY_MS);
    if (owner.kind === "pending" && days >= STALLED_ONBOARDING_DAYS) items.push({ kind: "stalled-onboarding", firm, days });
  }
  for (const entry of openSupportViews(data.ledger, now)) {
    const firm = data.firms.find((item) => item.id === entry.firmId);
    if (firm) items.push({ kind: "support-view-open", firm, entry });
  }
  return items;
}

/** docs/04 §14.2 "Firms by status". */
export function firmsByStatus(firms: readonly Pick<Firm, "status">[]): Record<FirmStatus, number> {
  const counts: Record<FirmStatus, number> = { ACTIVE: 0, ONBOARDING: 0, SUSPENDED: 0 };
  for (const firm of firms) counts[firm.status] += 1;
  return counts;
}

/** docs/04 §14.2 "Seats": seats used vs. limits over ACTIVE firms; active users across all firms. */
export function seatTotals(data: Pick<PlatformData, "firms" | "users" | "invites" | "candidates">, now: Date): { seatsUsed: number; seatLimit: number; activeUsers: number } {
  let seatsUsed = 0;
  let seatLimit = 0;
  for (const firm of data.firms.filter((item) => item.status === "ACTIVE")) {
    const usage = usageOf(firm, data, now);
    seatsUsed += usage.seatsUsed;
    seatLimit += usage.seatLimit;
  }
  return { seatsUsed, seatLimit, activeUsers: data.users.filter((user) => user.isActive).length };
}

/** Firms on a plan (docs/04 §14.6). */
export function firmsOnPlan(planId: string, firms: readonly Pick<Firm, "planId">[]): number {
  return firms.filter((firm) => firm.planId === planId).length;
}

/** A suggested slug for a firm name: lowercase, hyphenated, within the A7 rules where it can be. */
export function suggestSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^[^a-z]+/, "")
    .replace(/-+$/, "")
    .slice(0, 32)
    .replace(/-+$/, "");
}

/**
 * What's wrong with a slug, if anything (A7, docs/07 §2.4): each rule its own message, checked in
 * order. `taken` = slugs of the other firms. Null = usable.
 */
export function slugProblem(slug: string, taken: readonly string[]): string | null {
  if (slug.length === 0) return "Enter a slug.";
  if (slug.length < 3 || slug.length > 32) return "Use 3–32 characters.";
  if (!/^[a-z0-9-]+$/.test(slug)) return "Use only lowercase letters, digits and hyphens.";
  if (!/^[a-z]/.test(slug)) return "Start with a letter.";
  if (slug.endsWith("-")) return "Don't end with a hyphen.";
  if (slug.includes("--")) return "Don't use two hyphens in a row.";
  if ((RESERVED_SLUGS as readonly string[]).includes(slug)) return "This word is reserved by BenchQ.";
  if (taken.includes(slug)) return "Another firm already uses this slug.";
  return null;
}
