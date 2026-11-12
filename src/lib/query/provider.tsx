"use client";

import { Fragment, useEffect, useState, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useSession } from "@/lib/stores/session-store";
import { useCommitPendingSession, useSessionSync } from "@/lib/hooks/use-session";
import { useDemoDataSync } from "@/lib/hooks/use-demo-data";
import { clearCacheOnPrincipalChange, principalKey } from "./principal-boundary";
import { createQueryClient } from "./client";

/**
 * TanStack Query provider: one QueryClient per mount, made by `createQueryClient` (./client.ts), which holds the defaults
 * and refreshes Activity after any change.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(createQueryClient);

  // A change of principal clears the cache (synchronously, in the store update) and remounts the app
  // under the new principal, so every hook starts from the empty cache: nothing of the previous
  // person's data can render. See principal-boundary.ts.
  const principal = useSession((s) => principalKey(s.principal));
  useEffect(() => clearCacheOnPrincipalChange(client), [client]);
  useCommitPendingSession();
  useSessionSync();
  useDemoDataSync(client);

  return (
    <QueryClientProvider client={client}>
      <Fragment key={principal}>{children}</Fragment>
      {process.env.NODE_ENV === "development" ? (
        <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />
      ) : null}
    </QueryClientProvider>
  );
}
