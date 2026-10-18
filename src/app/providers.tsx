"use client";

import type { ReactNode } from "react";
import { QueryProvider } from "@/lib/query/provider";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { DevSessionRestore } from "@/components/dev/dev-session-restore";

/** Providers — client boundary for the whole app. */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <QueryProvider>
        {process.env.NODE_ENV === "development" ? <DevSessionRestore /> : null}
        {children}
      </QueryProvider>
    </ThemeProvider>
  );
}
