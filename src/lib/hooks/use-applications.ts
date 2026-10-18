"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { applicationsApi, followupsApi } from "@/lib/api/applications";
import type { Application } from "@/lib/schemas/application";
import type { ApplicationStatus } from "@/lib/schemas/enums";
import { queryKeys } from "@/lib/query/keys";
import { useFirmId } from "@/lib/stores/session-store";

export function useApplications(candidateId?: string) {
  const firmId = useFirmId();
  return useQuery({
    queryKey: queryKeys.applications.list(firmId, { candidateId }),
    queryFn: () => applicationsApi.list(firmId, candidateId ? { candidateId } : undefined),
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
    mutationFn: ({ id, status, note }: { id: string; status: ApplicationStatus; note: string | null }) =>
      applicationsApi.updateStatus(firmId, id, { status, note }),
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries(lists);
      const previous = queryClient.getQueriesData<Application[]>(lists);
      queryClient.setQueriesData<Application[]>(lists, (list) => list?.map((a) => (a.id === id ? { ...a, status } : a)));
      return { previous };
    },
    onError: (_error, _vars, context) => context?.previous.forEach(([queryKey, data]) => queryClient.setQueryData(queryKey, data)),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.applications.all(firmId) });
    },
  });
}
