"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { inboxApi } from "@/lib/api/inbox";
import type { CandidateInbox } from "@/lib/schemas/inbox";
import { queryKeys } from "@/lib/query/keys";
import { useFirmId } from "@/lib/tenancy/firm-context";

export function useUnmatchedInboxReviews() {
  const firmId = useFirmId();
  return useQuery({ queryKey: queryKeys.inbox.unmatchedReviews(firmId), queryFn: () => inboxApi.unmatchedReviews(firmId) });
}

export function useCandidateInbox(candidateId: string, messageId?: string | null) {
  const firmId = useFirmId();
  const queryClient = useQueryClient();
  const key = queryKeys.inbox.byCandidate(firmId, candidateId);
  const query = useQuery({
    queryKey: key,
    queryFn: () => inboxApi.byCandidate(firmId, candidateId), enabled: !!candidateId,
    refetchInterval: (current) => current.state.data?.messages.some((message) =>
      message.classificationState === "PENDING" || message.classificationState === "PROCESSING") ? 2_000 : false,
  });
  const hasSelected = !messageId || query.data?.messages.some((message) => message.id === messageId);
  const selectedQuery = useQuery({
    queryKey: queryKeys.inbox.message(firmId, candidateId, messageId ?? ""),
    queryFn: () => inboxApi.byCandidate(firmId, candidateId, messageId),
    enabled: !!candidateId && !!messageId && query.isSuccess && !hasSelected,
    refetchInterval: (current) => current.state.data?.messages.some((message) =>
      message.id === messageId && (message.classificationState === "PENDING" || message.classificationState === "PROCESSING")) ? 2_000 : false,
  });
  const data = useMemo(() => {
    if (!query.data || hasSelected || !selectedQuery.data) return query.data;
    const selected = selectedQuery.data.messages.find((message) => message.id === messageId);
    return selected ? { ...query.data, messages: [...query.data.messages, selected] } : query.data;
  }, [query.data, hasSelected, selectedQuery.data, messageId]);
  const decisions = (query.data?.messages ?? []).map((message) =>
    `${message.id}:${message.applicationId}:${message.classificationState}:${message.classificationOutcome}`).sort().join("|");
  const previousSelected = useRef<{ scope: string; decisions: Map<string, string> }>({ scope: "", decisions: new Map() });
  const previous = useRef<{ scope: string; decisions: string } | null>(null);
  useEffect(() => {
    if (!query.data) return;
    const scope = `${firmId}:${candidateId}`;
    const before = previous.current;
    previous.current = { scope, decisions };
    if (before?.scope === scope && before.decisions === decisions) return;
    // Check persisted decisions on entry as well: application data may have been
    // cached before classification finished. Selection/read state does not enter
    // this fingerprint and cannot trigger another refresh.
    const old = new Set(before?.scope === scope ? before.decisions.split("|") : []);
    const changed = decisions.split("|").some((decision) => decision.includes(":DONE:") && !decision.endsWith(":null") && !old.has(decision));
    if (!changed) return;
    void queryClient.invalidateQueries({ queryKey: queryKeys.applications.all(firmId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.candidateJobs(firmId, candidateId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.inbox.unmatchedReviews(firmId) });
  }, [candidateId, decisions, firmId, query.data, queryClient]);
  useEffect(() => {
    const message = selectedQuery.data?.messages.find((item) => item.id === messageId);
    if (!message) return;
    const scope = `${firmId}:${candidateId}`;
    if (previousSelected.current.scope !== scope) previousSelected.current = { scope, decisions: new Map() };
    const next = `${message.classificationState}:${message.classificationOutcome}:${message.applicationId}`;
    const before = previousSelected.current.decisions.get(message.id);
    previousSelected.current.decisions.set(message.id, next);
    if (!before || before === next || message.classificationState !== "DONE") return;
    void queryClient.invalidateQueries({ queryKey: queryKeys.applications.all(firmId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.candidateJobs(firmId, candidateId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.inbox.unmatchedReviews(firmId) });
  }, [selectedQuery.data, messageId, firmId, candidateId, queryClient]);
  return { ...query, data, selectionError: hasSelected ? null : selectedQuery.error,
    isLoadingSelection: !hasSelected && selectedQuery.isPending,
    retrySelection: selectedQuery.refetch };

}

/** Starts Google-hosted OAuth; the browser leaves BenchQ for the candidate account's consent page. */
export function useConnectMailbox(candidateId: string) {
  const firmId = useFirmId();
  return useMutation({
    mutationFn: (returnTo: string) => inboxApi.connect(firmId, candidateId, returnTo),
  });
}

export function useDisconnectMailbox(candidateId: string) {
  const firmId = useFirmId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => inboxApi.disconnect(firmId, candidateId),
    onSuccess: (inbox) => {
      queryClient.setQueryData(queryKeys.inbox.byCandidate(firmId, candidateId), inbox);
      void queryClient.invalidateQueries({ queryKey: queryKeys.ledger.all(firmId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.inbox.byCandidate(firmId, candidateId) });
    },
  });
}

export function useSyncMailbox(candidateId: string) {
  const firmId = useFirmId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => inboxApi.sync(firmId, candidateId),
    onSuccess: (inbox) => {
      queryClient.setQueryData(queryKeys.inbox.byCandidate(firmId, candidateId), inbox);
      void queryClient.invalidateQueries({ queryKey: queryKeys.ledger.all(firmId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.inbox.byCandidate(firmId, candidateId) });
    },
  });
}

export function useMarkRead(candidateId: string) {
  const firmId = useFirmId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) => inboxApi.markRead(firmId, candidateId, messageId),
    onMutate: async (messageId) => {
      const prefix = queryKeys.inbox.byCandidate(firmId, candidateId);
      await queryClient.cancelQueries({ queryKey: prefix });
      const snapshots = queryClient.getQueriesData<CandidateInbox>({ queryKey: prefix });
      queryClient.setQueriesData<CandidateInbox>({ queryKey: prefix }, (inbox) =>
        inbox ? { ...inbox, messages: inbox.messages.map((m) => (m.id === messageId ? { ...m, isRead: true } : m)) } : inbox,
      );
      return { snapshots };
    },
    onError: (_error, messageId, context) => {
      for (const [key, snapshot] of context?.snapshots ?? []) {
        const wasRead = snapshot?.messages.find((message) => message.id === messageId)?.isRead;
        if (wasRead === undefined) continue;
        queryClient.setQueryData<CandidateInbox>(key, (inbox) => inbox ? { ...inbox,
          messages: inbox.messages.map((message) => message.id === messageId ? { ...message, isRead: wasRead } : message),
        } : inbox);
      }
    },
    onSuccess: (message) => {
      queryClient.setQueriesData<CandidateInbox>({ queryKey: queryKeys.inbox.byCandidate(firmId, candidateId) }, (inbox) =>
        inbox ? { ...inbox, messages: inbox.messages.map((m) => m.id === message.id ? { ...m, isRead: message.isRead } : m) } : inbox);
      void queryClient.invalidateQueries({ queryKey: queryKeys.ledger.all(firmId) });
    },
  });
}

