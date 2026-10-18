"use client";

import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/app/error-state";
import type { QueryGroup } from "@/lib/query/query-group";

/**
 * The body of a card (or of a row of cards) that reads a query group (docs/04 §13): the skeleton
 * while loading, an inline error with Retry if any of its queries failed, otherwise the content.
 * `children` is a function so the content (and every number in it) is only built from loaded data.
 */
export function GroupBody({ group, skeleton, children }: { group: QueryGroup; skeleton: ReactNode; children: () => ReactNode }) {
  if (group.status === "error") return <ErrorState error={group.error} onRetry={group.retry} />;
  if (group.status === "pending") return <>{skeleton}</>;
  return <>{children()}</>;
}

/** A row of stat cards that failed: one error card spanning the row, never four zeros. */
export function GroupRowError({ group }: { group: QueryGroup & { status: "error" } }) {
  return (
    <Card className="col-span-full p-0">
      <ErrorState error={group.error} onRetry={group.retry} />
    </Card>
  );
}
