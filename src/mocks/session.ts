import { ApiError } from "@/lib/api/client";
import { FirmSchema, FirmSessionSchema, PlatformSessionSchema, type Firm, type FirmSession, type Session } from "@/lib/schemas/session";
import { currentPlatformUser, currentPrincipal, currentUser, firmById, isSignedIn, signInWithPassword, signOut, watchSession } from "./auth";
import { firms } from "./team";
import { markActive } from "./invites";
import { requireAction } from "./membership";
import { endSupportViewOnSignOut, exitSupportView, settleExpiredSupportViews, startSupportView } from "./support";
import { mockResult, wait } from "./_shared";

function firmSessionNow(): FirmSession {
  const user = currentUser();
  const principal = { kind: "firm" as const, userId: user.id, firmId: user.firmId, role: user.role };
  return FirmSessionSchema.parse({ principal, user, firm: firmById(user.firmId) });
}

/** The signed-in principal's session: a firm user's, or a platform admin's (with the support-view firm, if one is open). */
export function sessionNow(): Session {
  const principal = currentPrincipal();
  if (principal.kind === "platform") {
    const firm = principal.support ? firmById(principal.support.firmId) : null;
    return PlatformSessionSchema.parse({ principal, platformUser: currentPlatformUser(), firm });
  }
  return firmSessionNow();
}

/**
 * The firm a URL slug names, for the firm layout (docs/07 §2.5). Only the signed-in user's own firm
 * resolves: an unknown slug and another firm's slug are the same 404, so a URL never confirms that a
 * firm exists (principle 4).
 */
function firmBySlug(slug: string): Firm {
  const principal = currentPrincipal();
  const firm = firms.find((item) => item.slug === slug);
  if (!firm) throw new ApiError("Not found.", "NOT_FOUND", 404);
  // A platform admin knows every firm (it's their job in /admin); reading its data still needs a support view (P4).
  if (principal.kind === "platform") return FirmSchema.parse(firm);
  if (firm.id !== principal.firmId) throw new ApiError("Not found.", "NOT_FOUND", 404);
  return FirmSchema.parse(firm);
}

export const sessionMock = {
  /** Who is signed in, or null when signed out. */
  current: async (): Promise<Session | null> => {
    settleExpiredSupportViews();
    return mockResult(isSignedIn() ? sessionNow() : null);
  },

  /** Start a read-only support view of a firm (07 §4): PLATFORM_ADMIN only; ends any open one first. */
  startSupportView: async (firmId: string, reason: string): Promise<Session> => {
    await wait();
    requireAction("firm.viewWorkspace");
    startSupportView(firmId, reason);
    return structuredClone(sessionNow());
  },

  /** End the open support view: the session, and the firm to go back to (/admin/firms/[firmId]). */
  exitSupportView: async (): Promise<{ session: Session; firmId: string | null }> => {
    await wait();
    const firmId = exitSupportView();
    return structuredClone({ session: sessionNow(), firmId });
  },

  firmBySlug: async (slug: string): Promise<Firm> => {
    await wait();
    return structuredClone(firmBySlug(slug));
  },

  /** The signed-in user finished (or skipped) /welcome: they are active from now on (docs/07 T7). */
  finishFirstRun: (): Promise<FirmSession> => {
    markActive(currentUser().id);
    return mockResult(firmSessionNow());
  },

  /**
   * Sign in with email + password (docs/07 L1). Any failure — unknown email, wrong password, a
   * deactivated account — is the same 401 "Email or password is incorrect."
   */
  signIn: async (email: string, password: string): Promise<Session> => {
    await wait();
    signInWithPassword(email, password);
    return structuredClone(sessionNow());
  },

  signOut: async (): Promise<null> => {
    const principal = isSignedIn() ? currentPrincipal() : null;
    if (principal?.kind === "platform") endSupportViewOnSignOut(principal.userId);
    signOut();
    return mockResult(null);
  },

  /** Another tab signed in, out or as someone else (Q27): `onChange` runs; ask `current()` again. */
  watch: (onChange: () => void): (() => void) => watchSession(onChange),
};
