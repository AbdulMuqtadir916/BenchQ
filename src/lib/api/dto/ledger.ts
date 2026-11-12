import { z } from "zod";
import { FirmRole } from "@/lib/schemas/enums";
import { LedgerCandidateSchema, LedgerPeopleSchema, PlatformActivityOverviewSchema, type LedgerCandidate, type LedgerPeople, type PlatformActivityOverview } from "@/lib/schemas/analytics";
import { fromBackendId } from "./demo-ids";

/** GET /api/firms/{id}/ledger/people (backend/api/routes_ledger.py). */
export const LedgerPeopleDto = z.object({
  timezone: z.string(),
  actor_types: z.array(z.string()),
  total: z.number(),
  matching: z.number(),
  people: z.array(z.object({
    user_id: z.string(),
    name: z.string(),
    role: FirmRole,
    manager_id: z.string().nullable(),
    is_former: z.boolean(),
    actions: z.number(),
  })),
});

/** GET /api/admin/activity/overview (backend/api/routes_admin_activity.py). */
export const PlatformActivityOverviewDto = z.object({
  timezone: z.string(),
  actor_types: z.array(z.string()),
  total: z.number(),
  matching: z.number(),
  failed: z.number(),
  me: z.object({ user_id: z.string(), name: z.string(), actions: z.number() }),
  firms: z.array(z.object({ id: z.string(), name: z.string(), managers: z.number(), actions: z.number() })),
});

/** GET /api/firms/{id}/ledger/candidates. */
export const LedgerCandidateDto = z.object({ id: z.string(), name: z.string() });

export function toLedgerPeople(dto: z.infer<typeof LedgerPeopleDto>): LedgerPeople {
  return LedgerPeopleSchema.parse({
    actorTypes: dto.actor_types,
    total: dto.total,
    matching: dto.matching,
    people: dto.people.map((person) => ({
      userId: fromBackendId(person.user_id),
      name: person.name,
      role: person.role,
      managerId: person.manager_id === null ? null : fromBackendId(person.manager_id),
      isFormer: person.is_former,
      actions: person.actions,
    })),
  });
}

/** What a candidate with no name on their résumé is called, so a blank never shows in a table or a list. */
export const UNNAMED_CANDIDATE = "Unnamed candidate";

export function toPlatformActivityOverview(dto: z.infer<typeof PlatformActivityOverviewDto>): PlatformActivityOverview {
  return PlatformActivityOverviewSchema.parse({
    timezone: dto.timezone,
    actorTypes: dto.actor_types,
    total: dto.total,
    matching: dto.matching,
    failed: dto.failed,
    me: { userId: fromBackendId(dto.me.user_id), name: dto.me.name, actions: dto.me.actions },
    firms: dto.firms.map((firm) => ({ ...firm, id: fromBackendId(firm.id) })),
  });
}

export function toLedgerCandidate(dto: z.infer<typeof LedgerCandidateDto>): LedgerCandidate {
  return LedgerCandidateSchema.parse({ id: fromBackendId(dto.id), name: dto.name.trim() || UNNAMED_CANDIDATE });
}
