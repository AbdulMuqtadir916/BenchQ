import { ApiError } from "@/lib/api/client";
import { isOwner } from "@/lib/auth/roles";
import type { CreateFirmInput, FirmProfileInput, LimitsInput, PlanInput } from "@/lib/api/platform";
import { ENTITY, seatBlockReason, slugProblem, usageOf } from "@/lib/derive/platform";
import { effectiveInviteStatus } from "@/lib/derive/tenancy";
import type { LedgerEntry } from "@/lib/schemas/analytics";
import type { Firm, User } from "@/lib/schemas/session";
import type { Invite, Plan, PlatformUser } from "@/lib/schemas/tenancy";
import { currentPlatformUser } from "./auth";
import { allCandidates } from "./candidates";
import { changed, type TableName } from "./db";
import { allLedger } from "./ledger";
import { injectedFailure, requireAction } from "./membership";
import type { PlatformAction } from "@/lib/auth/policy";
import { allUsers, firms } from "./team-data";
import { invites, plans, platformUsers } from "./tenancy";
import { issueInviteToken, tokenForInvite } from "./invite-tokens";
import { mockResult, notFound } from "./_shared";

/**
 * The mock backend's platform tier (docs/07 §2.3, docs/04 §14): PLATFORM_ADMIN only — anyone else gets
 * 403 (the admin layout already shows them not-found). Reads return every firm's rows; every write
 * persists (src/mocks/db.ts) and appends its ledger entry, actor = the signed-in Super Admin (A13).
 * Mock data, not a backend: Phase D replaces it.
 */

export const INVITE_DAYS = 7;
export const DAY_MS = 24 * 60 * 60 * 1000;

const conflict = (message: string, code = "CONFLICT") => new ApiError(message, code, 409);
const invalid = (message: string) => new ApiError(message, "INVALID", 400);

let sequence = 0;
const newId = (prefix: string, now: Date) => `${prefix}_${now.getTime().toString(36)}${(sequence++).toString(36)}`;

function log(entry: Pick<LedgerEntry, "firmId" | "entityType" | "entityId" | "entityLabel" | "action" | "summary">, now: Date): void {
  const admin = currentPlatformUser();
  allLedger.unshift({
    id: newId("ledger_adm", now),
    actorUserId: admin.id,
    actorType: "PLATFORM_ADMIN",
    actorName: admin.name,
    modelId: null,
    promptVersion: null,
    evidenceIds: [],
    claimState: null,
    createdAt: now.toISOString(),
    ...entry,
  });
}

function firmIndex(firmId: string): number {
  const index = firms.findIndex((firm) => firm.id === firmId);
  if (index < 0) notFound("Firm", firmId);
  return index;
}

const planById = (planId: string): Plan => plans.find((plan) => plan.id === planId) ?? notFound("Plan", planId);
const usageData = () => ({ users: allUsers, invites, candidates: allCandidates });
const limitsText = (limits: { seatLimit: number; candidateLimit: number }) => `${limits.seatLimit} seats, ${limits.candidateLimit} candidates`;

function checkSlug(slug: string, exceptFirmId?: string): void {
  const problem = slugProblem(slug, firms.filter((firm) => firm.id !== exceptFirmId).map((firm) => firm.slug));
  if (problem) throw invalid(problem);
}

