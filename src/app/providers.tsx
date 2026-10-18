"use client";

import type { ReactNode } from "react";
import { QueryProvider } from "@/lib/query/provider";
import { ThemeProvider } from "@/components/theme/theme-provider";

/** Providers — client boundary for the whole app. */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <QueryProvider>{children}</QueryProvider>
    </ThemeProvider>
  );
}
