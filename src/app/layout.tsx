import type { Metadata } from "next";
import { Providers } from "./providers";
import { RouteTitle } from "@/components/routes/route-title";
import "@fontsource-variable/host-grotesk";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";

// No `title` here: <RouteTitle> sets it per route from the registry.
export const metadata: Metadata = {
  description:
    "AI placement platform for US-focused IT staffing firms. Every claim traceable to verified evidence.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <RouteTitle />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
