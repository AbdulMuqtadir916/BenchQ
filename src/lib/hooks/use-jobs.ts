"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { jobsApi } from "@/lib/api/jobs";
import { queryKeys } from "@/lib/query/keys";
import type { CaptureJob } from "@/lib/schemas/job";
import { useFirmId } from "@/lib/tenancy/firm-context";

export function useJobs(params?: { limit?: number; offset?: number }) {
  const firmId = useFirmId();
  return useQuery({
    queryKey: queryKeys.jobs.list(firmId, params),
    queryFn: () => jobsApi.list(firmId, params),
  });
}

export function useJob(id: string) {
  const firmId = useFirmId();
  return useQuery({
    queryKey: queryKeys.jobs.detail(firmId, id),
    queryFn: () => jobsApi.byId(firmId, id),
    enabled: !!id,
  });
}

/** Capture a job (docs/04 §5.2). The new job leads the lists; the ledger gets its CREATE. */
export function useCaptureJob() {
  const firmId = useFirmId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CaptureJob) => jobsApi.capture(firmId, body),
    onSuccess: (job) => {
      queryClient.setQueryData(queryKeys.jobs.detail(firmId, job.id), job);
      void queryClient.invalidateQueries({ queryKey: queryKeys.jobs.lists(firmId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.ledger.all(firmId) });
    },
  });
}
