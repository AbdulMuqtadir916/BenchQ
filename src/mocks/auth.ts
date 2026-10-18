import { ApiError } from "@/lib/api/client";
import type { FirmPrincipal } from "@/lib/schemas/tenancy";
import type { Firm, User } from "@/lib/schemas/session";
import { allUsers, firms } from "./team";

/**
 * The mock backend's sign-in state: who the "server" thinks is signed in. A real backend reads this
 * from the session cookie; here the dev principal switcher sets it through the session adapter, so
 * mutations (status changes, uploads) are attributed to the right person. Platform sessions arrive in
 * Phase P.
 */
export const DEFAULT_USER_ID = "user_adnan";

/** null = signed out: every call that needs a user then fails with 401, as a real backend would. */
let signedInUserId: string | null = DEFAULT_USER_ID;

export function userById(userId: string): User {
  const user = allUsers.find((item) => item.id === userId);
  if (!user) throw new ApiError("That user can't sign in here.", "UNKNOWN_USER", 400);
  return user;
}

export function firmById(firmId: string): Firm {
  const firm = firms.find((item) => item.id === firmId);
  if (!firm) throw new ApiError(`Firm ${firmId} not found.`, "NOT_FOUND", 404);
  return firm;
}

export function isSignedIn(): boolean {
  return signedInUserId !== null;
}

export function currentUser(): User {
  if (signedInUserId === null) throw new ApiError("Sign in to continue.", "UNAUTHENTICATED", 401);
  return userById(signedInUserId);
}

export function currentPrincipal(): FirmPrincipal {
  const user = currentUser();
  return { kind: "firm", userId: user.id, firmId: user.firmId, role: user.role };
}

/** End the mock backend's session. */
export function signOut(): void {
  signedInUserId = null;
}

/** DEV ONLY: sign the mock backend in as a fixture firm user. */
export function signInAs(userId: string): FirmPrincipal {
  signedInUserId = userById(userId).id;
  return currentPrincipal();
}
