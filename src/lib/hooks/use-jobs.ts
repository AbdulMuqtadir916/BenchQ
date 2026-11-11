"use client";

import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { jobsApi, type JobListParams } from "@/lib/api/jobs";
import { queryKeys } from "@/lib/query/keys";
import type { CaptureJob } from "@/lib/schemas/job";
import { useFirmId } from "@/lib/tenancy/firm-context";

/** While a search runs, how often its candidate's searches are read again (docs/02 §6.z). */
const SEARCH_POLL_MS = 3000;

export function useJobs(params?: JobListParams) {
  const firmId = useFirmId();
  return useQuery({
    queryKey: queryKeys.jobs.list(firmId, params ? { ...params } : undefined),
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

/** Capture a job for one candidate (docs/02 §6.z). The new job leads the lists; the usage and the ledger refresh. */
export function useCaptureJob() {
  const firmId = useFirmId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CaptureJob) => jobsApi.capture(firmId, body),
    onSuccess: (job) => {
      queryClient.setQueryData(queryKeys.jobs.detail(firmId, job.id), job);
      void queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all(firmId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.ledger.all(firmId) });
    },
  });
}

/**
 * A candidate's searches and today's usage. Read every 3 s while one runs; when it finishes, the job lists are read
 * again so its new jobs appear.
 */
export function useJobSearches(candidateId: string, enabled = true) {
  const firmId = useFirmId();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.jobs.searches(firmId, candidateId),
    queryFn: () => jobsApi.searches(firmId, candidateId),
    enabled: enabled && !!candidateId,
    refetchInterval: (current) => (current.state.data?.running ? SEARCH_POLL_MS : false),
  });
  const runningId = query.data?.running?.id ?? null;
  const wasRunning = useRef<string | null>(null);
  useEffect(() => {
    if (wasRunning.current && runningId !== wasRunning.current) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.jobs.lists(firmId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.ledger.all(firmId) });
    }
    wasRunning.current = runningId;
  }, [runningId, firmId, queryClient]);
  return query;
}

/** "Find jobs": start a search for the candidate (their BDE only). The searches are read again at once. */
export function useStartJobSearch(candidateId: string) {
  const firmId = useFirmId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (query: string) => jobsApi.startSearch(firmId, candidateId, query),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.jobs.searches(firmId, candidateId) }),
  });
}
