import { NextResponse, type NextRequest } from "next/server";
import { isLive } from "@/lib/api/config";
import { devRoutesEnabled } from "@/lib/routes/registry";
import { SESSION_COOKIE, signedOutRedirect } from "@/lib/routes/proxy-access";

/**
 * Next.js 16 middleware. Sends a signed-out visitor to sign-in before any page renders. UX, not security:
 * it only looks for the session cookie; the backend answers 401 on every endpoint (see proxy-access.ts).
 * Runs only when the session is live (NEXT_PUBLIC_LIVE_MODULES has `session`); F6 ticket #65 removes that condition.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const target = signedOutRedirect(pathname, search, request.cookies.has(SESSION_COOKIE), {
    live: isLive("session"),
    devRoutes: devRoutesEnabled(),
  });
  return target ? NextResponse.redirect(new URL(target, request.url)) : NextResponse.next();
}

export const config = {
  // Pages only: not the API proxy, health, Next's own files, or anything with a file extension (icons, images).
  matcher: ["/((?!api/|health|_next/|.*\\..*).*)"],
};
