"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { inboxApi } from "@/lib/api/inbox";
import type { CandidateInbox } from "@/lib/schemas/inbox";
import { queryKeys } from "@/lib/query/keys";
import { useFirmId } from "@/lib/tenancy/firm-context";

export function useCandidateInbox(candidateId: string) {
  const firmId = useFirmId();
  return useQuery({ queryKey: queryKeys.inbox.byCandidate(firmId, candidateId), queryFn: () => inboxApi.byCandidate(firmId, candidateId), enabled: !!candidateId,
    refetchInterval: (query) => ["QUEUED", "IMPORTING"].includes(query.state.data?.connection?.syncState ?? "") ? 2_000 : query.state.data?.connection?.status === "CONNECTED" ? 300_000 : false });
}

/** Google hosts consent; mock mode replaces the cached inbox without navigation. */
export function useConnectMailbox(candidateId: string) {
  const firmId = useFirmId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (returnTo: string) => inboxApi.connect(firmId, candidateId, returnTo),
    onSuccess: (inbox) => { if (typeof inbox !== "string") queryClient.setQueryData(queryKeys.inbox.byCandidate(firmId, candidateId), inbox); },
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
    mutationFn: (messageId: string) => inboxApi.markRead(firmId, candidateId, messageId),
    onMutate: async (messageId) => {
      const key = queryKeys.inbox.byCandidate(firmId, candidateId);
      await queryClient.cancelQueries({ queryKey: key });
      const wasRead = queryClient.getQueryData<CandidateInbox>(key)?.messages.find((m) => m.id === messageId)?.isRead;
      queryClient.setQueryData<CandidateInbox>(key, (inbox) => inbox ? { ...inbox,
        messages: inbox.messages.map((m) => m.id === messageId ? { ...m, isRead: true } : m) } : inbox);
      return { wasRead };
    },
    onError: (_error, messageId, context) => {
      if (context?.wasRead === undefined) return;
      queryClient.setQueryData<CandidateInbox>(queryKeys.inbox.byCandidate(firmId, candidateId), (inbox) => inbox ? {
        ...inbox, messages: inbox.messages.map((m) => m.id === messageId ? { ...m, isRead: context.wasRead! } : m),
      } : inbox);
    },
  });
}

export function useSyncMailbox(candidateId: string) {
  const firmId = useFirmId();
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: () => inboxApi.sync(firmId, candidateId), onSuccess: (inbox) => {
    queryClient.setQueryData(queryKeys.inbox.byCandidate(firmId, candidateId), inbox);
    void queryClient.invalidateQueries({ queryKey: queryKeys.ledger.all(firmId) });
  } });
}


export function useMailboxConfirmation(candidateId: string, attempt: string | null) {
  const firm = useFirmId();
  const cache = useQueryClient();
  const details = useQuery({queryKey: queryKeys.inbox.confirmation(firm, candidateId, attempt), enabled: !!attempt,
    queryFn: () => inboxApi.confirmation(firm, candidateId, attempt!)});
  const confirm = useMutation({mutationFn: () => inboxApi.confirm(firm, candidateId, attempt!),
    onSuccess: data => cache.setQueryData(queryKeys.inbox.byCandidate(firm, candidateId), data)});
  return {details, confirm};
}

export function useInboxBody(candidateId: string, messageId: string | null) {
  const firm = useFirmId();
  return useQuery({queryKey: queryKeys.inbox.body(firm, candidateId, messageId), enabled: !!messageId,
    queryFn: async () => (await inboxApi.byCandidate(firm, candidateId, messageId!)).messages.find(m => m.id === messageId)});
}

export function useDeleteInboxContent(candidateId: string) {
  const firm = useFirmId();
  const cache = useQueryClient();
  return useMutation({mutationFn: (message?: string) => inboxApi.deleteContent(firm, candidateId, message),
    onSuccess: data => {cache.setQueryData(queryKeys.inbox.byCandidate(firm, candidateId), data);
      void cache.invalidateQueries({queryKey: queryKeys.inbox.body(firm, candidateId)});
      void cache.invalidateQueries({queryKey: queryKeys.ledger.all(firm)});}});
}

export function useMoreInbox(candidateId: string) {
  const firm = useFirmId();
  const cache = useQueryClient();
  return useMutation({mutationFn: (offset: number) => inboxApi.byCandidate(firm, candidateId, undefined, offset),
    onSuccess: data => cache.setQueryData<CandidateInbox>(queryKeys.inbox.byCandidate(firm, candidateId), old =>
      old ? {...data, messages: [...new Map([...old.messages, ...data.messages].map(m => [m.id, m])).values()]} : data)});
}
