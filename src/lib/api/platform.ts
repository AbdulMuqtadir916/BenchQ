import type { LedgerEntry } from "@/lib/schemas/analytics";
import type { Candidate } from "@/lib/schemas/candidate";
import type { Firm, User } from "@/lib/schemas/session";
import type { BillingPeriod, Invite, Plan, PlatformUser } from "@/lib/schemas/tenancy";
import { arrayOf, notLiveYet } from "./client";
import { fromBackendId, toBackendId } from "./dto/demo-ids";
import { CandidateStatus } from "@/lib/schemas/enums";
import {
  AdminFirmDto, BillingPeriodDto, CandidateUsageDto, CreatedFirmDto, InviteDto, InviteWithTokenDto, LedgerEntryDto, PlanDto, PlatformUserDto, UserDto,
  type AdminFirm, toAdminFirm, toBillingPeriod, toInvite, toLedgerEntry, toPlan, toPlatformUser, toUser,
} from "./dto/session";
import { http } from "./http";


/** docs/04 §14.4 Create firm. The owner's name becomes the invite's `inviteeName` (07 Q31). */
export interface CreateFirmInput {
  name: string;
  slug: string;
  planId: string;
  /** BDEs the firm may have (07 Q64); the plan's count when left out. */
  seatLimit?: number;
  /** Candidates that may be assigned to BDEs (07 Q67); 10 per BDE when left out. */
  candidateLimit?: number;
  primaryTimezone: string;
  clientTimezone: string;
  contactPhone: string | null;
  ownerName: string;
  ownerEmail: string;
}
export type FirmProfileInput = Pick<Firm, "name" | "contactPhone" | "primaryTimezone" | "clientTimezone">;
/** A firm's BDE count, candidate limit and, optionally, its price per BDE in USD cents (07 Q64, Q67). The candidate limit is its own number: left out, the firm keeps its own. */
export interface SeatsInput {
  seatLimit: number;
  candidateLimit?: number;
  priceCentsPerSeat?: number;
}
export type PlanInput = Partial<Pick<Plan, "name" | "seatLimit" | "priceCentsPerSeat">>;
export interface StartPeriodInput {
  /** `YYYY-MM-DD`; the day after the last period ends (or today, for the first) when left out. */
  startsOn?: string;
  note?: string;
}
export interface PeriodEditInput {
  status?: "PAID" | "UNPAID";
  paidOn?: string;
  note?: string;
}
/** What the limit counts (07 Q45): the firm, the status and whether a BDE is assigned. */
export type CandidateUsageRow = Pick<Candidate, "firmId" | "status" | "bdeId">;

/**
 * The Super Admin endpoints the backend has (backend/api/routes_admin.py, 07 Q38), behind the session switch.
 * Ids go out as the backend's (`toBackendId`) and come back as the frontend's (the mappers). Everything else
 * the platform tier does answers "not available on the live backend yet" until its endpoint lands.
 */
const live = {
  firms: {
    list: async () => (await http.get("/api/admin/firms", arrayOf(AdminFirmDto))).map(toAdminFirm),
    get: async (firmId: string) => toAdminFirm(await http.get(`/api/admin/firms/${toBackendId(firmId)}`, AdminFirmDto)),
    create: async (input: CreateFirmInput) => {
      const body = {
        name: input.name, slug: input.slug, plan_id: toBackendId(input.planId), primary_timezone: input.primaryTimezone,
        client_timezone: input.clientTimezone, seat_limit: input.seatLimit, candidate_limit: input.candidateLimit, contact_phone: input.contactPhone, owner_name: input.ownerName, owner_email: input.ownerEmail,
      };
      return toAdminFirm((await http.post("/api/admin/firms", CreatedFirmDto, { body })).firm);
    },
    setSeats: async (firmId: string, input: SeatsInput) =>
      toAdminFirm(await http.patch(`/api/admin/firms/${toBackendId(firmId)}/seats`, AdminFirmDto, {
        body: { seat_limit: input.seatLimit, candidate_limit: input.candidateLimit, price_cents_per_seat: input.priceCentsPerSeat },
      })),
    suspend: async (firmId: string, reason: string) =>
      toAdminFirm(await http.post(`/api/admin/firms/${toBackendId(firmId)}/suspend`, AdminFirmDto, { body: { reason } })),
    reactivate: async (firmId: string) => toAdminFirm(await http.post(`/api/admin/firms/${toBackendId(firmId)}/reactivate`, AdminFirmDto)),
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
    update: async (planId: string, input: PlanInput) =>
      toPlan(await http.patch(`/api/admin/plans/${toBackendId(planId)}`, PlanDto, {
        body: { name: input.name, seat_limit: input.seatLimit, price_cents_per_seat: input.priceCentsPerSeat },
      })),
  },
  billing: {
    list: async (firmId?: string) =>
      (await http.get("/api/admin/billing-periods", arrayOf(BillingPeriodDto), { query: { firm_id: firmId && toBackendId(firmId) } })).map(toBillingPeriod),
    start: async (firmId: string, input: StartPeriodInput) =>
      toBillingPeriod(await http.post(`/api/admin/firms/${toBackendId(firmId)}/billing-periods`, BillingPeriodDto, {
        body: { starts_on: input.startsOn, note: input.note },
      })),
    edit: async (periodId: string, input: PeriodEditInput) =>
      toBillingPeriod(await http.patch(`/api/admin/billing-periods/${periodId}`, BillingPeriodDto, {
        body: { status: input.status, paid_on: input.paidOn, note: input.note },
      })),
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
    list: async (): Promise<AdminFirm[]> => live.firms.list(),
    get: async (firmId: string): Promise<AdminFirm> => live.firms.get(firmId),
    create: async (input: CreateFirmInput): Promise<AdminFirm> => live.firms.create(input),
    update: unavailable<[string, FirmProfileInput], AdminFirm>(),
    changeSlug: unavailable<[string, string], AdminFirm>(),
    suspend: async (firmId: string, reason: string): Promise<AdminFirm> => live.firms.suspend(firmId, reason),
    reactivate: async (firmId: string): Promise<AdminFirm> => live.firms.reactivate(firmId),
    /** The BDE count (07 Q64); the candidate limit follows. Replaces Change plan and Adjust limits. */
    setSeats: async (firmId: string, input: SeatsInput): Promise<AdminFirm> => live.firms.setSeats(firmId, input),
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
    update: async (planId: string, input: PlanInput): Promise<Plan> => live.plans.update(planId, input),
  },
  /** Billing records, Super Admin only (07 Q65–Q66). Omit the firm for every period. */
  billing: {
    list: async (firmId?: string): Promise<BillingPeriod[]> => live.billing.list(firmId),
    start: async (firmId: string, input: StartPeriodInput): Promise<BillingPeriod> => live.billing.start(firmId, input),
    edit: async (periodId: string, input: PeriodEditInput): Promise<BillingPeriod> => live.billing.edit(periodId, input),
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
    /** Firm, status and BDE of every candidate, for usage counts (07 Q45): `GET /api/admin/candidate-usage`, counts only. */
    usage: async (): Promise<CandidateUsageRow[]> =>
      (await http.get("/api/admin/candidate-usage", arrayOf(CandidateUsageDto))).map((row) => ({
        firmId: fromBackendId(row.firm_id), status: CandidateStatus.parse(row.status), bdeId: row.bde_id ? fromBackendId(row.bde_id) : null,
      })),
  },
};
