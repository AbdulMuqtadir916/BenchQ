import type { Session } from "@/lib/schemas/session";
import { accessFor, hrefFor, landingFor, matchRoute } from "./registry";

/** Where a signed-in principal lands (docs/07 §2.1, T7): a firm user in their own firm, a platform admin at /admin. */
export function landingHref(session: Session): string {
  if (!("user" in session)) return hrefFor(landingFor(session.principal));
  const route = landingFor(session.principal, { isFirstRun: session.user.lastActiveAt === null });
  return hrefFor(route, { firm: session.firm.slug });
}

/**
 * docs/07 §2.1: `?returnTo=` is honoured only for a same-origin path. Anything else (another origin,
 * `//host`, a backslash trick, the sign-in page itself) is dropped, and sign-in goes to the landing.
 */
export function safeReturnTo(value: string | null | undefined): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  const base = "http://benchq.invalid";
  let url: URL;
  try {
    url = new URL(value, base);
  } catch {
    return null;
  }
  if (url.origin !== base || url.pathname === hrefFor("sign-in")) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Where a sign-in goes (docs/07 §2.1): back to `returnTo` when the account just signed in can open it,
 * otherwise its own landing. `returnTo` is the page the previous visitor was on; after a sign-out on
 * a shared screen the next person may be from another firm, or not an admin, and must not land on a
 * not-found. A firm page counts only in the principal's own firm; an admin page only for a platform
 * admin; an unregistered path never.
 */
export function signInTarget(session: Session, returnTo: string | null): string {
  const landing = landingHref(session);
  if (!returnTo) return landing;
  const route = matchRoute(returnTo);
  if (!route || accessFor(route, session.principal) === "none") return landing;
  if (route.area === "firm") {
    const slug = returnTo.split(/[?#]/)[0]!.split("/")[1];
    if (!session.firm || session.firm.slug !== slug) return landing;
  }
  return returnTo;
}
