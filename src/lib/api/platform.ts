import type { LedgerEntry } from "@/lib/schemas/analytics";
import type { Candidate } from "@/lib/schemas/candidate";
import type { Firm, User } from "@/lib/schemas/session";
import type { Invite, Plan, PlatformUser } from "@/lib/schemas/tenancy";
import { arrayOf, notLiveYet } from "./client";
import { isLive } from "./config";
import { toBackendId } from "./dto/demo-ids";
import {
  CreatedFirmDto, FirmDto, InviteDto, InviteWithTokenDto, LedgerEntryDto, PlanDto, PlatformUserDto, UserDto,
  toFirm, toInvite, toLedgerEntry, toPlan, toPlatformUser, toUser,
} from "./dto/session";
import { http } from "./http";

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
 * The Super Admin endpoints the backend has (backend/api/routes_admin.py, 07 Q38), behind the session switch.
 * Ids go out as the backend's (`toBackendId`) and come back as the frontend's (the mappers). Everything else
 * the platform tier does answers "not available on the live backend yet" until its endpoint lands.
 */
const live = {
  firms: {
    list: async () => (await http.get("/api/admin/firms", arrayOf(FirmDto))).map(toFirm),
    get: async (firmId: string) => toFirm(await http.get(`/api/admin/firms/${toBackendId(firmId)}`, FirmDto)),
    create: async (input: CreateFirmInput) => {
      const body = {
        name: input.name, slug: input.slug, plan_id: toBackendId(input.planId), primary_timezone: input.primaryTimezone,
        client_timezone: input.clientTimezone, contact_phone: input.contactPhone, owner_name: input.ownerName, owner_email: input.ownerEmail,
      };
      return toFirm((await http.post("/api/admin/firms", CreatedFirmDto, { body })).firm);
    },
  },
  users: {
    list: async (firmId?: string) =>
      (await http.get("/api/admin/users", arrayOf(UserDto), { query: { firm_id: firmId && toBackendId(firmId) } })).map(toUser),
  },
  invites: {
    list: async (firmId?: string | null) => {
      const query = { firm_id: firmId ? toBackendId(firmId) : undefined };
      const invites = (await http.get("/api/admin/invites", arrayOf(InviteDto), { query })).map(toInvite);
      // null = the platform team's invites, which the backend lists with every firm's.
      return firmId === null ? invites.filter((invite) => invite.firmId === null) : invites;
    },
    resend: async (inviteId: string) => toInvite((await http.post(`/api/admin/invites/${toBackendId(inviteId)}/resend`, InviteWithTokenDto)).invite),
    revoke: async (inviteId: string) => toInvite(await http.post(`/api/admin/invites/${toBackendId(inviteId)}/revoke`, InviteDto)),
    /** Links are shown once (tokens are stored hashed), so copying one again is a resend: the old link stops (07 Q38). */
    link: async (inviteId: string) => ({ token: (await http.post(`/api/admin/invites/${toBackendId(inviteId)}/resend`, InviteWithTokenDto)).invite_token }),
  },
  plans: {
    list: async () => (await http.get("/api/admin/plans", arrayOf(PlanDto))).map(toPlan),
  },
  audit: {
    list: async () => (await http.get("/api/admin/audit", arrayOf(LedgerEntryDto))).map(toLedgerEntry),
  },
  team: {
    list: async () => (await http.get("/api/admin/team", arrayOf(PlatformUserDto))).map(toPlatformUser),
  },
};

const on = () => isLive("session");

/**
 * The platform tier (docs/07 §2.3, docs/04 §14): PLATFORM_ADMIN only, across every firm. Not
 * firm-scoped — its query keys start with "platform" — and every write logs its ledger entry server-side.
 */
export const platformApi = {
  firms: {
    list: async (): Promise<Firm[]> => (on() ? live.firms.list() : (await mock()).firms.list()),
    get: async (firmId: string): Promise<Firm> => (on() ? live.firms.get(firmId) : (await mock()).firms.get(firmId)),
    create: async (input: CreateFirmInput): Promise<Firm> => (on() ? live.firms.create(input) : (await mock()).firms.create(input)),
    update: async (firmId: string, input: FirmProfileInput): Promise<Firm> => (on() ? notLiveYet() : (await mock()).firms.update(firmId, input)),
    changeSlug: async (firmId: string, slug: string): Promise<Firm> => (on() ? notLiveYet() : (await mock()).firms.changeSlug(firmId, slug)),
    suspend: async (firmId: string, reason: string): Promise<Firm> => (on() ? notLiveYet() : (await mock()).firms.suspend(firmId, reason)),
    reactivate: async (firmId: string): Promise<Firm> => (on() ? notLiveYet() : (await mock()).firms.reactivate(firmId)),
    changePlan: async (firmId: string, planId: string): Promise<Firm> => (on() ? notLiveYet() : (await mock()).firms.changePlan(firmId, planId)),
    adjustLimits: async (firmId: string, limits: LimitsInput): Promise<Firm> => (on() ? notLiveYet() : (await mock()).firms.adjustLimits(firmId, limits)),
  },
  users: {
    list: async (firmId?: string): Promise<User[]> => (on() ? live.users.list(firmId) : (await mock()).users.list(firmId)),
    deactivate: async (userId: string): Promise<User> => (on() ? notLiveYet() : (await mock()).users.deactivate(userId)),
    reactivate: async (userId: string): Promise<User> => (on() ? notLiveYet() : (await mock()).users.reactivate(userId)),
  },
  invites: {
    /** Omit the firm for every invite; `null` for the platform team's. */
    list: async (firmId?: string | null): Promise<Invite[]> => (on() ? live.invites.list(firmId) : (await mock()).invites.list(firmId)),
    resend: async (inviteId: string): Promise<Invite> => (on() ? live.invites.resend(inviteId) : (await mock()).invites.resend(inviteId)),
    revoke: async (inviteId: string): Promise<Invite> => (on() ? live.invites.revoke(inviteId) : (await mock()).invites.revoke(inviteId)),
    /** The live token of a pending invite: the link is /invite/[token] (07 P4). */
    link: async (inviteId: string): Promise<{ token: string }> => (on() ? live.invites.link(inviteId) : (await mock()).invites.link(inviteId)),
  },
  plans: {
    list: async (): Promise<Plan[]> => (on() ? live.plans.list() : (await mock()).plans.list()),
    create: async (input: PlanInput): Promise<Plan> => (on() ? notLiveYet() : (await mock()).plans.create(input)),
    update: async (planId: string, input: PlanInput): Promise<Plan> => (on() ? notLiveYet() : (await mock()).plans.update(planId, input)),
    setActive: async (planId: string, isActive: boolean): Promise<Plan> => (on() ? notLiveYet() : (await mock()).plans.setActive(planId, isActive)),
  },
  audit: {
    list: async (): Promise<LedgerEntry[]> => (on() ? live.audit.list() : (await mock()).audit.list()),
  },
  team: {
    list: async (): Promise<PlatformUser[]> => (on() ? live.team.list() : (await mock()).team.list()),
    invite: async (email: string): Promise<Invite> => (on() ? notLiveYet() : (await mock()).team.invite(email)),
    deactivate: async (userId: string): Promise<PlatformUser> => (on() ? notLiveYet() : (await mock()).team.deactivate(userId)),
  },
  candidates: {
    /** Firm and status of every candidate, for usage counts (A2). Candidates are still mocks, even on a live session. */
    usage: async (): Promise<CandidateUsageRow[]> => (await mock()).candidates.usage(),
  },
};
