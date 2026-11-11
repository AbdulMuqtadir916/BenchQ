"use client";

import { useMutation, useQuery, useQueryClient, type Query, type QueryClient } from "@tanstack/react-query";
import { jobsApi, type JobListParams } from "@/lib/api/jobs";
import { queryKeys } from "@/lib/query/keys";
import type { CaptureJob } from "@/lib/schemas/job";
import type { JobSearches } from "@/lib/schemas/job-search";
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
 * A candidate's searches and today's usage, as query options (exported for its tests). Read every 3 s while one runs,
 * and while a search this tab started hasn't been read back finished: a fast search can end before the first read
 * sees it running (bot review on #135). When a search ends, the job lists and the ledger are read again. Idle, it is
 * read again just after the day resets (6:30 PM IST), so a limit reached today lifts without a reload; a tab in the
 * background then misses that timer, so coming back to it reads again once the reset has passed (Abdul on #135).
 */
export function jobSearchesQuery(queryClient: QueryClient, firmId: string, candidateId: string) {
  const startedKey = queryKeys.jobs.startedSearch(firmId, candidateId);
  const isPastReset = (data: JobSearches | undefined) => Boolean(data && Date.now() >= new Date(data.usage.resetsAt).getTime());
  return {
    queryKey: queryKeys.jobs.searches(firmId, candidateId),
    queryFn: async (): Promise<JobSearches> => {
      const before = queryClient.getQueryData<JobSearches>(queryKeys.jobs.searches(firmId, candidateId));
      const data = await jobsApi.searches(firmId, candidateId);
      const started = queryClient.getQueryData<string | null>(startedKey);
      const isStartedDone = Boolean(started && data.searches.some((search) => search.id === started));
      const isRunEnded = Boolean(before?.running && before.running.id !== data.running?.id);
      if (isStartedDone || isRunEnded) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.jobs.lists(firmId) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.ledger.all(firmId) });
        if (isStartedDone) queryClient.setQueryData(startedKey, null);
      }
      return data;
    },
    refetchInterval: (query: Query<JobSearches, Error, JobSearches, readonly unknown[]>) => {
      const data = query.state.data;
      const started = queryClient.getQueryData<string | null>(startedKey);
      if (data?.running || (started && !data?.searches.some((search) => search.id === started))) return SEARCH_POLL_MS;
      if (!data) return false;
      return Math.min(Math.max(new Date(data.usage.resetsAt).getTime() - Date.now() + 2000, 1000), MAX_WAIT_MS);
    },
    // The app reads nothing again on focus (the BDE alt-tabs all night); this query does, only once the reset passed.
    refetchOnWindowFocus: (query: Query<JobSearches, Error, JobSearches, readonly unknown[]>) => (isPastReset(query.state.data) ? ("always" as const) : false),
  };
}

export function useJobSearches(candidateId: string, enabled = true) {
  const firmId = useFirmId();
  const queryClient = useQueryClient();
  // Observed so the started search's id stays cached (not garbage-collected) while the page is open.
  useQuery<string | null>({ queryKey: queryKeys.jobs.startedSearch(firmId, candidateId), queryFn: () => null, enabled: false, initialData: null, staleTime: Infinity });
  return useQuery({ ...jobSearchesQuery(queryClient, firmId, candidateId), enabled: enabled && !!candidateId });
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
