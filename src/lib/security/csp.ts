/**
 * The page Content-Security-Policy (production layer step 6, decided 2026-11-23). Pure, so the policy is a unit test;
 * `src/proxy.ts` builds it per request with a fresh nonce. Next reads the nonce back from this header and puts it on
 * its own scripts; `strict-dynamic` lets those scripts load the app's chunks.
 *
 * Every external origin is here because a screen needs it:
 * - img: company favicons (`www.google.com/s2/favicons`, which redirects to `*.gstatic.com`) and the Google mark
 *   (`www.gstatic.com`), see portal-logo.tsx and google-logo.tsx.
 * - frame: LinkedIn job postings in the source preview (source-preview.tsx), on www and regional hosts.
 * Styles stay `'unsafe-inline'`: computed `style` attributes and next-themes' transition guard need it.
 * No `upgrade-insecure-requests` (the app is also opened over plain http on a local network) and no report endpoint.
 */
export const CSP_HEADER = "Content-Security-Policy";
export const CSP_REPORT_ONLY_HEADER = "Content-Security-Policy-Report-Only";
/** The request header the root layout reads the nonce from (for next-themes' inline script). */
export const NONCE_HEADER = "x-nonce";

export function buildCsp({ nonce, isDev }: { nonce: string; isDev: boolean }): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // Development only: React's dev build and webpack's HMR evaluate code.
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(isDev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "https://www.google.com", "https://*.gstatic.com"],
    "font-src": ["'self'", "data:"],
    // Development only: the HMR websocket.
    "connect-src": ["'self'", ...(isDev ? ["ws:"] : [])],
    "frame-src": ["https://linkedin.com", "https://*.linkedin.com"],
    "frame-ancestors": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "object-src": ["'none'"],
    "manifest-src": ["'self'"],
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");
}

/** The header the policy goes out under: enforced, or report-only when `CSP_REPORT_ONLY=true` (server env, read per request). */
export function cspHeaderName(reportOnly: string | undefined): string {
  return reportOnly === "true" ? CSP_REPORT_ONLY_HEADER : CSP_HEADER;
}

/** A fresh nonce: base64 of a random UUID (122 random bits). */
export function newNonce(): string {
  return btoa(crypto.randomUUID());
}
