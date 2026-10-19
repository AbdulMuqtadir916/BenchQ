"use client";

import { useCan } from "@/lib/auth/permissions";
import { useState } from "react";
import { Link2, Send, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useInviteLink, useResendInvite, useRevokeInvite } from "@/lib/hooks/use-platform";
import { hrefFor } from "@/lib/routes/registry";
import type { Invite } from "@/lib/schemas/tenancy";
import { AdminDialog, errorMessage } from "../admin-dialog";

/**
 * Resend an invite (A9: same row, new token, +7 days; Q24). Resending an *expired* firm invite takes
 * a seat again, so at the seat limit it is the §0 over-limit exception: visible, disabled, reason inline.
 */
export function ResendInviteButton({ invite, blockedReason }: { invite: Invite; blockedReason?: string | null }) {
  const isAllowed = useCan("invite.resend");
  const resend = useResendInvite();
  const [isDone, setIsDone] = useState(false);
  if (!isAllowed) return null;
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

/**
 * Copy the invite's link (07 P4): /invite/[token] with its live token, which the mock auth layer keeps
 * (never on the Invite). A resend replaces the token, so a copied link stops working then. If the
 * clipboard is blocked, the link shows in a read-only field to copy by hand.
 */
export function CopyInviteLinkButton({ invite }: { invite: Invite }) {
  const isAllowed = useCan("invite.resend");
  const link = useInviteLink();
  const [copied, setCopied] = useState<string | null>(null);
  const [manual, setManual] = useState<string | null>(null);
  async function copy() {
    const { token } = await link.mutateAsync(invite.id);
    const url = `${window.location.origin}${hrefFor("invite", { token })}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
      setManual(null);
    } catch {
      setManual(url);
    }
  }
  if (!isAllowed) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button variant="ghost" size="sm" disabled={link.isPending} onClick={() => void copy().catch(() => undefined)}>
        <Link2 size={13} aria-hidden /> Copy link
      </Button>
      {copied ? <span role="status" className="text-caption text-[var(--color-success-fg)]">Link copied</span> : null}
      {manual ? <input readOnly value={manual} aria-label={`Invite link for ${invite.email}`} onFocus={(event) => event.currentTarget.select()} className="bq-input h-7 w-64 text-mono-sm" /> : null}
      {link.isError ? <span role="alert" className="text-caption text-[var(--color-danger-fg)]">{errorMessage(link.error)}</span> : null}
    </span>
  );
}

/** Revoke a pending invite (confirm; INVITE_REVOKED). */
export function RevokeInviteButton({ invite }: { invite: Invite }) {
  const isAllowed = useCan("invite.revoke");
  const revoke = useRevokeInvite();
  const [isOpen, setIsOpen] = useState(false);
  const close = () => {
    revoke.reset();
    setIsOpen(false);
  };
  if (!isAllowed) return null;
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
