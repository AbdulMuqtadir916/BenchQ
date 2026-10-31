"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Application } from "@/lib/schemas/application";
import type { Job } from "@/lib/schemas/job";
import { candidateFavoritesApi } from "@/lib/api/favorites";
import { queryKeys } from "@/lib/query/keys";
import { useFirmId } from "@/lib/tenancy/firm-context";

interface Variables {
  job: Job;
  on: boolean;
  applicationId?: string;
}

interface Previous {
  jobs: CandidateJobsData | undefined;
  applications: Application[] | undefined;
}

interface CandidateJobsData {
  jobs: Job[];
  favoriteJobIds: string[];
}

/** Toggle the candidate favorite and Saved application together with optimistic rollback. */
export function useToggleCandidateFavorite(candidateId: string) {
  const firmId = useFirmId();
  const queryClient = useQueryClient();
  const jobsKey = queryKeys.candidateJobs(firmId, candidateId);
  const applicationsKey = queryKeys.applications.byCandidate(firmId, candidateId);

  return useMutation<unknown, Error, Variables, Previous>({
    mutationFn: ({ job, on, applicationId }) => {
      if (on) return candidateFavoritesApi.save(candidateId, job);
      if (!applicationId) throw new Error("Saved application is missing; refresh and try again.");
      return candidateFavoritesApi.unfavorite(applicationId);
    },
    onMutate: async ({ job, on }) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: jobsKey }),
        queryClient.cancelQueries({ queryKey: applicationsKey }),
      ]);
      const beforeJobs = queryClient.getQueryData<CandidateJobsData>(jobsKey);
      const beforeApplications = queryClient.getQueryData<Application[]>(applicationsKey);
      const favoriteJobIds = new Set(beforeJobs?.favoriteJobIds ?? []);
      if (on) favoriteJobIds.add(job.id);
      else favoriteJobIds.delete(job.id);
      if (beforeJobs) queryClient.setQueryData(jobsKey, { ...beforeJobs, favoriteJobIds: [...favoriteJobIds] });

      if (on && beforeApplications && !beforeApplications.some((application) => application.jobId === job.id)) {
        const now = new Date().toISOString();
        const id = `pending_${job.id}`;
        const draft: Application = {
          id,
          firmId,
          candidateId,
          jobId: job.id,
          resumeVersionId: null,
          submittedByUserId: null,
          status: "SAVED", statusRevision: 0, pendingReviews: [],
          companyNameAtApply: job.company.name,
          jobTitleAtApply: job.title,
          appliedAt: null,
          firstResponseAt: null,
          interviewAt: null,
          offerAt: null,
          closedAt: null,
          expiresAt: null,
          coverLetterText: null,
          notes: null,
          events: [{ id: `${id}_saved`, applicationId: id, fromStatus: null, toStatus: "SAVED", note: null, actorUserId: null, isAutomated: false, createdAt: now }],
          createdAt: now,
        };
        queryClient.setQueryData(applicationsKey, [...beforeApplications, draft]);
      }
      if (!on && beforeApplications) {
        const application = beforeApplications.find((item) => item.jobId === job.id);
        const untouched = application?.status === "SAVED" && !application.notes && !application.resumeVersionId && application.events.length <= 1;
        if (untouched) queryClient.setQueryData(applicationsKey, beforeApplications.filter((item) => item.jobId !== job.id));
      }
      return { jobs: beforeJobs, applications: beforeApplications };
    },
    onError: (_error, _variables, previous) => {
      queryClient.setQueryData(jobsKey, previous?.jobs);
      queryClient.setQueryData(applicationsKey, previous?.applications);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: jobsKey });
      void queryClient.invalidateQueries({ queryKey: applicationsKey });
    },
  });
}
