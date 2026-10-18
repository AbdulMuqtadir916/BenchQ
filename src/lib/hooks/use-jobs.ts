"use client";

import { useQuery } from "@tanstack/react-query";
import { jobsApi } from "@/lib/api/jobs";
import { queryKeys } from "@/lib/query/keys";
import { useFirmId } from "@/lib/stores/session-store";

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
