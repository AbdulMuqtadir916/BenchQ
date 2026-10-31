import { ApiError } from "@/lib/api/client";

/**
 * Whether a failed query is tried again. Never for SCHEMA_MISMATCH (a schema drift bug), a 404 (it won't change) or
 * RATE_LIMITED (a 429: trying again at once only spends more of the budget the backend says is used up); up to twice
 * for anything else, a blip on the network.
 */
export function shouldRetryQuery(failureCount: number, error: Error): boolean {
  if (error instanceof ApiError && (error.code === "SCHEMA_MISMATCH" || error.code === "RATE_LIMITED" || error.status === 404)) {
    return false;
  }
  return failureCount < 2;
}
