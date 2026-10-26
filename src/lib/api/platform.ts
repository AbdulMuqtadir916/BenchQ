import type { LedgerEntry } from "@/lib/schemas/analytics";
import type { Candidate } from "@/lib/schemas/candidate";
import type { Firm, User } from "@/lib/schemas/session";
import type { Invite, Plan, PlatformUser } from "@/lib/schemas/tenancy";
import { arrayOf, notLiveYet } from "./client";
import { toBackendId } from "./dto/demo-ids";
import {
  CreatedFirmDto, FirmDto, InviteDto, InviteWithTokenDto, LedgerEntryDto, PlanDto, PlatformUserDto, UserDto,
  toFirm, toInvite, toLedgerEntry, toPlan, toPlatformUser, toUser,
} from "./dto/session";
import { http } from "./http";

const usageMock = () => import("@/mocks/usage").then((m) => m.candidateUsageMock);

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

/** An admin action the backend has no endpoint for yet: the screen shows "Not available on the live backend yet". */
const unavailable = <A extends unknown[], R>() => async (...args: A): Promise<R> => {
  void args;
  return notLiveYet();
};

/**
 * The platform tier (docs/07 §2.3, docs/04 §14): PLATFORM_ADMIN only, across every firm. Not
 * firm-scoped — its query keys start with "platform" — and every write logs its ledger entry server-side.
 */
export const platformApi = {
  firms: {
    list: async (): Promise<Firm[]> => live.firms.list(),
    get: async (firmId: string): Promise<Firm> => live.firms.get(firmId),
    create: async (input: CreateFirmInput): Promise<Firm> => live.firms.create(input),
    update: unavailable<[string, FirmProfileInput], Firm>(),
    changeSlug: unavailable<[string, string], Firm>(),
    suspend: unavailable<[string, string], Firm>(),
    reactivate: unavailable<[string], Firm>(),
    changePlan: unavailable<[string, string], Firm>(),
    adjustLimits: unavailable<[string, LimitsInput], Firm>(),
  },
  users: {
    list: async (firmId?: string): Promise<User[]> => live.users.list(firmId),
    deactivate: unavailable<[string], User>(),
    reactivate: unavailable<[string], User>(),
  },
  invites: {
    /** Omit the firm for every invite; `null` for the platform team's. */
    list: async (firmId?: string | null): Promise<Invite[]> => live.invites.list(firmId),
    resend: async (inviteId: string): Promise<Invite> => live.invites.resend(inviteId),
    revoke: async (inviteId: string): Promise<Invite> => live.invites.revoke(inviteId),
    /** The live token of a pending invite: the link is /invite/[token] (07 P4). */
    link: async (inviteId: string): Promise<{ token: string }> => live.invites.link(inviteId),
  },
  plans: {
    list: async (): Promise<Plan[]> => live.plans.list(),
    create: unavailable<[PlanInput], Plan>(),
    update: unavailable<[string, PlanInput], Plan>(),
    setActive: unavailable<[string, boolean], Plan>(),
  },
  audit: {
    list: async (): Promise<LedgerEntry[]> => live.audit.list(),
  },
  team: {
    list: async (): Promise<PlatformUser[]> => live.team.list(),
    invite: unavailable<[string], Invite>(),
    deactivate: unavailable<[string], PlatformUser>(),
  },
  candidates: {
    /** Firm and status of every candidate, for usage counts (A2). Candidates are still mocks, read under the real signed-in principal. */
    usage: async (): Promise<CandidateUsageRow[]> => (await usageMock()).usage(),
  },
};
