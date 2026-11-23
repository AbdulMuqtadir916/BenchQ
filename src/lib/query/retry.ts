import { ApiError } from "@/lib/api/client";

/**
 * When a failed query is tried again (docs/02 §12.2 rule 7; docs/team/uzair.md step 4b, decision 5). Mutations are
 * never retried (provider.tsx): a write, an AI job above all, must not run twice.
 */

/** Tries after the first failure: network errors and 5xx only. */
const MAX_RETRIES = 2;
/** The longest `Retry-After` a query waits for (agreed 2026-11-20). A longer ask is not retried at all (Uzair,
 * 2026-11-21): the error card shows at once, with its Retry button, instead of a skeleton that waits or a retry that
 * comes too early. */
export const RETRY_AFTER_CAP_MS = 10_000;

/**
 * Never a 4xx: it won't change by asking again (a 404, a 403), or asking again spends more of a budget the backend
 * says is used up (a 429). Never SCHEMA_MISMATCH (a schema drift bug: the page needs a refresh) or NOT_AVAILABLE (a
 * module with no live adapter yet), and never an error whose `Retry-After` asks for more than `RETRY_AFTER_CAP_MS`.
 * Network errors and 5xx: up to twice. An error that isn't an ApiError (a bug or a mock's plain Error) keeps the old
 * rule, up to twice.
 */
export function shouldRetryQuery(failureCount: number, error: Error): boolean {
  if (error instanceof ApiError) {
    if (error.code === "SCHEMA_MISMATCH" || error.code === "NOT_AVAILABLE") return false;
    if (error.status >= 400 && error.status < 500) return false;
    if (error.retryAfterMs !== null && error.retryAfterMs > RETRY_AFTER_CAP_MS) return false;
  }
  return failureCount < MAX_RETRIES;
}

/** TanStack Query's own default: 1 s, 2 s, 4 s … up to 30 s. */
const defaultDelay = (failureCount: number) => Math.min(1000 * 2 ** failureCount, 30_000);

/** How long before the next try: what `Retry-After` asked, else TanStack's default backoff. The cap only guards a
 * caller that retries without asking `shouldRetryQuery`: a longer ask is never retried. */
export function retryDelay(failureCount: number, error: Error): number {
  if (error instanceof ApiError && error.retryAfterMs !== null) return Math.min(error.retryAfterMs, RETRY_AFTER_CAP_MS);
  return defaultDelay(failureCount);
}
