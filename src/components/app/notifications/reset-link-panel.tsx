"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RESET_LINK_LIFETIME_MS } from "@/lib/hooks/use-notifications";
import { useNow } from "@/lib/hooks/use-now";

const clock = (date: Date) => date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/**
 * The approved one-use reset link, shown once to the approver who created it (07 Q54). It is held only in this
 * page's memory: a reload loses it, and "Create fresh link" makes a new one that replaces it.
 */
export function ResetLinkPanel({ link, createdAt }: { link: string; createdAt: Date }) {
  const now = useNow(15_000);
  const [copyStatus, setCopyStatus] = useState("");
  const expiresAt = new Date(createdAt.getTime() + RESET_LINK_LIFETIME_MS);
  const isExpired = now >= expiresAt;

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopyStatus("Copied. Share the full link with the requester.");
    } catch {
      setCopyStatus("Your browser blocked copying. Select the link, then press Ctrl+C.");
    }
  }

  if (isExpired) {
    return (
      <div className="mt-3 rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
        <p className="text-sm font-medium text-[var(--color-text)]">This link has expired</p>
        <p className="mt-1 text-caption text-[var(--color-text-3)]">
          It was created at {clock(createdAt)} and stopped working at {clock(expiresAt)}. Create a fresh link to share a new one.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
      <p className="text-sm font-medium text-[var(--color-text)]">Reset link</p>
      <p className="mt-1 text-caption text-[var(--color-text-2)]">
        This link expires 30 minutes after it was created: created at {clock(createdAt)}, expires at {clock(expiresAt)}. It
        works once. BenchQ doesn&apos;t email it, so share it with the requester yourself.
      </p>
      <Input readOnly aria-label="Reset link" value={link} className="bq-input mt-2" onFocus={(e) => e.currentTarget.select()} />
      <Button type="button" className="bq-secondary mt-2" onClick={() => void copy()}>Copy link</Button>
      {copyStatus ? <p role="status" className="mt-2 text-caption text-[var(--color-text-2)]">{copyStatus}</p> : null}
    </div>
  );
}
