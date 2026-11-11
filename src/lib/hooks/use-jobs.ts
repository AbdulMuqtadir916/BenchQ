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

/** The longest a timer may wait (setTimeout's limit is ~24.8 days; an hour is plenty for the 6:30 PM reset). */
const MAX_WAIT_MS = 60 * 60 * 1000;

/**
 * A candidate's searches and today's usage. Read every 3 s while one runs, and while a search this tab started hasn't
 * been read back finished: a fast search can end before the first read sees it running (bot review on #135). When it
 * ends, the job lists are read again. Idle, it is read again just after the day resets (6:30 PM IST), so a limit
 * reached today lifts without a reload.
 */
export function useJobSearches(candidateId: string, enabled = true) {
  const firmId = useFirmId();
  const queryClient = useQueryClient();
  const started = useQuery<string | null>({
    queryKey: queryKeys.jobs.startedSearch(firmId, candidateId),
    queryFn: () => null,
    enabled: false,
    initialData: null,
    staleTime: Infinity,
  }).data;
  const query = useQuery({
    queryKey: queryKeys.jobs.searches(firmId, candidateId),
    queryFn: () => jobsApi.searches(firmId, candidateId),
    enabled: enabled && !!candidateId,
    refetchInterval: (current) => {
      const data = current.state.data;
      if (data?.running || (started && !data?.searches.some((search) => search.id === started))) return SEARCH_POLL_MS;
      if (!data) return false;
      return Math.min(Math.max(new Date(data.usage.resetsAt).getTime() - Date.now() + 2000, 1000), MAX_WAIT_MS);
    },
  });
  const runningId = query.data?.running?.id ?? null;
  const startedDone = Boolean(started && query.data?.searches.some((search) => search.id === started));
  const wasRunning = useRef<string | null>(null);
  useEffect(() => {
    if ((wasRunning.current && runningId !== wasRunning.current) || startedDone) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.jobs.lists(firmId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.ledger.all(firmId) });
      if (startedDone) queryClient.setQueryData(queryKeys.jobs.startedSearch(firmId, candidateId), null);
    }
    wasRunning.current = runningId;
  }, [runningId, startedDone, firmId, candidateId, queryClient]);
  return query;
}

/** "Find jobs": start a search for the candidate (their BDE only). The searches are read again at once, and the search
 * is remembered until its outcome is read. */
export function useStartJobSearch(candidateId: string) {
  const firmId = useFirmId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (query: string) => jobsApi.startSearch(firmId, candidateId, query),
    onSuccess: (batchId) => queryClient.setQueryData(queryKeys.jobs.startedSearch(firmId, candidateId), batchId),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.jobs.searches(firmId, candidateId) }),
  });
}
