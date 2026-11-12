"use client";

import { useRef } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { inboxApi } from "@/lib/api/inbox";
import type { ReviewEmailCommand } from "@/lib/schemas/inbox";
import { queryKeys } from "@/lib/query/keys";
import { useFirmId } from "@/lib/tenancy/firm-context";
import { newCommandId } from "@/lib/utils";

/** Pending BDE reviews for one candidate, newest first, a page at a time. */
export function useEmailReviews(candidateId: string) {
  const firmId = useFirmId();
  return useInfiniteQuery({
    queryKey: queryKeys.inbox.reviews(firmId, candidateId),
    queryFn: ({ pageParam }) => inboxApi.reviews(firmId, candidateId, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: !!candidateId,
  });
}

/**
 * Submit one human decision on a review. The same decision (same payload) reuses its command id, so a retry after a
 * network error can never apply twice; a different decision gets a new id. Afterwards the reviews, the inbox and
 * the applications are reloaded, because a confirmed status moves the card.
 */
export function useReviewEmail(candidateId: string) {
  const firmId = useFirmId();
  const queryClient = useQueryClient();
  const last = useRef<{ payload: string; id: string } | null>(null);
  return useMutation({
    mutationFn: ({ messageId, command }: { messageId: string; command: ReviewEmailCommand }) => {
      const payload = JSON.stringify({ messageId, command });
      if (last.current?.payload !== payload) last.current = { payload, id: newCommandId() };
      return inboxApi.review(firmId, candidateId, messageId, command, last.current.id);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.inbox.reviews(firmId, candidateId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.inbox.byCandidate(firmId, candidateId) });
      // The opened email is cached separately; refresh it so its link and status show at once.
      void queryClient.invalidateQueries({ queryKey: queryKeys.inbox.body(firmId, candidateId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.applications.all(firmId) });
    },
  });
}

/** Open a review for an email marked Irrelevant; the reviews are reloaded so its review panel can open. */
export function useOpenEmailReview(candidateId: string) {
  const firmId = useFirmId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) => inboxApi.openReview(firmId, candidateId, messageId),
    // A linked email's application gains a pending review: its badge reloads with the review list.
    onSuccess: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.inbox.reviews(firmId, candidateId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.applications.all(firmId) }),
    ]),
  });
}

/** Put a failed email back in the classification queue; refreshes the inbox and the opened email. */
export function useRetryClassification(candidateId: string) {
  const firmId = useFirmId();
  const queryClient = useQueryClient();
  // The same retry (same email and revisions) reuses its command id, so a retry after a lost response is recognised.
  const last = useRef<{ payload: string; id: string } | null>(null);
  return useMutation({
    mutationFn: ({ messageId, contentRevision, resultVersion }: { messageId: string; contentRevision: number; resultVersion: number }) => {
      const payload = JSON.stringify({ messageId, contentRevision, resultVersion });
      if (last.current?.payload !== payload) last.current = { payload, id: newCommandId() };
      return inboxApi.retryClassification(firmId, candidateId, messageId, { contentRevision, resultVersion }, last.current.id);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.inbox.byCandidate(firmId, candidateId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.inbox.body(firmId, candidateId) });
    },
  });
}