export function useReviewInboxMessage(candidateId: string) {
  const firmId = useFirmId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { messageId: string; applicationId: string; status: string; expectedRevision: number; reviewId?: string; expectedReviewRevision?: number }) =>
      inboxApi.reviewMessage(firmId, candidateId, input.messageId, {
        application_id: input.applicationId, status: input.status.toLowerCase(), expected_revision: input.expectedRevision,
        review_id: input.reviewId, expected_review_revision: input.expectedReviewRevision,
      }),
    onSuccess: (inbox) => {
      queryClient.setQueryData(queryKeys.inbox.byCandidate(firmId, candidateId), inbox);
      void queryClient.invalidateQueries({ queryKey: queryKeys.ledger.all(firmId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.inbox.byCandidate(firmId, candidateId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.applications.all(firmId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.candidateJobs(firmId, candidateId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.inbox.unmatchedReviews(firmId) });
    },
  });
}

export function useRetryInboxClassification(candidateId: string) {
  const firmId = useFirmId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) => inboxApi.retryClassification(firmId, candidateId, messageId),
    onSuccess: (inbox) => {
      queryClient.setQueryData(queryKeys.inbox.byCandidate(firmId, candidateId), inbox);
      void queryClient.invalidateQueries({ queryKey: queryKeys.ledger.all(firmId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.inbox.byCandidate(firmId, candidateId) });
    },
  });
}
