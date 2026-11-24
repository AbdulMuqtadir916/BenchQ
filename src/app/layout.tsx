import type { Metadata } from "next";
import { headers } from "next/headers";
import { Providers } from "./providers";
import { RouteTitle } from "@/components/routes/route-title";
import { NavigationTrail } from "@/components/routes/navigation-trail";
import { NONCE_HEADER } from "@/lib/security/csp";
import "@fontsource-variable/host-grotesk";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";

// No `title` here: <RouteTitle> sets it per route from the registry.
export const metadata: Metadata = {
  description:
    "AI placement platform for US-focused IT staffing firms.",
};

/**
 * Reading the request headers makes every page render per request, which the CSP nonce needs: a static page would
 * carry one build-time nonce, or none (src/proxy.ts, src/lib/security/csp.ts). scripts/check-csp.mjs checks it.
 */
export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const nonce = (await headers()).get(NONCE_HEADER) ?? undefined;
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <RouteTitle />
        <NavigationTrail />
        <Providers nonce={nonce}>{children}</Providers>
      </body>
    </html>
  );
}
