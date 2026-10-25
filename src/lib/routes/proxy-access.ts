import { hrefFor, matchRoute } from "./registry";

/**
 * The signed-out redirect's decision (docs/integration/07-auth-and-tenancy.md F6, 07 Phase D). `src/proxy.ts`
 * only reads the request and calls this, so the rule is testable without Next.
 *
 * This is UX, not security: it checks that the session cookie is *there*, never that the backend still
 * knows it. A stale cookie gets through to the page, and the backend's 401 does the real refusing.
 */

/** The backend's session cookie (backend/auth/sessions.py `COOKIE_NAME`). HttpOnly, so only the server sees it. */
export const SESSION_COOKIE = "bq_session";

export interface SignedOutOptions {
  /** `isLive("session")`: the cookie only exists when the backend owns the session. On mocks it is `localStorage`. */
  live: boolean;
  /** `devRoutesEnabled()`: `/dev/*` stays open only where it is served. */
  devRoutes: boolean;
}

/**
 * Where a request without a session goes, or null to let it through. A route is open when the registry
 * says it is public; a path the registry doesn't know is *not* open, so a signed-out visitor can't tell
 * a missing firm or page from a real one (07 §1: never confirm existence).
 */
export function signedOutRedirect(pathname: string, search: string, hasSession: boolean, options: SignedOutOptions): string | null {
  if (!options.live || hasSession) return null;
  const route = matchRoute(pathname);
  if (route?.area === "public") return null;
  if (route?.area === "dev" && options.devRoutes) return null;
  return hrefFor("sign-in", {}, { returnTo: `${pathname}${search}` });
}
