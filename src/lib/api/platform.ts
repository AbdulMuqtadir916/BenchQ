import type { LedgerEntry } from "@/lib/schemas/analytics";
import type { Candidate } from "@/lib/schemas/candidate";
import type { Firm, User } from "@/lib/schemas/session";
import type { Invite, Plan, PlatformUser } from "@/lib/schemas/tenancy";

const mock = () => import("@/mocks/platform").then((m) => m.platformMock);

/** docs/04 §14.4 Create firm. The owner's name becomes the invite's `inviteeName` (07 Q31). */
export interface CreateFirmInput {
  name: string;
  slug: string;
  planId: string;
  primaryTimezone: string;
  clientTimezone: string;
  contactPhone: string | null;
  ownerName: string;
  ownerEmail: string;
}
export type FirmProfileInput = Pick<Firm, "name" | "contactPhone" | "primaryTimezone" | "clientTimezone">;
export type LimitsInput = Pick<Firm, "seatLimit" | "candidateLimit">;
export type PlanInput = Pick<Plan, "name" | "seatLimit" | "candidateLimit" | "features">;
export type CandidateUsageRow = Pick<Candidate, "firmId" | "status">;

/**
 * The platform tier (docs/07 §2.3, docs/04 §14): PLATFORM_ADMIN only, across every firm. Not
 * firm-scoped — its query keys start with "platform" — and every write logs its ledger entry server-side.
 */
export const platformApi = {
  firms: {
    list: async (): Promise<Firm[]> => (await mock()).firms.list(),
    get: async (firmId: string): Promise<Firm> => (await mock()).firms.get(firmId),
    create: async (input: CreateFirmInput): Promise<Firm> => (await mock()).firms.create(input),
    update: async (firmId: string, input: FirmProfileInput): Promise<Firm> => (await mock()).firms.update(firmId, input),
    changeSlug: async (firmId: string, slug: string): Promise<Firm> => (await mock()).firms.changeSlug(firmId, slug),
    suspend: async (firmId: string, reason: string): Promise<Firm> => (await mock()).firms.suspend(firmId, reason),
    reactivate: async (firmId: string): Promise<Firm> => (await mock()).firms.reactivate(firmId),
    changePlan: async (firmId: string, planId: string): Promise<Firm> => (await mock()).firms.changePlan(firmId, planId),
    adjustLimits: async (firmId: string, limits: LimitsInput): Promise<Firm> => (await mock()).firms.adjustLimits(firmId, limits),
  },
  users: {
    list: async (firmId?: string): Promise<User[]> => (await mock()).users.list(firmId),
    deactivate: async (userId: string): Promise<User> => (await mock()).users.deactivate(userId),
    reactivate: async (userId: string): Promise<User> => (await mock()).users.reactivate(userId),
  },
  invites: {
    /** Omit the firm for every invite; `null` for the platform team's. */
    list: async (firmId?: string | null): Promise<Invite[]> => (await mock()).invites.list(firmId),
    resend: async (inviteId: string): Promise<Invite> => (await mock()).invites.resend(inviteId),
    revoke: async (inviteId: string): Promise<Invite> => (await mock()).invites.revoke(inviteId),
    /** The live token of a pending invite: the link is /invite/[token] (07 P4). */
    link: async (inviteId: string): Promise<{ token: string }> => (await mock()).invites.link(inviteId),
  },
  plans: {
    list: async (): Promise<Plan[]> => (await mock()).plans.list(),
    create: async (input: PlanInput): Promise<Plan> => (await mock()).plans.create(input),
    update: async (planId: string, input: PlanInput): Promise<Plan> => (await mock()).plans.update(planId, input),
    setActive: async (planId: string, isActive: boolean): Promise<Plan> => (await mock()).plans.setActive(planId, isActive),
  },
  audit: {
    list: async (): Promise<LedgerEntry[]> => (await mock()).audit.list(),
  },
  team: {
    list: async (): Promise<PlatformUser[]> => (await mock()).team.list(),
    invite: async (email: string): Promise<Invite> => (await mock()).team.invite(email),
    deactivate: async (userId: string): Promise<PlatformUser> => (await mock()).team.deactivate(userId),
  },
  candidates: {
    /** Firm and status of every candidate, for usage counts (A2). */
    usage: async (): Promise<CandidateUsageRow[]> => (await mock()).candidates.usage(),
  },
};
