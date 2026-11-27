import type { NextConfig } from "next";

/**
 * Security headers for every page (production layer step 6, decided 2026-11-23). The Content-Security-Policy is not
 * here: it carries a per-request nonce, so src/proxy.ts sets it. `clipboard-write` stays allowed for the copy buttons.
 * No Strict-Transport-Security: the deployment's Caddy proxy sets it for app.benchq.io (Abdul, 2026-11-24), and a
 * second copy from here would double it.
 */
const PAGE_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()" },
];

/** Every path but the two rewritten to the backend below (/api and /health), whose headers are the backend's. */
const PAGE_HEADERS_SOURCE = "/((?!api(?:/|$)|health$).*)";

const nextConfig: NextConfig = {
  // No `X-Powered-By: Next.js`.
  poweredByHeader: false,
  // Hide the Next.js "N" indicator so it doesn't sit on the design preview.
  // Compile/runtime error overlays still appear.
  devIndicators: false,
  // lucide-react exports hundreds of icons; rewrite named imports so only the ones used are bundled.
  experimental: {
    optimizePackageImports: ["lucide-react"],
    // forbidden() and forbidden.tsx: a real 403 for a route the principal may not open (docs/07 Phase D).
    authInterrupts: true,
    // How long the /api rewrite below waits for the backend (Next's default is 30 s). The résumé parse may take 80 s
    // an attempt and 4 attempts (docs/team/resume-versioning.md §2.1), about 5.5 minutes at worst, so 6 minutes.
    // Changed in Uzair's area (docs/team/cross-area-changes.md).
    proxyTimeout: 360_000,
  },
  // Proxy the FastAPI backend so browser requests stay same-origin (no CORS,
  // and the backend's HTTP-only session cookie is sent automatically).
  async rewrites() {
    // In development the backend defaults to the local compose one (src/lib/server/backend-url.ts).
    const backend = process.env.BACKEND_URL || (process.env.NODE_ENV === "production" ? undefined : "http://localhost:8000");
    if (!backend) return [];
    return [
      { source: "/api/:path*", destination: `${backend}/api/:path*` },
      { source: "/health", destination: `${backend}/health` },
    ];
  },
  async headers() {
    return [{ source: PAGE_HEADERS_SOURCE, headers: PAGE_HEADERS }];
  },
};

export default nextConfig;
