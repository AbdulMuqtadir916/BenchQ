import type { FirmSession } from "@/lib/schemas/session";
import { hrefFor, landingFor } from "./registry";

/** Where a signed-in firm user lands (docs/07 §2.1, T7): their own firm's landing route. */
export function landingHref(session: FirmSession): string {
  const route = landingFor(session.principal.role, { isFirstRun: session.user.lastActiveAt === null });
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
