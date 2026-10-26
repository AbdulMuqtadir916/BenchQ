import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hide the Next.js "N" indicator so it doesn't sit on the design preview.
  // Compile/runtime error overlays still appear.
  devIndicators: false,
  // lucide-react exports hundreds of icons; rewrite named imports so only the ones used are bundled.
  experimental: {
    optimizePackageImports: ["lucide-react"],
    // forbidden() and forbidden.tsx: a real 403 for a route the principal may not open (docs/07 Phase D).
    authInterrupts: true,
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
};

export default nextConfig;
