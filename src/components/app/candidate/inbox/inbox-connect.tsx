"use client";

import { useSearchParams } from "next/navigation";
import { LoaderCircle, Lock, Mail } from "lucide-react";
import type { Candidate } from "@/lib/schemas/candidate";
import { useConnectMailbox } from "@/lib/hooks/use-inbox";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { GoogleLogo } from "@/components/brand/google-logo";

export function InboxConnect({ candidate, compact = false }: { candidate: Candidate; compact?: boolean }) {
  const connect = useConnectMailbox(candidate.id);
  const callbackResult = useSearchParams().get("mailbox");
  const callbackMessage = !callbackResult ? null : callbackResult === "connected"
    ? "Google account connected. Inbox sync will begin shortly."
    : "Google connection was not completed. You can try again.";
  const first = candidate.fullName.split(" ")[0] ?? "candidate";

  function startConnection() {
    const url = new URL(window.location.href);
    url.searchParams.delete("mailbox");
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
            Sign in to the Google account you want to use for this candidate and grant read-only access. The connected address will be shown in the Inbox. BenchQ never collects the password. We import the last 3 days.
          </p>
        </div>
      </div>
      {callbackMessage ? <p role="status" className="w-full text-sm text-[var(--color-text-2)]">{callbackMessage}</p> : null}
      {connect.error ? <p role="alert" className="w-full text-sm text-[var(--color-danger-fg)]">{connect.error.message}</p> : null}
      <Button onClick={startConnection} disabled={connect.isPending} className={compact ? "shrink-0" : "mt-5 w-full"}>
        {connect.isPending ? <LoaderCircle size={15} className="animate-spin" aria-hidden /> : <span className="inline-flex h-5 w-5 items-center justify-center rounded-[var(--radius-sm)] bg-white"><GoogleLogo size={14} /></span>}
        {connect.isPending ? "Opening Google…" : "Continue to Google"}
      </Button>
      {!compact ? <p className="mt-3 flex items-center justify-center gap-1.5 text-caption text-[var(--color-text-3)]"><Lock size={12} aria-hidden />Read-only. Disconnect stops future sync and keeps imported email in BenchQ.</p> : null}
    </Card>
  );
}
