"use client";

import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { tailoringApi } from "@/lib/api/tailoring";
import { queryKeys } from "@/lib/query/keys";
import type { StartTailoring, TailoringRun } from "@/lib/schemas/tailoring";
import { useFirmId } from "@/lib/tenancy/firm-context";

/** While one of the user's tailorings runs, how often they are read again (decided 2026-11-12, part 3 R2-Q4). */
export const TAILORING_POLL_MS = 3000;

/** Read again every 3 s while any runs; not at all otherwise (exported for its test). */
export const tailoringRefetch = (runs: TailoringRun[] | undefined): number | false =>
  runs?.some((run) => run.status === "running") ? TAILORING_POLL_MS : false;

/**
 * The signed-in user's own tailorings: running, or finished in the last 30 minutes (docs/02 §8.3; the panel and the
 * Tailor buttons). When one finishes, the résumés and the ledger are read again, so the new version shows.
 */
export function useMyTailorings({ isEnabled = true }: { isEnabled?: boolean } = {}) {
  const firmId = useFirmId();
  const queryClient = useQueryClient();
  const seen = useRef(new Map<string, TailoringRun["status"]>());
  const query = useQuery({
    queryKey: queryKeys.tailorings.mine(firmId),
    queryFn: () => tailoringApi.mine(firmId),
    enabled: isEnabled,
    refetchInterval: (current) => tailoringRefetch(current.state.data),
  });
  useEffect(() => {
    let hasFinished = false;
    for (const run of query.data ?? []) {
      if (seen.current.get(run.runId) === "running" && run.status !== "running") hasFinished = true;
      seen.current.set(run.runId, run.status);
    }
    if (hasFinished) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.resumes.all(firmId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.ledger.all(firmId) });
    }
  }, [query.data, queryClient, firmId]);
  return query;
}

/** Start a tailoring (the candidate's BDE only). The panel reads the new run at once. */
export function useStartTailoring() {
  const firmId = useFirmId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: StartTailoring) => tailoringApi.start(firmId, input),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: queryKeys.tailorings.mine(firmId) }),
  });
}
