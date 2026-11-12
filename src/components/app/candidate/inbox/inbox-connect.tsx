"use client";

import { LoaderCircle, Lock, Mail } from "lucide-react";
import type { Candidate } from "@/lib/schemas/candidate";
import { useConnectMailbox } from "@/lib/hooks/use-inbox";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { GoogleLogo } from "@/components/brand/google-logo";
import { InfoTip } from "@/components/app/info-tip";

export function InboxConnect({ candidate, compact = false }: { candidate: Candidate; compact?: boolean }) {
  const connect = useConnectMailbox(candidate.id);
  const first = candidate.fullName.split(" ")[0] ?? "candidate";

  function startConnection() {
    const url = new URL(window.location.href);
    url.searchParams.delete("mailbox");
    url.searchParams.delete("mailbox_confirmation");
    url.searchParams.set("tab", "inbox");
    connect.mutate(`${url.pathname}${url.search}`, {
      onSuccess: (result) => { if (typeof result === "string") window.location.assign(result); },
    });
  }

  return (
    <Card className={compact ? "flex flex-wrap items-center justify-between gap-3 p-4" : "mx-auto max-w-xl p-6 text-center"}>
      <div className={compact ? "flex min-w-0 items-start gap-3" : "flex flex-col items-center"}>
        <span aria-hidden className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)]"><Mail size={18} /></span>
        <div className={compact ? "min-w-0" : "mt-3"}>
          <h2 className="text-body-strong text-[var(--color-text)]">Connect Gmail for {first}</h2>
          <p className="mt-1 text-sm text-[var(--color-text-3)]">
            Connect the Gmail account used to apply for {first}&apos;s jobs.
            <InfoTip label="About connecting this inbox" className="ml-1">
              Recruiter replies to {first}&apos;s applications come in here, so their statuses stay up to date. Use the same
              Gmail address {first}&apos;s applications are sent from.
            </InfoTip>
          </p>
        </div>
      </div>
      {connect.error ? <p role="alert" className="w-full text-sm text-[var(--color-danger-fg)]">{connect.error.message}</p> : null}
      <Button onClick={startConnection} disabled={connect.isPending} className={compact ? "shrink-0" : "mt-5 w-full"}>
        {connect.isPending ? <LoaderCircle size={15} className="animate-spin" aria-hidden /> : <span className="inline-flex h-5 w-5 items-center justify-center rounded-[var(--radius-sm)] bg-white"><GoogleLogo size={14} /></span>}
        {/* In its own element: page translation or an extension rewriting bare text crashes React (insertBefore) on the swap. */}
        <span>{connect.isPending ? "Opening Google…" : "Continue to Google"}</span>
      </Button>
      {!compact ? <p className="mt-3 flex items-center justify-center gap-1.5 text-caption text-[var(--color-text-3)]"><Lock size={12} aria-hidden />Read-only. Disconnect revokes Google access and stops sync. Saved mail remains until an Owner or Manager deletes it; the candidate can request deletion. Gmail originals are never deleted.</p> : null}
    </Card>
  );
}