function checkLimits(limits: { seatLimit: number; candidateLimit: number }): void {
  for (const value of [limits.seatLimit, limits.candidateLimit]) if (!Number.isInteger(value) || value < 1) throw invalid("Limits are whole numbers of at least 1.");
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function checkEmail(email: string): string {
  const address = email.trim().toLowerCase();
  if (!EMAIL.test(address)) throw invalid("Enter a valid email address.");
  return address;
}

/** A person already holds this email, or has a pending invite for it: one account per email. */
export function checkEmailFree(address: string, now: Date): void {
  const inUse = allUsers.some((user) => user.email.toLowerCase() === address) || platformUsers.some((user) => user.email.toLowerCase() === address);
  const invited = invites.some((invite) => invite.email.toLowerCase() === address && effectiveInviteStatus(invite, now) === "PENDING");
  if (inUse || invited) throw conflict("Someone with this email already has an account or a pending invite.", "EMAIL_TAKEN");
}

/** PLATFORM_ADMIN only, with the dev fault switch (docs/04 §0), like the firm-scoped mocks. */
/** The platform reads (anything a PLATFORM_ADMIN may look at); every other method is a write. */
const PLATFORM_READS = new Set(["list", "get", "usage"]);

/** Every platform write and the action it needs (the platform write test walks it). */
export const PLATFORM_WRITE_ACTIONS: Record<string, Record<string, PlatformAction>> = {};

/**
 * PLATFORM_ADMIN only, with the dev fault switch (docs/04 §0). Reads need a platform admin; every write
 * names its platform action and is refused (403) unless `can()` allows it — the same policy the admin
 * screens render from. A write without an action fails at load.
 */
function platformOnly<M extends Record<string, (...args: never[]) => unknown>>(resource: string, methods: M, writes: Partial<Record<keyof M & string, PlatformAction>> = {}): M {
  const guarded: Record<string, (...args: never[]) => Promise<unknown>> = {};
  for (const [name, method] of Object.entries(methods)) {
    const action = (writes as Record<string, PlatformAction | undefined>)[name];
    if (!PLATFORM_READS.has(name)) {
      if (!action) throw new Error(`platformOnly("${resource}"): the write "${name}" must name the action it needs`);
      (PLATFORM_WRITE_ACTIONS[resource] ??= {})[name] = action;
    }
    guarded[name] = async (...args) => {
      currentPlatformUser();
      if (action) requireAction(action);
      injectedFailure(`platform.${resource}.${name}`);
      return method(...args);
    };
  }
  return guarded as unknown as M;
}

/** Commit: persist the tables a write changed, and answer like a network call. */
function done<T>(value: T, ...tables: TableName[]): Promise<T> {
  changed(...tables, "ledger");
  return mockResult(value);
}


function sendInvite(input: { firmId: string | null; email: string; inviteeName: string | null; role: Invite["role"]; label: string }, now: Date): Invite {
  const invite: Invite = {
    id: newId("inv", now),
    firmId: input.firmId,
    email: input.email,
    inviteeName: input.inviteeName,
    role: input.role,
    invitedByUserId: currentPlatformUser().id,
    status: "PENDING",
    expiresAt: new Date(now.getTime() + INVITE_DAYS * DAY_MS).toISOString(),
    createdAt: now.toISOString(),
  };
  invites.unshift(invite);
  issueInviteToken(invite.id);
  log({ firmId: input.firmId, entityType: ENTITY.invite, entityId: invite.id, entityLabel: invite.email, action: "INVITE_SENT", summary: input.label }, now);
  return invite;
}

export const platformMock = {
  firms: platformOnly("firms", {
    list: (): Promise<Firm[]> => mockResult(firms),
    get: (firmId: string): Promise<Firm> => mockResult(firms[firmIndex(firmId)]!),

    /** docs/04 §14.4: the firm (ONBOARDING) with the plan's limits copied (A3), and its OWNER invite. */
    create: (input: CreateFirmInput, now = new Date()): Promise<Firm> => {
      const name = input.name.trim();
      const ownerName = input.ownerName.trim();
      if (!name) throw invalid("Enter the firm's name.");
      if (!ownerName) throw invalid("Enter the owner's name.");
      checkSlug(input.slug);
      const plan = planById(input.planId);
      if (!plan.isActive) throw invalid("That plan isn't offered to new firms.");
      const email = checkEmail(input.ownerEmail);
      checkEmailFree(email, now);
      const firm: Firm = {
        id: newId("firm", now),
        name,
        slug: input.slug,
        logoUrl: null,
        primaryTimezone: input.primaryTimezone,
        clientTimezone: input.clientTimezone,
        truthGuardMode: "BALANCED",
        applicationExpiryDays: 30,
        status: "ONBOARDING",
        planId: plan.id,
        seatLimit: plan.seatLimit,
        candidateLimit: plan.candidateLimit,
        contactPhone: input.contactPhone?.trim() || null,
        createdAt: now.toISOString(),
      };
      firms.push(firm);
      log({ firmId: firm.id, entityType: ENTITY.firm, entityId: firm.id, entityLabel: firm.name, action: "FIRM_CREATED", summary: `Created firm on ${plan.name} (${limitsText(plan)})` }, now);
      // 07 Q31: the name is prefilled on /invite/[token]; the owner may change it when accepting.
      sendInvite({ firmId: firm.id, email, inviteeName: ownerName, role: "OWNER", label: `Invited ${ownerName} (${email}) as OWNER` }, now);
      return done(firm, "firms", "invites");
    },

    /** docs/04 §14.5 Edit: name, contact phone, timezones. */
    update: (firmId: string, input: FirmProfileInput, now = new Date()): Promise<Firm> => {
      const index = firmIndex(firmId);
      const before = firms[index]!;
      const name = input.name.trim();
      if (!name) throw invalid("Enter the firm's name.");
      const after: Firm = { ...before, name, contactPhone: input.contactPhone?.trim() || null, primaryTimezone: input.primaryTimezone, clientTimezone: input.clientTimezone };
      const changes = [
        before.name !== after.name && `name "${before.name}" → "${after.name}"`,
        before.contactPhone !== after.contactPhone && `contact phone ${before.contactPhone ?? "none"} → ${after.contactPhone ?? "none"}`,
        before.primaryTimezone !== after.primaryTimezone && `primary timezone ${before.primaryTimezone} → ${after.primaryTimezone}`,
        before.clientTimezone !== after.clientTimezone && `client timezone ${before.clientTimezone} → ${after.clientTimezone}`,
      ].filter((change): change is string => Boolean(change));
      if (changes.length === 0) return mockResult(before);
      firms[index] = after;
      log({ firmId, entityType: ENTITY.firm, entityId: firmId, entityLabel: after.name, action: "UPDATE", summary: `Edited firm: ${changes.join("; ")}` }, now);
      return done(after, "firms");
    },

    /** docs/04 §14.5 Change slug: no redirect from the old one (A7). */
    changeSlug: (firmId: string, slug: string, now = new Date()): Promise<Firm> => {
      const index = firmIndex(firmId);
      const before = firms[index]!;
      if (before.slug === slug) return mockResult(before);
      checkSlug(slug, firmId);
      firms[index] = { ...before, slug };
      log({ firmId, entityType: ENTITY.firm, entityId: firmId, entityLabel: before.name, action: "UPDATE", summary: `Slug ${before.slug} → ${slug}` }, now);
      return done(firms[index]!, "firms");
    },

    /** docs/04 §14.5, 07 Q29: ACTIVE firms only; a reason of at least 10 characters. */
    suspend: (firmId: string, reason: string, now = new Date()): Promise<Firm> => {
      const index = firmIndex(firmId);
      const firm = firms[index]!;
      if (firm.status !== "ACTIVE") throw conflict("Only an active firm can be suspended.");
      const text = reason.trim();
      if (text.length < 10) throw invalid("Give a reason of at least 10 characters.");
      firms[index] = { ...firm, status: "SUSPENDED" };
      log({ firmId, entityType: ENTITY.firm, entityId: firmId, entityLabel: firm.name, action: "FIRM_SUSPENDED", summary: `Suspended: ${text}` }, now);
      return done(firms[index]!, "firms");
    },

    /** Not blocked by being over a limit (docs/02 implication 5). */
    reactivate: (firmId: string, now = new Date()): Promise<Firm> => {
      const index = firmIndex(firmId);
      const firm = firms[index]!;
      if (firm.status !== "SUSPENDED") throw conflict("Only a suspended firm can be reactivated.");
      firms[index] = { ...firm, status: "ACTIVE" };
      log({ firmId, entityType: ENTITY.firm, entityId: firmId, entityLabel: firm.name, action: "FIRM_REACTIVATED", summary: "Reactivated" }, now);
      return done(firms[index]!, "firms");
    },

    /** Copies the plan's limits (A3); allowed even if usage is over them (A4: never auto-remove). */
    changePlan: (firmId: string, planId: string, now = new Date()): Promise<Firm> => {
      const index = firmIndex(firmId);
      const firm = firms[index]!;
      const from = planById(firm.planId);
      const to = planById(planId);
      if (!to.isActive && to.id !== firm.planId) throw invalid("That plan isn't offered any more.");
      const after: Firm = { ...firm, planId: to.id, seatLimit: to.seatLimit, candidateLimit: to.candidateLimit };
      firms[index] = after;
      const summary = `${from.name} → ${to.name}, seats ${firm.seatLimit} → ${after.seatLimit}, candidates ${firm.candidateLimit} → ${after.candidateLimit}`;
      log({ firmId, entityType: ENTITY.firm, entityId: firmId, entityLabel: firm.name, action: "PLAN_CHANGED", summary }, now);
      return done(after, "firms");
    },

    /** Custom limits (07 Q29, Q30): PLAN_CHANGED on `firm_limits`, which marks the firm "custom limits". */
    adjustLimits: (firmId: string, limits: LimitsInput, now = new Date()): Promise<Firm> => {
      checkLimits(limits);
      const index = firmIndex(firmId);
      const firm = firms[index]!;
      const plan = planById(firm.planId);
      const after: Firm = { ...firm, seatLimit: limits.seatLimit, candidateLimit: limits.candidateLimit };
      firms[index] = after;
      const summary = `Custom limits on ${plan.name}: seats ${firm.seatLimit} → ${after.seatLimit}, candidates ${firm.candidateLimit} → ${after.candidateLimit}`;
      log({ firmId, entityType: ENTITY.firmLimits, entityId: firmId, entityLabel: firm.name, action: "PLAN_CHANGED", summary }, now);
      return done(after, "firms");
    },
  }, { create: "firm.create", update: "firm.edit", changeSlug: "firm.edit", changePlan: "firm.edit", adjustLimits: "firm.edit", suspend: "firm.suspend", reactivate: "firm.suspend" }),

  users: platformOnly("users", {
    /** Every firm user, or one firm's. */
    list: (firmId?: string): Promise<User[]> => mockResult(firmId ? allUsers.filter((user) => user.firmId === firmId) : allUsers),

    /** docs/04 §14.5 Users tab: never the OWNER (A10). STATE_CHANGE (07 Q30). */
    deactivate: (userId: string, now = new Date()): Promise<User> => {
      const index = allUsers.findIndex((user) => user.id === userId);
      const user = allUsers[index] ?? notFound("User", userId);
      if (isOwner(user)) throw conflict("The firm's owner can't be deactivated.");
      if (!user.isActive) return mockResult(user);
      allUsers[index] = { ...user, isActive: false };
      log({ firmId: user.firmId, entityType: ENTITY.user, entityId: user.id, entityLabel: user.name, action: "STATE_CHANGE", summary: `Deactivated ${user.name} (${user.role})` }, now);
      return done(allUsers[index]!, "users");
    },

    /** Blocked when the firm can't add a seat (A4), with the reason naming the limit. */
    reactivate: (userId: string, now = new Date()): Promise<User> => {
      const index = allUsers.findIndex((user) => user.id === userId);
      const user = allUsers[index] ?? notFound("User", userId);
      if (user.isActive) return mockResult(user);
      const firm = firms[firmIndex(user.firmId)]!;
      const usage = usageOf(firm, usageData(), now);
      if (!usage.canAddSeat) throw conflict(seatBlockReason(usage), "SEAT_LIMIT");
      allUsers[index] = { ...user, isActive: true };
      log({ firmId: user.firmId, entityType: ENTITY.user, entityId: user.id, entityLabel: user.name, action: "STATE_CHANGE", summary: `Reactivated ${user.name} (${user.role})` }, now);
      return done(allUsers[index]!, "users");
    },
  }, { deactivate: "firm.edit", reactivate: "firm.edit" }),

  invites: platformOnly("invites", {
    /** Every invite, one firm's, or (null) the platform team's. */
    list: (firmId?: string | null): Promise<Invite[]> => mockResult(firmId === undefined ? invites : invites.filter((invite) => invite.firmId === firmId)),

    /**
     * Same row, a new token, expiry now + 7 days (A9); logs INVITE_SENT "Invite resent to …" (Q24).
     * Resending an expired firm invite takes a seat again, so it is blocked at the seat limit (A4).
     */
    resend: (inviteId: string, now = new Date()): Promise<Invite> => {
      const index = invites.findIndex((invite) => invite.id === inviteId);
      const invite = invites[index] ?? notFound("Invite", inviteId);
      const status = effectiveInviteStatus(invite, now);
      if (status !== "PENDING" && status !== "EXPIRED") throw conflict("Only a pending or expired invite can be resent.");
      if (status === "EXPIRED" && invite.firmId) {
        const usage = usageOf(firms[firmIndex(invite.firmId)]!, usageData(), now);
        if (!usage.canAddSeat) throw conflict(seatBlockReason(usage), "SEAT_LIMIT");
      }
      invites[index] = { ...invite, status: "PENDING", expiresAt: new Date(now.getTime() + INVITE_DAYS * DAY_MS).toISOString() };
      issueInviteToken(invite.id); // A9: a new token; the old link stops working
      log({ firmId: invite.firmId, entityType: ENTITY.invite, entityId: invite.id, entityLabel: invite.email, action: "INVITE_SENT", summary: `Invite resent to ${invite.email}` }, now);
      return done(invites[index]!, "invites");
    },

    /** The live token of a pending invite, for "Copy invite link" (the link is /invite/[token]). */
    link: (inviteId: string, now = new Date()): Promise<{ token: string }> => {
      const invite = invites.find((item) => item.id === inviteId) ?? notFound("Invite", inviteId);
      if (effectiveInviteStatus(invite, now) !== "PENDING") throw conflict("Only a pending invite has a link. Resend an expired one first.");
      const token = tokenForInvite(invite.id) ?? issueInviteToken(invite.id);
      return mockResult({ token });
    },

    revoke: (inviteId: string, now = new Date()): Promise<Invite> => {
      const index = invites.findIndex((invite) => invite.id === inviteId);
      const invite = invites[index] ?? notFound("Invite", inviteId);
      if (effectiveInviteStatus(invite, now) !== "PENDING") throw conflict("Only a pending invite can be revoked.");
      invites[index] = { ...invite, status: "REVOKED" };
      log({ firmId: invite.firmId, entityType: ENTITY.invite, entityId: invite.id, entityLabel: invite.email, action: "INVITE_REVOKED", summary: `Revoked the invite to ${invite.email}` }, now);
      return done(invites[index]!, "invites");
    },
  }, { resend: "invite.resend", link: "invite.resend", revoke: "invite.revoke" }),

  plans: platformOnly("plans", {
    list: (): Promise<Plan[]> => mockResult(plans),

    /** docs/04 §14.6: CREATE on `plan`, firmId null (docs/02 implication 3). */
    create: (input: PlanInput, now = new Date()): Promise<Plan> => {
      const name = input.name.trim();
      if (!name) throw invalid("Enter the plan's name.");
      if (plans.some((plan) => plan.name.toLowerCase() === name.toLowerCase())) throw conflict("A plan with this name already exists.");
      checkLimits(input);
      const plan: Plan = { id: newId("plan", now), name, seatLimit: input.seatLimit, candidateLimit: input.candidateLimit, features: input.features.map((item) => item.trim()).filter(Boolean), isActive: true };
      plans.push(plan);
      log({ firmId: null, entityType: ENTITY.plan, entityId: plan.id, entityLabel: plan.name, action: "CREATE", summary: `Created plan ${plan.name} (${limitsText(plan)})` }, now);
      return done(plan, "plans");
    },

    /** Never changes existing firms (A3). */
    update: (planId: string, input: PlanInput, now = new Date()): Promise<Plan> => {
      const index = plans.findIndex((plan) => plan.id === planId);
      const before = plans[index] ?? notFound("Plan", planId);
      const name = input.name.trim();
      if (!name) throw invalid("Enter the plan's name.");
      if (plans.some((plan) => plan.id !== planId && plan.name.toLowerCase() === name.toLowerCase())) throw conflict("A plan with this name already exists.");
      checkLimits(input);
      const after: Plan = { ...before, name, seatLimit: input.seatLimit, candidateLimit: input.candidateLimit, features: input.features.map((item) => item.trim()).filter(Boolean) };
      plans[index] = after;
      log({ firmId: null, entityType: ENTITY.plan, entityId: planId, entityLabel: after.name, action: "UPDATE", summary: `Edited plan ${before.name}: ${limitsText(before)} → ${limitsText(after)}` }, now);
      return done(after, "plans");
    },

    /** Hide (isActive false: not offered to new firms) or show again. */
    setActive: (planId: string, isActive: boolean, now = new Date()): Promise<Plan> => {
      const index = plans.findIndex((plan) => plan.id === planId);
      const plan = plans[index] ?? notFound("Plan", planId);
      if (plan.isActive === isActive) return mockResult(plan);
      plans[index] = { ...plan, isActive };
      log({ firmId: null, entityType: ENTITY.plan, entityId: planId, entityLabel: plan.name, action: "UPDATE", summary: `${isActive ? "Showed" : "Hid"} plan ${plan.name}` }, now);
      return done(plans[index]!, "plans");
    },
  }, { create: "plan.edit", update: "plan.edit", setActive: "plan.edit" }),

  audit: platformOnly("audit", {
    /** Every ledger entry, platform and firm (A13), newest first. */
    list: (): Promise<LedgerEntry[]> => mockResult([...allLedger].sort((a, b) => b.createdAt.localeCompare(a.createdAt))),
  }),

  team: platformOnly("team", {
    list: (): Promise<PlatformUser[]> => mockResult(platformUsers),

    /** docs/04 §14.8: email only, role always PLATFORM_ADMIN (A11); firmId null. */
    invite: (email: string, now = new Date()): Promise<Invite> => {
      const address = checkEmail(email);
      checkEmailFree(address, now);
      const invite = sendInvite({ firmId: null, email: address, inviteeName: null, role: "PLATFORM_ADMIN", label: `Invited ${address} to the platform team` }, now);
      return done(invite, "invites");
    },

    /** Not yourself, and never the last active admin (docs/04 §14.8). STATE_CHANGE (07 Q30). */
    deactivate: (userId: string, now = new Date()): Promise<PlatformUser> => {
      const self = currentPlatformUser();
      const index = platformUsers.findIndex((user) => user.id === userId);
      const user = platformUsers[index] ?? notFound("Staff member", userId);
      if (user.id === self.id) throw conflict("You can't deactivate yourself.");
      if (!user.isActive) return mockResult(user);
      if (platformUsers.filter((item) => item.isActive).length <= 1) throw conflict("The last active admin can't be deactivated.");
      platformUsers[index] = { ...user, isActive: false };
      log({ firmId: null, entityType: ENTITY.platformUser, entityId: user.id, entityLabel: user.name, action: "STATE_CHANGE", summary: `Deactivated ${user.name}` }, now);
      return done(platformUsers[index]!, "platformUsers");
    },
  }, { invite: "platformTeam.manage", deactivate: "platformTeam.manage" }),

  /** Minimal candidate rows for usage counts (A2): firm and status only. */
  candidates: platformOnly("candidates", {
    usage: (): Promise<{ firmId: string; status: (typeof allCandidates)[number]["status"] }[]> =>
      mockResult(allCandidates.map((candidate) => ({ firmId: candidate.firmId, status: candidate.status }))),
  }),
};
