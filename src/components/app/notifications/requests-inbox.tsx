"use client";

import { KeyRound } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/app/empty-state";
import { ErrorState } from "@/components/app/error-state";
import { SkeletonList } from "@/components/app/skeleton-list";
import { useNotifications } from "@/lib/hooks/use-notifications";
import { NotificationCard } from "./notification-card";

/** The Requests inbox: password-reset requests addressed to the signed-in approver, newest first (07 Q54). */
export function RequestsInbox() {
  const notifications = useNotifications();
  const requests = (notifications.data ?? []).filter((item) => item.type === "PASSWORD_RESET");

  return (
    <Card>
      {notifications.isPending ? (
        <SkeletonList rows={3} aria-label="Loading requests" />
      ) : notifications.isError ? (
        <ErrorState error={notifications.error} onRetry={() => void notifications.refetch()} />
      ) : requests.length === 0 ? (
        <EmptyState icon={KeyRound} title="No requests" description="Password reset requests from your team will appear here for you to approve or deny." />
      ) : (
        <div className="space-y-3">
          {requests.map((item) => <NotificationCard key={item.id} item={item} />)}
        </div>
      )}
    </Card>
  );
}
