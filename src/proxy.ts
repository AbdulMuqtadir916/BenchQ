import { NextResponse, type NextRequest } from "next/server";
import { devRoutesEnabled } from "@/lib/routes/registry";
import { SESSION_COOKIE, signedOutRedirect } from "@/lib/routes/proxy-access";
import { PATH_HEADER } from "@/lib/server/path-header";

/**
 * Next.js 16 middleware. Sends a signed-out visitor to sign-in before any page renders. UX, not security:
 * it only looks for the session cookie; the backend answers 401 on every endpoint (see proxy-access.ts).
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const target = signedOutRedirect(pathname, search, request.cookies.has(SESSION_COOKIE), {
    devRoutes: devRoutesEnabled(),
  });
  if (target) return NextResponse.redirect(new URL(target, request.url));
  // A layout can't see its own URL; the server gates (src/lib/server/principal.ts) read it from here.
  const headers = new Headers(request.headers);
  headers.set(PATH_HEADER, `${pathname}${search}`);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Pages only: not the API proxy, health, Next's own files, or anything with a file extension (icons, images).
  matcher: ["/((?!api/|health|_next/|.*\\..*).*)"],
};
