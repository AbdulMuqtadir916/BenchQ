"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { notificationsApi, type NotificationItem } from "@/lib/api/password-recovery";

const REQUEST_STATUS_LABELS: Record<string, string> = {
  PENDING: "Awaiting approval",
  APPROVED: "Approved",
  DENIED: "Denied",
  EXPIRED: "Expired",
  COMPLETED: "Password reset complete",
  CANCELLED: "Cancelled",
};

export function NotificationsInbox() {
  const [error, setError] = useState("");
  const [link, setLink] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const notifications = useQuery({ queryKey: ["notifications", "inbox"], queryFn: notificationsApi.list, refetchOnWindowFocus: true });
  const items = notifications.data?.items ?? [];
  const visibleError = error;
  async function decide(item: NotificationItem, approve: boolean) {
    setBusy(item.id); setError(""); setLink(""); setCopyStatus("");
    try {
      const result = await notificationsApi.decide(item.id, approve);
      setLink(result.resetLink ?? ""); await notifications.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't update this request.");
      await notifications.refetch();
    }
    finally { setBusy(null); }
  }
  async function reissue(item: NotificationItem) {
    setBusy(item.id); setError(""); setCopyStatus("");
    try {
      const result = await notificationsApi.reissue(item.id);
      setLink(result.resetLink);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create a reset link.");
      await notifications.refetch();
    }
    finally { setBusy(null); }
  }
  async function copyResetLink() {
    setCopyStatus("");
    try {
      await navigator.clipboard.writeText(link);
      setCopyStatus("Copied. Share the full link with the requester.");
    } catch {
      setCopyStatus("Automatic copy was blocked. Click the link field, press Ctrl+A, then Ctrl+C to copy the full link.");
    }
  }
  return <Card><div className="space-y-4">
    {visibleError && <p role="alert" className="text-sm text-[var(--color-danger-fg)]">{visibleError}</p>}
    {link && <div className="rounded-lg border border-[var(--color-border)] p-4"><p className="text-sm font-medium">Approved reset link</p><p className="mt-1 text-caption">Copy and share this link with the requester manually. It expires in 30 minutes and can be used once.</p><Input readOnly value={link} className="bq-input mt-2" onFocus={e => e.currentTarget.select()} /><Button type="button" className="bq-secondary mt-2" onClick={() => void copyResetLink()}>Copy link</Button>{copyStatus && <p role="status" className="mt-2 text-caption text-[var(--color-text-2)]">{copyStatus}</p>}</div>}
    {notifications.isLoading ? <p className="py-6 text-center text-sm text-[var(--color-text-3)]">Loading notifications…</p> : notifications.error ? <div className="py-6 text-center"><p className="text-sm text-[var(--color-text-2)]">Couldn&apos;t load notifications.</p><Button type="button" className="bq-secondary mt-3" onClick={() => void notifications.refetch()}>Try again</Button></div> : items.length === 0 ? <p className="py-6 text-center text-sm text-[var(--color-text-3)]">You&apos;re all caught up.</p> : items.map(item => {
      const isPending = item.type === "PASSWORD_RESET" && item.requestStatus === "PENDING";
      return <article key={item.id} className={cn("rounded-lg border border-[var(--color-border)] p-4", isPending && "border-[var(--color-primary)] bg-[var(--color-primary-subtle)]/45")}><div className="flex items-start justify-between gap-4"><div><h3 className="text-sm font-medium">{item.title}</h3><p className="mt-1 text-sm text-[var(--color-text-2)]">{item.detail}</p><time className="mt-2 block text-caption text-[var(--color-text-3)]">{new Date(item.createdAt).toLocaleString()}</time></div><div className="flex shrink-0 items-center gap-2">{item.type === "PASSWORD_RESET" && item.requestStatus && <span className="text-caption text-[var(--color-text-2)]">{REQUEST_STATUS_LABELS[item.requestStatus] ?? item.requestStatus}</span>}{item.readAt ? null : <span className="text-caption text-[var(--color-primary)]">New</span>}</div></div>
      <div className="mt-3 flex flex-wrap gap-2">{item.type === "PASSWORD_RESET" && !item.resolvedAt && <><Button disabled={busy === item.id} className="bq-primary" onClick={() => decide(item, true)}>Approve</Button><Button disabled={busy === item.id} className="bq-secondary" onClick={() => decide(item, false)}>Deny</Button></>}</div>
      {item.type === "PASSWORD_RESET" && item.canReissue && item.resolvedAt && <Button className="bq-secondary mt-3" disabled={busy === item.id} onClick={() => reissue(item)}>Create fresh link</Button>}
    </article>;
    })}
  </div></Card>;
}
