"use client";

import { useState } from "react";
import { Link2, Send, UserPlus, XCircle } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tag, type TagTone } from "@/components/ui/tag";
import { ErrorState } from "@/components/app/error-state";
import { SkeletonCard } from "@/components/app/skeleton-card";
import { AdminDialog, DialogFrame, Field, errorMessage, fieldAria } from "@/features/admin/admin-dialog";
import { AdminDate } from "@/features/admin/admin-time";
import type { InviteMemberInput } from "@/lib/api/team";
import { useCan } from "@/lib/auth/permissions";
import { ROLE_LABEL } from "@/lib/auth/roles";
import { seatBlockReason } from "@/lib/derive/platform";
import { deriveFirmUsage } from "@/lib/derive/tenancy";
import { useInviteMember, useMemberInvites, useResendMemberInvite, useRevokeMemberInvite, useTeam } from "@/lib/hooks/use-team";
import { hrefFor } from "@/lib/routes/registry";
import type { User } from "@/lib/schemas/session";
import type { Invite, InviteStatus } from "@/lib/schemas/tenancy";
import { useFirm } from "@/lib/tenancy/firm-context";

/**
 * The firm side of invites on /settings/team (docs/07 Phase M, M2; 07 Q38). The OWNER invites a MANAGER, BDE or
 * VIEWER, resends and revokes; a MANAGER sees the invites read-only. There is no email yet: the OWNER copies the
 * link and sends it. A link is shown once, when the invite is sent or resent, so "Copy link" makes a new one and
 * the old link stops. Blocked at the seat limit (A4): visible, disabled, the reason inline (docs/04 §0).
 */

const ROLES: InviteMemberInput["role"][] = ["BDE", "MANAGER", "VIEWER"];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STATUS_TONE: Record<InviteStatus, TagTone> = { PENDING: "blue", EXPIRED: "amber", ACCEPTED: "green", REVOKED: "neutral" };
const STATUS_LABEL: Record<InviteStatus, string> = { PENDING: "Pending", EXPIRED: "Expired", ACCEPTED: "Accepted", REVOKED: "Revoked" };

const inviteUrl = (token: string) => `${window.location.origin}${hrefFor("invite", { token })}`;

/** Why a new seat can't be taken now, or null: the same rule and words as /admin (A1, A4). */
function useSeatBlock(members: readonly User[], invites: readonly Invite[]): string | null {
  const firm = useFirm();
  const usage = deriveFirmUsage(firm, { users: members, invites, candidates: [] }, new Date());
  return usage.canAddSeat ? null : seatBlockReason(usage);
}

