import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, signedOutRedirect } from "@/lib/routes/proxy-access";
import { PATH_HEADER } from "@/lib/server/path-header";
import { CSP_HEADER, CSP_REPORT_ONLY_HEADER, NONCE_HEADER, buildCsp, cspHeaderName, newNonce } from "@/lib/security/csp";

/**
 * Next.js 16 middleware. Sends a signed-out visitor to sign-in before any page renders. UX, not security:
 * it only looks for the session cookie; the backend answers 401 on every endpoint (see proxy-access.ts).
 *
 * It also sets the page's Content-Security-Policy with a fresh nonce (src/lib/security/csp.ts). The policy goes on
 * the request as well, because that is where Next reads the nonce for its own scripts; `x-nonce` carries it to the
 * root layout. `CSP_REPORT_ONLY=true` in the server's environment sends it as Report-Only, without a rebuild.
 * Prefetches run through here like any request: they need PATH_HEADER and the signed-out redirect too.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const target = signedOutRedirect(pathname, search, request.cookies.has(SESSION_COOKIE));
  if (target) return NextResponse.redirect(new URL(target, request.url));

  const nonce = newNonce();
  const csp = buildCsp({ nonce, isDev: process.env.NODE_ENV === "development" });
  const cspHeader = cspHeaderName(process.env.CSP_REPORT_ONLY);

  const headers = new Headers(request.headers);
  // A layout can't see its own URL; the server gates (src/lib/server/principal.ts) read it from here.
  headers.set(PATH_HEADER, `${pathname}${search}`);
  // Next reads the nonce from the enforced header first: drop whatever the browser sent under either name.
  headers.delete(CSP_HEADER);
  headers.delete(CSP_REPORT_ONLY_HEADER);
  headers.set(cspHeader, csp);
  headers.set(NONCE_HEADER, nonce);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set(cspHeader, csp);
  return response;
}

export const config = {
  // Pages only: not the API proxy (/api and /api/…), /health, Next's own files, or anything with a file extension.
  // Exact names only: a firm slug such as `healthcare-staffing` or `apiary` is a page and needs the redirect, the
  // gates' path and the CSP.
  matcher: ["/((?!api(?:/|$)|health$|_next/|.*\\..*).*)"],
};
