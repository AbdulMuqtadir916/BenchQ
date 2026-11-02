"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notificationsApi, type NotificationItem } from "@/lib/api/password-recovery";
import { queryKeys } from "@/lib/query/keys";
import { useSignedInPrincipal } from "@/lib/stores/session-store";

/** How long an approved reset link works after it is created (07 Q54; `LINK_LIFETIME` in the backend). */
export const RESET_LINK_LIFETIME_MS = 30 * 60 * 1000;

/** A password-reset request still waiting for this approver's decision. */
export const isPendingRequest = (item: NotificationItem) => item.type === "PASSWORD_RESET" && item.requestStatus === "PENDING";

function useNotificationsKey() {
  const principal = useSignedInPrincipal();
  return principal.kind === "firm" ? queryKeys.notifications.mine(principal.firmId) : queryKeys.platform.notifications();
}

/**
 * The signed-in person's notifications. A support view has none of its own, so it doesn't ask. Refetched once a
 * minute while the tab is visible, so a new request reaches the approver's bell without a reload.
 */
export function useNotifications() {
  const principal = useSignedInPrincipal();
  return useQuery({
    queryKey: useNotificationsKey(),
    queryFn: notificationsApi.list,
    select: (data) => data.items,
    enabled: principal.kind === "firm" || principal.support === null,
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  const queryKey = useNotificationsKey();
  return useMutation({
    mutationFn: notificationsApi.markRead,
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });
}

/** Approve or deny; an approval returns the one-use link, shown only to this approver. */
export function useDecidePasswordReset() {
  const queryClient = useQueryClient();
  const queryKey = useNotificationsKey();
  return useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) => notificationsApi.decide(id, approve),
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });
}

/** A fresh link for an approved request; it replaces the previous one. */
export function useReissueResetLink() {
  const queryClient = useQueryClient();
  const queryKey = useNotificationsKey();
  return useMutation({
    mutationFn: notificationsApi.reissue,
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });
}
