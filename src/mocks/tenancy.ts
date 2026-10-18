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
export const invites: Invite[] = arrayOf(InviteSchema).parse(invitesSeed);
export const platformUsers: PlatformUser[] = arrayOf(PlatformUserSchema).parse(platformUsersSeed);
