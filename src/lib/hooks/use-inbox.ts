"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { inboxApi } from "@/lib/api/inbox";
import type { CandidateInbox } from "@/lib/schemas/inbox";
import { queryKeys } from "@/lib/query/keys";
import { useFirmId } from "@/lib/stores/session-store";

export function useCandidateInbox(candidateId: string) {
  const firmId = useFirmId();
  return useQuery({ queryKey: queryKeys.inbox.byCandidate(firmId, candidateId), queryFn: () => inboxApi.byCandidate(firmId, candidateId), enabled: !!candidateId });
}

/** Simulated Google account hand-off + first sync. The result replaces the cached inbox. */
export function useConnectMailbox(candidateId: string) {
  const firmId = useFirmId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => inboxApi.connect(firmId, candidateId),
    onSuccess: (inbox) => queryClient.setQueryData(queryKeys.inbox.byCandidate(firmId, candidateId), inbox),
  });
}

export function useDisconnectMailbox(candidateId: string) {
  const firmId = useFirmId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => inboxApi.disconnect(firmId, candidateId),
    onSuccess: (inbox) => queryClient.setQueryData(queryKeys.inbox.byCandidate(firmId, candidateId), inbox),
  });
}

export function useMarkRead(candidateId: string) {
  const firmId = useFirmId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) => inboxApi.markRead(firmId, messageId),
    onMutate: (messageId) => {
      queryClient.setQueryData<CandidateInbox>(queryKeys.inbox.byCandidate(firmId, candidateId), (inbox) =>
        inbox ? { ...inbox, messages: inbox.messages.map((m) => (m.id === messageId ? { ...m, isRead: true } : m)) } : inbox,
      );
    },
  });
}
