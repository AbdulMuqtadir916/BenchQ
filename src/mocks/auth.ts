import { ApiError } from "@/lib/api/client";
import { liveSession } from "@/lib/api/live-session";
import type { Principal, PlatformUser } from "@/lib/schemas/tenancy";
import type { Firm, User } from "@/lib/schemas/session";
import { allUsers, firms } from "./team-data";

/**
 * Who the mocked modules act for. The session is the backend's (src/lib/api/live-session.ts remembers the last
 * answer of `GET /api/auth/me`); the mocks read it synchronously, the way a server reads its cookie, and
 * refuse (401 / 403 / 404) the way the backend does. There is no mock sign-in, password or stored session
 * here any more (F6): tests sign in through `signInAs` (./sign-in-as.ts). Temporary: it goes when the last
 * mocked module is live.
 */

export function userById(userId: string): User {
  const user = allUsers.find((item) => item.id === userId);
  if (!user) throw new ApiError("That user can't sign in here.", "UNKNOWN_USER", 400);
  return user;
}

export function firmById(firmId: string): Firm {
  // The session's firm may be one created on the backend, which the fixtures don't have.
  const own = liveSession()?.firm;
  const firm = firms.find((item) => item.id === firmId) ?? (own?.id === firmId ? own : undefined);
  if (!firm) throw new ApiError(`Firm ${firmId} not found.`, "NOT_FOUND", 404);
  return firm;
}

function requireSession() {
  const session = liveSession();
  if (!session) throw new ApiError("Sign in to continue.", "UNAUTHENTICATED", 401);
  return session;
}

export function currentPrincipal(): Principal {
  return requireSession().principal;
}

/** The signed-in firm user (the actor of a firm mutation). A platform admin never acts as one (Q10). */
export function currentUser(): User {
  const session = requireSession();
  if (!("user" in session)) throw new ApiError("A platform admin can't act inside a firm.", "FORBIDDEN", 403);
  return session.user;
}

/** The signed-in platform admin. */
export function currentPlatformUser(): PlatformUser {
  const session = requireSession();
  if ("user" in session) throw new ApiError("Platform admins only.", "FORBIDDEN", 403);
  return session.platformUser;
}
