"use client";

import type { ReactNode } from "react";
import { QueryProvider } from "@/lib/query/provider";
import { ThemeProvider } from "@/components/theme/theme-provider";

/** Providers — client boundary for the whole app. `nonce` is the request's CSP nonce, for next-themes' inline script. */
export function Providers({ children, nonce }: { children: ReactNode; nonce?: string }) {
  return (
    <ThemeProvider nonce={nonce}>
      <QueryProvider>{children}</QueryProvider>
    </ThemeProvider>
  );
}
