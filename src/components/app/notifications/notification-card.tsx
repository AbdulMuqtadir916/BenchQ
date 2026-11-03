"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { NotificationItem } from "@/lib/api/password-recovery";
import { isPendingRequest, useDecidePasswordReset, useReissueResetLink } from "@/lib/hooks/use-notifications";
import { ResetLinkPanel } from "./reset-link-panel";

const REQUEST_STATUS_LABELS: Record<string, string> = {
  PENDING: "Awaiting your approval",
  APPROVED: "Approved",
  DENIED: "Denied",
  EXPIRED: "Expired",
  COMPLETED: "Password reset complete",
  CANCELLED: "Cancelled",
};

/** One notification. A password-reset request carries its own approve / deny / fresh-link actions. */
export function NotificationCard({ item }: { item: NotificationItem }) {
  const decide = useDecidePasswordReset();
  const reissue = useReissueResetLink();
  const [shared, setShared] = useState<{ link: string; createdAt: Date } | null>(null);
  const [error, setError] = useState("");
  const isReset = item.type === "PASSWORD_RESET";
  const isPending = isPendingRequest(item);
  const isBusy = decide.isPending || reissue.isPending;

  function onDecide(approve: boolean) {
    setError("");
    decide.mutate({ id: item.id, approve }, {
      onSuccess: (result) => setShared(result.resetLink ? { link: result.resetLink, createdAt: new Date() } : null),
      onError: (e) => setError(e instanceof Error ? e.message : "Couldn't update this request."),
    });
  }

  function onReissue() {
    setError("");
    reissue.mutate(item.id, {
      onSuccess: (result) => setShared({ link: result.resetLink, createdAt: new Date() }),
      onError: (e) => setError(e instanceof Error ? e.message : "Couldn't create a reset link."),
    });
  }

  return (
    <article className={cn("rounded-[var(--radius-md)] border border-[var(--color-border)] p-4", isPending && "border-[var(--color-primary)] bg-[var(--color-primary-subtle)]/45")}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-[var(--color-text)]">{item.title}</h3>
          <p className="mt-1 text-sm text-[var(--color-text-2)]">{item.detail}</p>
          <time dateTime={item.createdAt} className="mt-2 block text-caption text-[var(--color-text-3)]">{new Date(item.createdAt).toLocaleString()}</time>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isReset && item.requestStatus ? <span className="text-caption text-[var(--color-text-2)]">{REQUEST_STATUS_LABELS[item.requestStatus] ?? item.requestStatus}</span> : null}
          {item.readAt ? null : <span className="text-caption text-[var(--color-primary)]">New</span>}
        </div>
      </div>
      {isReset && !item.resolvedAt ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" disabled={isBusy} className="bq-primary" onClick={() => onDecide(true)}>Approve</Button>
          <Button type="button" disabled={isBusy} className="bq-secondary" onClick={() => onDecide(false)}>Deny</Button>
        </div>
      ) : null}
      {shared ? <ResetLinkPanel key={shared.link} link={shared.link} createdAt={shared.createdAt} /> : null}
      {isReset && item.canReissue && item.resolvedAt ? (
        <Button type="button" className="bq-secondary mt-3" disabled={isBusy} onClick={onReissue}>Create fresh link</Button>
      ) : null}
      {error ? <p role="alert" className="mt-2 text-sm text-[var(--color-danger-fg)]">{error}</p> : null}
    </article>
  );
}
