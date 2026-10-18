import { ApiError } from "@/lib/api/client";
import type { Principal, PlatformUser } from "@/lib/schemas/tenancy";
import type { Firm, User } from "@/lib/schemas/session";
import { allUsers, firms } from "./team-data";
import { platformUsers } from "./tenancy";

/**
 * The mock backend's sign-in state: who the "server" thinks is signed in. A real backend reads this
 * from the session cookie; here the dev principal switcher sets it through the session adapter, so
 * mutations (status changes, uploads) are attributed to the right person. A firm user or a platform
 * admin (docs/07 §3); the platform admin's support view arrives in P4.
 */
export const DEFAULT_USER_ID = "user_adnan";

/** null = signed out: every call that needs someone then fails with 401, as a real backend would. */
let signedInId: string | null = DEFAULT_USER_ID;

export function userById(userId: string): User {
  const user = allUsers.find((item) => item.id === userId);
  if (!user) throw new ApiError("That user can't sign in here.", "UNKNOWN_USER", 400);
  return user;
}

function platformUserById(userId: string): PlatformUser | null {
  return platformUsers.find((item) => item.id === userId) ?? null;
}

export function firmById(firmId: string): Firm {
  const firm = firms.find((item) => item.id === firmId);
  if (!firm) throw new ApiError(`Firm ${firmId} not found.`, "NOT_FOUND", 404);
  return firm;
}

export function isSignedIn(): boolean {
  return signedInId !== null;
}

function requireSignedIn(): string {
  if (signedInId === null) throw new ApiError("Sign in to continue.", "UNAUTHENTICATED", 401);
  return signedInId;
}

export function currentPrincipal(): Principal {
  const id = requireSignedIn();
  const admin = platformUserById(id);
  if (admin) return { kind: "platform", userId: admin.id, role: "PLATFORM_ADMIN", support: null };
  const user = userById(id);
  return { kind: "firm", userId: user.id, firmId: user.firmId, role: user.role };
}

/** The signed-in firm user (the actor of a firm mutation). A platform admin never acts as one (Q10). */
export function currentUser(): User {
  const id = requireSignedIn();
  if (platformUserById(id)) throw new ApiError("A platform admin can't act inside a firm.", "FORBIDDEN", 403);
  return userById(id);
}

/** The signed-in platform admin. */
export function currentPlatformUser(): PlatformUser {
  const admin = platformUserById(requireSignedIn());
  if (!admin) throw new ApiError("Platform admins only.", "FORBIDDEN", 403);
  return admin;
}

/** End the mock backend's session. */
export function signOut(): void {
  signedInId = null;
}

/** DEV ONLY: sign the mock backend in as a fixture firm user or platform admin. */
export function signInAs(userId: string): Principal {
  signedInId = platformUserById(userId)?.id ?? userById(userId).id;
  return currentPrincipal();
}
