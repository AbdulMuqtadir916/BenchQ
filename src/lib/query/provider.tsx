"use client";

import { Fragment, useEffect, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { ApiError } from "@/lib/api/client";
import { useSession } from "@/lib/stores/session-store";
import { useCommitPendingSession, useSessionSync } from "@/lib/hooks/use-session";
import { useDemoDataSync } from "@/lib/hooks/use-demo-data";
import { clearCacheOnPrincipalChange, principalKey } from "./principal-boundary";

/**
 * TanStack Query provider — one QueryClient per mount, sensible defaults for
 * a data-dense console: never retry SCHEMA_MISMATCH (a schema drift bug) or a 404 (it won't change),
 * short-ish staleTime so switching roles refetches, no refetch on window focus
 * because the BDE will alt-tab constantly.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: false,
            retry: (failureCount, error) => {
              if (error instanceof ApiError && (error.code === "SCHEMA_MISMATCH" || error.status === 404)) {
                return false;
              }
              return failureCount < 2;
            },
          },
          mutations: {
            retry: false,
          },
        },
      }),
  );

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
