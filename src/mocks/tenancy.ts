import { arrayOf } from "@/lib/api/client";
import { InviteSchema, PlanSchema, PlatformUserSchema, type Invite, type Plan, type PlatformUser } from "@/lib/schemas/tenancy";
import plansSeed from "./data/plans.json";
import invitesSeed from "./data/invites.json";
import platformUsersSeed from "./data/platform-users.json";

/**
 * Platform-tier fixtures (docs/02 §3.1). No adapter serves them yet: the admin area arrives in
 * Phase P, and firm-scoped invites in T5. Parsed here so every fixture is validated.
 */
export const plans: Plan[] = arrayOf(PlanSchema).parse(plansSeed);
export const platformUsers: PlatformUser[] = arrayOf(PlatformUserSchema).parse(platformUsersSeed);

/**
 * The instant the invite dates in invites.json were written against. At load they are shifted so
 * that instant becomes "now": a pending invite stays pending (now + 5 days) and an expired one stays
 * expired (now − 2 days) however long the app has been running. Tests pass a fixed clock instead.
 */
export const FIXTURE_NOW = new Date("2026-10-18T12:00:00.000Z");

const inviteSeed: Invite[] = arrayOf(InviteSchema).parse(invitesSeed);

export function invitesAt(now: Date): Invite[] {
  const shift = now.getTime() - FIXTURE_NOW.getTime();
  const move = (iso: string) => new Date(new Date(iso).getTime() + shift).toISOString();
  return inviteSeed.map((invite) => InviteSchema.parse({ ...invite, createdAt: move(invite.createdAt), expiresAt: move(invite.expiresAt) }));
}

/** Invites as the live UI sees them, relative to when the app loaded. */
export const invites: Invite[] = invitesAt(new Date());
