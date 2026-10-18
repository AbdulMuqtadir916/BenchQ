import type { UseQueryResult } from "@tanstack/react-query";

/**
 * The state of a card group on a multi-card page (docs/04 §13): the queries a group of cards reads,
 * folded into one status. An error wins over loading, so a failed query is never rendered as data
 * (a zero, an empty list) while a sibling query is still in flight.
 */
type GroupQuery = Pick<UseQueryResult<unknown, Error>, "isPending" | "isError" | "error" | "refetch">;

export type QueryGroup =
  | { status: "pending"; error: null; retry: () => void }
  | { status: "error"; error: Error; retry: () => void }
  | { status: "success"; error: null; retry: () => void };

export function queryGroup(...queries: GroupQuery[]): QueryGroup {
  const failed = queries.filter((query) => query.isError);
  // Retry refetches only what failed: the queries that loaded keep their data.
  const retry = () => {
    for (const query of failed.length > 0 ? failed : queries) void query.refetch();
  };
  const firstError = failed.find((query) => query.error)?.error;
  if (failed.length > 0) return { status: "error", error: firstError ?? new Error("The request failed."), retry };
  if (queries.some((query) => query.isPending)) return { status: "pending", error: null, retry };
  return { status: "success", error: null, retry };
}

/** Every query the page reads has failed: show one page-level error instead of an error per card. */
export function hasPageFailed(...queries: GroupQuery[]): boolean {
  return queries.length > 0 && queries.every((query) => query.isError);
}
