import { z } from "zod";
import { LedgerEntrySchema, type LedgerEntry } from "@/lib/schemas/analytics";
import { FirmSchema, SessionSchema, UserSchema, type Firm, type Session, type User } from "@/lib/schemas/session";
import { InviteSchema, PlanSchema, PlatformUserSchema, type Invite, type Plan, type PlatformUser } from "@/lib/schemas/tenancy";
import { fromBackendId } from "./demo-ids";
import { toIso, toIsoOrNull } from "./shared";

/**
 * The backend's session, firm, user, invite, plan and ledger shapes (backend/auth/serialize.py,
 * backend/auth/invites.py: the frontend's schemas in snake_case) and their mappers. Every id passes through
 * `fromBackendId`, so a seeded demo row keeps the id the mocks know it by (./demo-ids.ts). Each mapper ends
 * with the frontend schema's own parse, so a backend drift fails here, not in a screen.
 */

const id = z.string();
const nullableId = z.string().nullable();
const mapId = (value: string) => fromBackendId(value);
const mapNullableId = (value: string | null) => (value === null ? null : fromBackendId(value));
/**
 * Fields the backend adds in the candidate-onboarding track (docs/candidate-onboarding/06-backend.md PRs 1–2). Optional
 * until it sends them: a missing manager is null, which 07 Q51 allows for users and invites from before the hierarchy.
 */
const pendingNullableId = nullableId.optional();

export const FirmDto = z.object({
  id,
  name: z.string(),
  slug: z.string(),
  logo_url: z.string().nullable(),
  primary_timezone: z.string(),
  client_timezone: z.string(),
  truth_guard_mode: z.string(),
  application_expiry_days: z.number(),
  status: z.string(),
  plan_id: id,
  seat_limit: z.number(),
  candidate_limit: z.number(),
  contact_phone: z.string().nullable(),
  bde_capacity: z.number().optional(),
  created_at: z.string(),
});

export const UserDto = z.object({
  id,
  firm_id: id,
  name: z.string(),
  email: z.string(),
  role: z.string(),
  manager_id: pendingNullableId,
  avatar_url: z.string().nullable(),
  is_active: z.boolean(),
  last_active_at: z.string().nullable(),
});

export const PlatformUserDto = z.object({
  id,
  name: z.string(),
  email: z.string(),
  role: z.string(),
  is_active: z.boolean(),
  last_active_at: z.string().nullable(),
});

const SupportViewDto = z.object({ id, firm_id: id, reason: z.string(), started_at: z.string(), expires_at: z.string() });

export const SessionDto = z.union([
  z.object({
    principal: z.object({ kind: z.literal("firm"), user_id: id, firm_id: id, role: z.string() }),
    user: UserDto,
    firm: FirmDto,
  }),
  z.object({
    principal: z.object({ kind: z.literal("platform"), user_id: id, role: z.string(), support: SupportViewDto.nullable() }),
    platform_user: PlatformUserDto,
    firm: FirmDto.nullable(),
  }),
]);

export const InviteDto = z.object({
  id,
  firm_id: nullableId,
  email: z.string(),
  invitee_name: z.string().nullable(),
  role: z.string(),
  invited_by_user_id: id,
  manager_id: pendingNullableId,
  status: z.string(),
  expires_at: z.string(),
  created_at: z.string(),
});

export const PlanDto = z.object({
  id,
  name: z.string(),
  seat_limit: z.number(),
  candidate_limit: z.number(),
  features: z.array(z.string()),
  is_active: z.boolean(),
});

export const LedgerEntryDto = z.object({
  id,
  firm_id: nullableId,
  actor_user_id: nullableId,
  actor_type: z.string(),
  actor_name: z.string(),
  entity_type: z.string(),
  entity_id: z.string(),
  entity_label: z.string(),
  action: z.string(),
  summary: z.string(),
  note: z.string().nullable().optional(),
  model_id: z.string().nullable(),
  prompt_version: z.string().nullable(),
  evidence_ids: z.array(z.string()),
  claim_state: z.string().nullable(),
  created_at: z.string(),
});

/** GET /api/invites/{token}: INVALID alone, or the state with what the link may show. */
export const InviteLookupDto = z.union([
  z.object({ status: z.literal("INVALID") }),
  z.object({
    status: z.enum(["VALID", "EXPIRED", "REVOKED", "ACCEPTED", "SUSPENDED"]),
    firm_name: z.string().nullable(),
    email: z.string(),
    invitee_name: z.string().nullable(),
    role: z.string(),
    expires_at: z.string(),
  }),
]);

/** What creating a firm or sending / resending an invite returns: the link's token, shown once (07 Q38). */
export const InviteWithTokenDto = z.object({ invite: InviteDto, invite_token: z.string() });
export const CreatedFirmDto = InviteWithTokenDto.extend({ firm: FirmDto });

