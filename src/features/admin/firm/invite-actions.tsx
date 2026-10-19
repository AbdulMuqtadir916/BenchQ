"use client";

import { useState } from "react";
import { Send, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useResendInvite, useRevokeInvite } from "@/lib/hooks/use-platform";
import type { Invite } from "@/lib/schemas/tenancy";
import { AdminDialog, errorMessage } from "../admin-dialog";

/**
 * Resend an invite (A9: same row, new token, +7 days; Q24). Resending an *expired* firm invite takes
 * a seat again, so at the seat limit it is the §0 over-limit exception: visible, disabled, reason inline.
 */
export function ResendInviteButton({ invite, blockedReason }: { invite: Invite; blockedReason?: string | null }) {
  const resend = useResendInvite();
  const [isDone, setIsDone] = useState(false);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        variant="secondary"
        size="sm"
        disabled={Boolean(blockedReason) || resend.isPending}
        aria-describedby={blockedReason ? `resend-${invite.id}-reason` : undefined}
        onClick={() => resend.mutate(invite.id, { onSuccess: () => setIsDone(true) })}
      >
        <Send size={13} aria-hidden /> {resend.isPending ? "Resending…" : "Resend"}
      </Button>
      {blockedReason ? <span id={`resend-${invite.id}-reason`} className="text-caption text-[var(--color-warning-fg)]">{blockedReason}</span> : null}
      {resend.isError ? <span role="alert" className="text-caption text-[var(--color-danger-fg)]">{errorMessage(resend.error)}</span> : null}
      {isDone && !resend.isError ? <span role="status" className="text-caption text-[var(--color-success-fg)]">Sent. Expires in 7 days.</span> : null}
    </span>
  );
}

/** Revoke a pending invite (confirm; INVITE_REVOKED). */
export function RevokeInviteButton({ invite }: { invite: Invite }) {
  const revoke = useRevokeInvite();
  const [isOpen, setIsOpen] = useState(false);
  const close = () => {
    revoke.reset();
    setIsOpen(false);
  };
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setIsOpen(true)}>
        <XCircle size={13} aria-hidden /> Revoke
      </Button>
      {isOpen ? (
        <AdminDialog
          open
          onClose={close}
          title="Revoke this invite?"
          tone="danger"
          description={<p>The link sent to <strong>{invite.email}</strong> stops working. You can invite them again later.</p>}
          confirmLabel="Revoke invite"
          pendingLabel="Revoking…"
          isPending={revoke.isPending}
          error={errorMessage(revoke.error)}
          onConfirm={() => revoke.mutate(invite.id, { onSuccess: close })}
        />
      ) : null}
    </>
  );
}
