"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { applicationsApi, followupsApi } from "@/lib/api/applications";
import type { Application } from "@/lib/schemas/application";
import type { ApplicationStatus } from "@/lib/schemas/enums";
import { queryKeys } from "@/lib/query/keys";
import { useFirmId } from "@/lib/tenancy/firm-context";

export function useApplications(candidateId?: string) {
  const firmId = useFirmId();
  return useQuery({
    queryKey: queryKeys.applications.list(firmId, { candidateId }),
    queryFn: () => applicationsApi.list(firmId, candidateId ? { candidateId } : undefined),
  });
}

/** Live candidate-scoped applications for the Jobs → favorite → Saved slice. */
export function useCandidateApplications(candidateId: string) {
  const firmId = useFirmId();
  return useQuery({
    queryKey: queryKeys.applications.byCandidate(firmId, candidateId),
    queryFn: () => applicationsApi.listForCandidate(firmId, candidateId),
    enabled: !!candidateId,
  });
}

/** Live, candidate-scoped Saved ↔ Applied mutation used by the candidate board. */
export function useMoveCandidateApplicationStatus(candidateId: string) {
  const firmId = useFirmId();
  const queryClient = useQueryClient();
  const applicationsKey = queryKeys.applications.byCandidate(firmId, candidateId);
  const jobsKey = queryKeys.candidateJobs(firmId, candidateId);
  type JobsData = { jobs: Array<{ id: string }>; favoriteJobIds: string[] };

  return useMutation({
    mutationFn: ({ id, status, expectedRevision, commandId }: { id: string; status: ApplicationStatus; expectedRevision: number; commandId: string }) =>
      applicationsApi.moveCandidateStatus(firmId, candidateId, id, status, expectedRevision, commandId),
    onMutate: async ({ id, status }) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: applicationsKey }),
        queryClient.cancelQueries({ queryKey: jobsKey }),
      ]);
      const previousApplications = queryClient.getQueryData<Application[]>(applicationsKey);
      const previousJobs = queryClient.getQueryData<JobsData>(jobsKey);
      const app = previousApplications?.find((item) => item.id === id);
      if (previousApplications) {
        queryClient.setQueryData<Application[]>(applicationsKey, previousApplications.map((item) => item.id === id
          ? { ...item, status, appliedAt: status === "SAVED" ? null : item.appliedAt ?? (status === "APPLIED" ? new Date().toISOString() : null) }
          : item));
      }
      if (previousJobs && app) {
        const favoriteIds = new Set(previousJobs.favoriteJobIds);
        if (status !== "SAVED") favoriteIds.delete(app.jobId);
        else favoriteIds.add(app.jobId);
        queryClient.setQueryData<JobsData>(jobsKey, {
          ...previousJobs,
          jobs: status !== "SAVED" ? previousJobs.jobs.filter((job) => job.id !== app.jobId) : previousJobs.jobs,
          favoriteJobIds: [...favoriteIds],
        });
      }
      return { previousApplications, previousJobs };
    },
    onSuccess: (application) => {
      queryClient.setQueryData<Application[]>(applicationsKey, (items) => items?.map((item) => item.id === application.id ? application : item));
    },
    onError: (_error, _variables, context) => {
      if (context?.previousApplications) queryClient.setQueryData(applicationsKey, context.previousApplications);
      if (context?.previousJobs) queryClient.setQueryData(jobsKey, context.previousJobs);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.applications.all(firmId) });
      void queryClient.invalidateQueries({ queryKey: jobsKey });
    },
  });
}

export function useApplication(id: string) {
  const firmId = useFirmId();
  return useQuery({
    queryKey: queryKeys.applications.detail(firmId, id),
    queryFn: () => applicationsApi.byId(firmId, id),
    enabled: !!id,
  });
}

export function useFollowups(userId?: string) {
  const firmId = useFirmId();
  return useQuery({
    queryKey: queryKeys.followups.list(firmId, { userId }),
    queryFn: () => followupsApi.list(firmId, userId ? { userId } : undefined),
  });
}

/**
 * Move an application to a new stage. Optimistic: every cached application
 * list of this firm updates at once (board, list, inbox suggestions), then refetches.
 */
export function useUpdateApplicationStatus() {
  const firmId = useFirmId();
  const queryClient = useQueryClient();
  const lists = { queryKey: queryKeys.applications.lists(firmId) };
  return useMutation({
    mutationFn: ({ id, status, note, expectedRevision, commandId }: { id: string; status: ApplicationStatus; note: string | null; expectedRevision: number; commandId: string }) =>
      applicationsApi.updateStatus(firmId, id, { status, note }, expectedRevision, commandId),
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries(lists);
      const previous = queryClient.getQueriesData<Application[]>(lists);
      queryClient.setQueriesData<Application[]>(lists, (list) => list?.map((a) => (a.id === id ? { ...a, status } : a)));
      return { previous };
    },
    onError: (_error, _vars, context) => context?.previous.forEach(([queryKey, data]) => queryClient.setQueryData(queryKey, data)),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.applications.all(firmId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all(firmId) });
    },
  });
}
