"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { jobMarksApi } from "@/lib/api/job-marks";
import { queryKeys } from "@/lib/query/keys";
import type { JobMark, JobMarkKind } from "@/lib/schemas/job";
import { useFirmId } from "@/lib/tenancy/firm-context";

/** The signed-in person's saved and hidden jobs (docs/02 §6.x), as id sets. */
export function useJobMarks() {
  const firmId = useFirmId();
  const query = useQuery({ queryKey: queryKeys.jobMarks.mine(firmId), queryFn: () => jobMarksApi.list(firmId) });
  const marks = query.data ?? [];
  const ids = (kind: JobMarkKind) => new Set(marks.filter((mark) => mark.kind === kind).map((mark) => mark.jobId));
  return { query, savedIds: ids("SAVED"), hiddenIds: ids("HIDDEN") };
}

/**
 * Set or clear one mark. Optimistic: the heart fills (or the job hides) at once, and rolls back if the
 * server refuses.
 */
export function useToggleJobMark() {
  const firmId = useFirmId();
  const queryClient = useQueryClient();
  const key = queryKeys.jobMarks.mine(firmId);
  return useMutation<unknown, Error, { jobId: string; kind: JobMarkKind; on: boolean }, { before: JobMark[] | undefined }>({
    mutationFn: ({ jobId, kind, on }) =>
      on ? jobMarksApi.mark(firmId, jobId, kind) : jobMarksApi.unmark(firmId, jobId, kind),
    onMutate: async ({ jobId, kind, on }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const before = queryClient.getQueryData<JobMark[]>(key);
      const rest = (before ?? []).filter((mark) => !(mark.jobId === jobId && mark.kind === kind));
      const optimistic: JobMark = { id: `pending_${jobId}_${kind}`, firmId, userId: "", jobId, kind, createdAt: new Date().toISOString() };
      queryClient.setQueryData<JobMark[]>(key, on ? [...rest, optimistic] : rest);
      return { before };
    },
    onError: (_error, _vars, context) => queryClient.setQueryData(key, context?.before),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: key }),
  });
}
