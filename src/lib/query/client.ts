import { MutationCache, QueryClient, type QueryKey } from "@tanstack/react-query";
import { shouldRetryQuery } from "./retry";

/**
 * Whether a cache key is Activity data: a firm's activity log (`[firmId, "ledger", …]`, its people, candidates and days)
 * or the Super Admin's (`["platform", "activity", …]`). See queryKeys.ledger and queryKeys.platform.activity.
 */
export function isActivityKey(key: QueryKey): boolean {
  return key[1] === "ledger" || (key[0] === "platform" && key[1] === "activity");
}

/**
 * The app's one QueryClient: defaults for a data-dense console (never retry SCHEMA_MISMATCH, a 404 or a 429; a short
 * staleTime so switching roles refetches; no refetch on window focus because the BDE will alt-tab constantly).
 *
 * Any change a person makes can write an Activity entry (a status move, an edit, an assignment, a résumé), so after any
 * mutation succeeds the Activity data is marked stale: the screen that is open refetches at once, and one that opens
 * later reads the server instead of what was cached before the change. Without this, Activity shows the log as it was
 * until the cache expires or the page is reloaded.
 */
export function createQueryClient(): QueryClient {
  const client: QueryClient = new QueryClient({
    mutationCache: new MutationCache({
      onSuccess: () => {
        void client.invalidateQueries({ predicate: (query) => isActivityKey(query.queryKey) });
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: shouldRetryQuery,
      },
      mutations: {
        retry: false,
      },
    },
  });
  return client;
}