/** What exiting a support view returns (backend/api/routes_support.py): the session, and the firm it was of. */
export const SupportExitDto = z.object({ session: SessionDto, firm_id: nullableId });

export function toSupportExit(dto: z.infer<typeof SupportExitDto>): { session: Session; firmId: string | null } {
  return { session: toSession(dto.session), firmId: mapNullableId(dto.firm_id) };
}

export function toFirm(dto: z.infer<typeof FirmDto>): Firm {
  return FirmSchema.parse({
    id: mapId(dto.id),
    name: dto.name,
    slug: dto.slug,
    logoUrl: dto.logo_url,
    primaryTimezone: dto.primary_timezone,
    clientTimezone: dto.client_timezone,
    truthGuardMode: dto.truth_guard_mode,
    applicationExpiryDays: dto.application_expiry_days,
    status: dto.status,
    planId: mapId(dto.plan_id),
    seatLimit: dto.seat_limit,
    candidateLimit: dto.candidate_limit,
    contactPhone: dto.contact_phone,
    bdeCapacity: dto.bde_capacity,
    createdAt: toIso(dto.created_at),
  });
}

export function toUser(dto: z.infer<typeof UserDto>): User {
  return UserSchema.parse({
    id: mapId(dto.id),
    firmId: mapId(dto.firm_id),
    name: dto.name,
    email: dto.email,
    role: dto.role,
    managerId: mapNullableId(dto.manager_id ?? null),
    avatarUrl: dto.avatar_url,
    isActive: dto.is_active,
    lastActiveAt: toIsoOrNull(dto.last_active_at),
  });
}

export function toPlatformUser(dto: z.infer<typeof PlatformUserDto>): PlatformUser {
  return PlatformUserSchema.parse({
    id: mapId(dto.id),
    name: dto.name,
    email: dto.email,
    role: dto.role,
    isActive: dto.is_active,
    lastActiveAt: toIsoOrNull(dto.last_active_at),
  });
}

export function toSession(dto: z.infer<typeof SessionDto>): Session {
  if (dto.principal.kind === "firm" && "user" in dto) {
    const { principal } = dto;
    return SessionSchema.parse({
      principal: { kind: "firm", userId: mapId(principal.user_id), firmId: mapId(principal.firm_id), role: principal.role },
      user: toUser(dto.user),
      firm: toFirm(dto.firm),
    });
  }
  if (dto.principal.kind === "platform" && "platform_user" in dto) {
    const { support } = dto.principal;
    return SessionSchema.parse({
      principal: {
        kind: "platform",
        userId: mapId(dto.principal.user_id),
        role: dto.principal.role,
        support: support && {
          id: support.id,
          firmId: mapId(support.firm_id),
          reason: support.reason,
          startedAt: toIso(support.started_at),
          expiresAt: toIso(support.expires_at),
        },
      },
      platformUser: toPlatformUser(dto.platform_user),
      firm: dto.firm ? toFirm(dto.firm) : null,
    });
  }
  throw new Error("The backend's session has a principal that doesn't match its records.");
}

export function toInvite(dto: z.infer<typeof InviteDto>): Invite {
  return InviteSchema.parse({
    id: mapId(dto.id),
    firmId: mapNullableId(dto.firm_id),
    email: dto.email,
    inviteeName: dto.invitee_name,
    role: dto.role,
    invitedByUserId: mapId(dto.invited_by_user_id),
    managerId: mapNullableId(dto.manager_id ?? null),
    status: dto.status,
    expiresAt: toIso(dto.expires_at),
    createdAt: toIso(dto.created_at),
  });
}

export function toPlan(dto: z.infer<typeof PlanDto>): Plan {
  return PlanSchema.parse({
    id: mapId(dto.id),
    name: dto.name,
    seatLimit: dto.seat_limit,
    candidateLimit: dto.candidate_limit,
    features: dto.features,
    isActive: dto.is_active,
  });
}

export function toLedgerEntry(dto: z.infer<typeof LedgerEntryDto>): LedgerEntry {
  return LedgerEntrySchema.parse({
    id: dto.id,
    firmId: mapNullableId(dto.firm_id),
    actorUserId: mapNullableId(dto.actor_user_id),
    actorType: dto.actor_type,
    actorName: dto.actor_name,
    entityType: dto.entity_type,
    entityId: mapId(dto.entity_id),
    entityLabel: dto.entity_label,
    action: dto.action,
    summary: dto.summary,
    note: dto.note ?? null,
    modelId: dto.model_id,
    promptVersion: dto.prompt_version,
    evidenceIds: dto.evidence_ids,
    claimState: dto.claim_state,
    createdAt: toIso(dto.created_at),
  });
}
