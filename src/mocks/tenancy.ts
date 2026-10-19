import { arrayOf } from "@/lib/api/client";
import { InviteSchema, PlanSchema, PlatformUserSchema, type Invite, type Plan, type PlatformUser } from "@/lib/schemas/tenancy";
import plansSeed from "./data/plans.json";
import invitesSeed from "./data/invites.json";
import platformUsersSeed from "./data/platform-users.json";
import { seededAt, table } from "./db";

/**
 * Platform-tier tables (docs/02 §3.1), persisted (src/mocks/db.ts): the plan catalogue and BenchQ staff,
 * both changed from /admin (docs/04 §14.6, §14.8).
 */
export const plans: Plan[] = table("plans", PlanSchema, () => arrayOf(PlanSchema).parse(plansSeed));
export const platformUsers: PlatformUser[] = table("platformUsers", PlatformUserSchema, () => arrayOf(PlatformUserSchema).parse(platformUsersSeed));

/**
 * The instant the invite dates in invites.json were written against. At load they are shifted so
 * that instant becomes "now": a pending invite stays pending (now + 5 days) and an expired one stays
 * expired (now − 2 days) however long the app has been running. Tests pass a fixed clock instead.
 */
export const FIXTURE_NOW = new Date("2026-10-18T12:00:00.000Z");

const inviteSeed: Invite[] = arrayOf(InviteSchema).parse(invitesSeed);

/** Move a fixture date so that FIXTURE_NOW becomes `now` (invites, and the ledger entries about them). */
export function shiftFixtureDate(iso: string, now: Date): string {
  return new Date(new Date(iso).getTime() + now.getTime() - FIXTURE_NOW.getTime()).toISOString();
}

export function invitesAt(now: Date): Invite[] {
  const move = (iso: string) => shiftFixtureDate(iso, now);
  return inviteSeed.map((invite) => InviteSchema.parse({ ...invite, createdAt: move(invite.createdAt), expiresAt: move(invite.expiresAt) }));
}

/**
 * The invites table (persisted, src/mocks/db.ts). Seeded relative to the instant this browser's demo
 * data was seeded (`seededAt`), once: from then on the dates are real, so a pending invite expires 5
 * days after seeding like a real one, and a reset re-anchors them to the new "now" (docs/03 §3.3).
 */
export const invites: Invite[] = table("invites", InviteSchema, () => invitesAt(seededAt()));
