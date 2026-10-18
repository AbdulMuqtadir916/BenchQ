import { sessionApi } from "@/lib/api/session";
import type { FirmSession, Session } from "@/lib/schemas/session";
import { DEMO_PASSWORD } from "./auth";
import { allUsers } from "./team-data";
import { platformUsers } from "./tenancy";

/**
 * TESTS ONLY: sign in as a seeded account by id, through the same path /sign-in uses
 * (`sessionApi.signIn` with the account's email and the demo password, docs/03 §3.2). No back door.
 */
export function seedEmailOf(accountId: string): string {
  const account = allUsers.find((user) => user.id === accountId) ?? platformUsers.find((admin) => admin.id === accountId);
  if (!account) throw new Error(`No seeded account ${accountId}`);
  return account.email;
}

export function signInAs(accountId: string): Promise<Session> {
  return sessionApi.signIn(seedEmailOf(accountId), DEMO_PASSWORD);
}

/** A firm user's session (throws for a platform admin): for tests that read `user` / `firm`. */
export async function signInAsFirmUser(userId: string): Promise<FirmSession> {
  const session = await signInAs(userId);
  if (!("user" in session)) throw new Error(`${userId} is not a firm user`);
  return session;
}