export function MemberInvites({ members }: { members: readonly User[] }) {
  const invitesQuery = useMemberInvites();
  const canInvite = useCan("member.invite");
  const [link, setLink] = useState<{ email: string; url: string } | null>(null);
  const invites = invitesQuery.data ?? [];
  const blocked = useSeatBlock(members, invites);
  const showLink = (email: string, token: string) => setLink({ email, url: inviteUrl(token) });

  if (invitesQuery.isLoading) return <SkeletonCard aria-label="Loading invites" />;
  if (invitesQuery.error) return <ErrorState error={invitesQuery.error} onRetry={() => void invitesQuery.refetch()} />;

  const open = invites.filter((invite) => invite.status === "PENDING" || invite.status === "EXPIRED");
  return (
    <Card className="p-0">
      <CardHeader className="flex-wrap items-start justify-between gap-3 p-4">
        <div className="space-y-1">
          <CardTitle>Invites</CardTitle>
          <p className="text-caption text-[var(--color-text-3)]">
            {canInvite ? "Invite a member, then send them the link. A pending invite holds a seat for 7 days." : "Read-only: only the firm's owner invites members."}
          </p>
        </div>
        {canInvite ? <InviteMemberButton blockedReason={blocked} onSent={showLink} /> : null}
      </CardHeader>
      {open.length === 0 ? (
        <p className="border-t border-[var(--color-border)] px-4 py-6 text-sm text-[var(--color-text-3)]">No pending invites.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-y border-[var(--color-border)] bg-[var(--color-surface-3)] text-left text-caption text-[var(--color-text-3)]">
              <th className="px-4 py-2 font-medium">Email</th>
              <th className="px-4 py-2 font-medium">Role</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Expires</th>
              {canInvite ? <th className="px-4 py-2 font-medium"><span className="sr-only">Actions</span></th> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {open.map((invite) => (
              <tr key={invite.id}>
                <td className="px-4 py-3">
                  <span className="text-body-strong">{invite.inviteeName ?? invite.email}</span>
                  {invite.inviteeName ? <span className="block text-caption text-[var(--color-text-3)]">{invite.email}</span> : null}
                </td>
                <td className="px-4 py-3">{ROLE_LABEL[invite.role]}</td>
                <td className="px-4 py-3"><Tag tone={STATUS_TONE[invite.status]}>{STATUS_LABEL[invite.status]}</Tag></td>
                <td className="px-4 py-3 text-[var(--color-text-3)]"><AdminDate iso={invite.expiresAt} /></td>
                {canInvite && invite.role !== "OWNER" ? (
                  <td className="px-4 py-3">
                    <InviteActions invite={invite} blockedReason={invite.status === "EXPIRED" ? blocked : null} onLink={showLink} />
                  </td>
                ) : canInvite ? <td /> : null}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {link ? <InviteLinkDialog email={link.email} url={link.url} onClose={() => setLink(null)} /> : null}
    </Card>
  );
}

function InviteMemberButton({ blockedReason, onSent }: { blockedReason: string | null; onSent: (email: string, token: string) => void }) {
  const invite = useInviteMember();
  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState<{ email: string; name: string; role: InviteMemberInput["role"] }>({ email: "", name: "", role: "BDE" });
  const [isSubmitted, setIsSubmitted] = useState(false);
  const emailError = EMAIL.test(form.email.trim()) ? null : "Enter a valid email address.";
  const close = () => {
    invite.reset();
    setIsOpen(false);
    setIsSubmitted(false);
    setForm({ email: "", name: "", role: "BDE" });
  };
  function send() {
    setIsSubmitted(true);
    if (emailError) return;
    invite.mutate(
      { email: form.email.trim(), role: form.role, inviteeName: form.name.trim() || null },
      { onSuccess: ({ invite: sent, token }) => { close(); onSent(sent.email, token); } },
    );
  }
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button size="sm" disabled={Boolean(blockedReason)} aria-describedby={blockedReason ? "invite-member-reason" : undefined} onClick={() => setIsOpen(true)}>
        <UserPlus size={14} aria-hidden /> Invite member
      </Button>
      {blockedReason ? <span id="invite-member-reason" className="text-caption text-[var(--color-warning-fg)]">{blockedReason}</span> : null}
      {isOpen ? (
        <AdminDialog
          open
          onClose={close}
          title="Invite a member"
          description={<p>They get a link to set their password and join. The link works for 7 days.</p>}
          confirmLabel="Send invite"
          pendingLabel="Sending…"
          isPending={invite.isPending}
          error={errorMessage(invite.error)}
          onConfirm={send}
        >
          <Field id="invite-email" label="Email" error={isSubmitted ? emailError : null}>
            <Input {...fieldAria("invite-email", isSubmitted ? emailError : null)} type="email" autoComplete="off" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
          </Field>
          <Field id="invite-name" label="Name (optional)" hint="Shown on their invite page; they can change it.">
            <Input {...fieldAria("invite-name", null, true)} autoComplete="off" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </Field>
          <Field id="invite-role" label="Role">
            <select id="invite-role" value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as InviteMemberInput["role"] })} className="bq-input w-full">
              {ROLES.map((role) => <option key={role} value={role}>{ROLE_LABEL[role]}</option>)}
            </select>
          </Field>
        </AdminDialog>
      ) : null}
    </span>
  );
}

function InviteActions({ invite, blockedReason, onLink }: { invite: Invite; blockedReason: string | null; onLink: (email: string, token: string) => void }) {
  const resend = useResendMemberInvite();
  const revoke = useRevokeMemberInvite();
  const [isRevoking, setIsRevoking] = useState(false);
  const isPending = invite.status === "PENDING";
  const resendNow = () => resend.mutate(invite.id, { onSuccess: ({ token }) => onLink(invite.email, token) });
  return (
    <span className="flex flex-wrap items-center justify-end gap-2">
      <Button
        variant={isPending ? "ghost" : "secondary"}
        size="sm"
        disabled={Boolean(blockedReason) || resend.isPending}
        aria-describedby={blockedReason ? `resend-${invite.id}-reason` : undefined}
        title={isPending ? "Makes a new link; the one you sent before stops working." : undefined}
        onClick={resendNow}
      >
        {isPending ? <><Link2 size={13} aria-hidden /> Copy link</> : <><Send size={13} aria-hidden /> Resend</>}
      </Button>
      {isPending ? (
        <Button variant="ghost" size="sm" onClick={() => setIsRevoking(true)}>
          <XCircle size={13} aria-hidden /> Revoke
        </Button>
      ) : null}
      {blockedReason ? <span id={`resend-${invite.id}-reason`} className="text-caption text-[var(--color-warning-fg)]">{blockedReason}</span> : null}
      {resend.isError ? <span role="alert" className="text-caption text-[var(--color-danger-fg)]">{errorMessage(resend.error)}</span> : null}
      {isRevoking ? (
        <AdminDialog
          open
          onClose={() => { revoke.reset(); setIsRevoking(false); }}
          title="Revoke this invite?"
          tone="danger"
          description={<p>The link sent to <strong>{invite.email}</strong> stops working and the seat is freed. You can invite them again later.</p>}
          confirmLabel="Revoke invite"
          pendingLabel="Revoking…"
          isPending={revoke.isPending}
          error={errorMessage(revoke.error)}
          onConfirm={() => revoke.mutate(invite.id, { onSuccess: () => setIsRevoking(false) })}
        />
      ) : null}
    </span>
  );
}

/** The link, once: copy it now (07 Q38). If the clipboard is blocked, the field is there to copy by hand. */
function InviteLinkDialog({ email, url, onClose }: { email: string; url: string; onClose: () => void }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <DialogFrame title="Send this link" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-[var(--color-text-2)]">
          Send it to <strong>{email}</strong> yourself: BenchQ doesn&apos;t email invites yet. It&apos;s shown only now; &quot;Copy link&quot; later makes a new one.
        </p>
        <Field id="invite-link" label="Invite link" hint={copied === false ? "Copying is blocked here: select the link and copy it." : undefined}>
          <input {...fieldAria("invite-link", null, copied === false)} readOnly value={url} onFocus={(event) => event.currentTarget.select()} className="bq-input w-full text-mono-sm" />
        </Field>
        {copied ? <p role="status" className="text-caption text-[var(--color-success-fg)]">Link copied.</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Done</Button>
          <Button type="button" onClick={() => void copy()}><Link2 size={14} aria-hidden /> Copy link</Button>
        </div>
      </div>
    </DialogFrame>
  );
}

/** The team page's invites, under the members (OWNER and MANAGER only: `team.view`). */
export function TeamInvitesSection() {
  const canView = useCan("team.view");
  const team = useTeam();
  if (!canView || !team.data) return null;
  return <MemberInvites members={team.data} />;
}
