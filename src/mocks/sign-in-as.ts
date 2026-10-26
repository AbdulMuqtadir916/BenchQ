import { ApiError } from "@/lib/api/client";
import { liveSession, rememberLiveSession } from "@/lib/api/live-session";
import type { Firm, FirmSession, PlatformSession, Session } from "@/lib/schemas/session";
import { allUsers, firms } from "./team-data";
import { platformUsers } from "./tenancy";

/**
 * TESTS ONLY: be signed in as a seeded account (docs/03 §3.2) without a backend. It hands the mocked modules the
 * session the backend would have answered with: the same shape `GET /api/auth/me` maps to, and nothing else.
 * No password, no storage. What the real sign-in does is the backend's, tested there and in live-*.test.ts.
 */
export function seedEmailOf(accountId: string): string {
  const account = allUsers.find((user) => user.id === accountId) ?? platformUsers.find((admin) => admin.id === accountId);
  if (!account) throw new Error(`No seeded account ${accountId}`);
  return account.email;
}

function sessionOf(accountId: string): Session {
  const admin = platformUsers.find((item) => item.id === accountId);
  if (admin) {
    const session: PlatformSession = { principal: { kind: "platform", userId: admin.id, role: "PLATFORM_ADMIN", support: null }, platformUser: admin, firm: null };
    return session;
  }
  const user = allUsers.find((item) => item.id === accountId);
  const firm = user && firms.find((item) => item.id === user.firmId);
  if (!user || !firm) throw new Error(`No seeded account ${accountId}`);
  const session: FirmSession = { principal: { kind: "firm", userId: user.id, firmId: user.firmId, role: user.role }, user, firm };
  return session;
}

export async function signInAs(accountId: string): Promise<Session> {
  const session = sessionOf(accountId);
  rememberLiveSession(session, { broadcast: false });
  return session;
}

/** A Super Admin inside a read-only support view of `firmId` (07 §4): the session the backend answers with after `POST /api/support-views`. */
export async function signInAsSupportView(adminId: string, firmId: string): Promise<Session> {
  const session = sessionOf(adminId);
  const firm = firms.find((item) => item.id === firmId);
  if (!firm || !("platformUser" in session)) throw new Error(`${adminId} can't view ${firmId}`);
  const startedAt = new Date();
  const view = { id: `sv_test_${firmId}`, firmId, reason: "Checking what the firm sees", startedAt: startedAt.toISOString(), expiresAt: new Date(startedAt.getTime() + 60 * 60_000).toISOString() };
  const inView: PlatformSession = { ...session, principal: { ...session.principal, support: view }, firm };
  rememberLiveSession(inView, { broadcast: false });
  return inView;
}

/** Back to signed out. */
export function signOutForTest(): void {
  rememberLiveSession(null, { broadcast: false });
}

/** A firm user's session (throws for a platform admin): for tests that read `user` / `firm`. */
export async function signInAsFirmUser(userId: string): Promise<FirmSession> {
  const session = await signInAs(userId);
  if (!("user" in session)) throw new Error(`${userId} is not a firm user`);
  return session;
}

/**
 * What `GET /api/firms/by-slug/{slug}` answers, for tests of the firm gate: 401 signed out; for a firm user their own
 * firm, and 404 for any other slug (an unknown one and another firm's alike); for a Super Admin any existing firm.
 * The real endpoint is the backend's, tested in backend/tests/test_isolation.py.
 */
export async function firmBySlugForTest(slug: string): Promise<Firm> {
  const session = liveSession();
  if (!session) throw new ApiError("Sign in to continue.", "UNAUTHENTICATED", 401);
  const firm = firms.find((item) => item.slug === slug);
  const reachable = firm && ("user" in session ? session.user.firmId === firm.id : true);
  if (!reachable) throw new ApiError("Not found.", "NOT_FOUND", 404);
  return firm;
}
