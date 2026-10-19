"use client";

import { useCan } from "@/lib/auth/permissions";
import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { MailX, UserPlus, UserX } from "lucide-react";
import { DataTable } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tag } from "@/components/ui/tag";
import { effectiveInviteStatus } from "@/lib/derive/tenancy";
import { useDeactivateStaff, useInviteStaff, usePlatformInvites, usePlatformTeam } from "@/lib/hooks/use-platform";
import { useNow } from "@/lib/hooks/use-now";
import { queryGroup } from "@/lib/query/query-group";
import { useSignedInPrincipal } from "@/lib/stores/session-store";
import type { Invite, InviteStatus, PlatformUser } from "@/lib/schemas/tenancy";
import { AdminDialog, Field, errorMessage, fieldAria } from "./admin-dialog";
import { AdminDate, AdminTime } from "./admin-time";
import { CopyInviteLinkButton, ResendInviteButton, RevokeInviteButton } from "./firm/invite-actions";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * /admin/team (docs/04 §14.8): BenchQ staff. Every admin is PLATFORM_ADMIN (A11). Deactivate is not
 * rendered on yourself or on the last active admin. Never empty: you are on it.
 */
export function TeamPage() {
  const now = useNow();
  const principal = useSignedInPrincipal();
  const team = usePlatformTeam();
  const invites = usePlatformInvites(null);
  const [isInviting, setIsInviting] = useState(false);
  const canManage = useCan("platformTeam.manage");
  const [deactivating, setDeactivating] = useState<PlatformUser | null>(null);
  const activeCount = (team.data ?? []).filter((user) => user.isActive).length;

  const staffColumns = useMemo<ColumnDef<PlatformUser, unknown>[]>(
    () => [
      { id: "name", header: "Name", enableSorting: false, cell: ({ row }) => <span className="text-[var(--color-text)]">{row.original.name}{row.original.id === principal.userId ? <span className="text-[var(--color-text-3)]"> (you)</span> : null}</span> },
      { id: "email", header: "Email", enableSorting: false, cell: ({ row }) => row.original.email },
      { id: "status", header: "Status", enableSorting: false, cell: ({ row }) => (row.original.isActive ? <Tag tone="green">Active</Tag> : <Tag tone="neutral"><UserX size={12} aria-hidden /> Deactivated</Tag>) },
      { id: "lastActive", header: "Last active", enableSorting: false, cell: ({ row }) => (row.original.lastActiveAt ? <AdminTime iso={row.original.lastActiveAt} /> : <span className="text-[var(--color-text-3)]">Never</span>) },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }) =>
          canManage && row.original.isActive && row.original.id !== principal.userId && activeCount > 1 ? (
            <Button variant="ghost" size="sm" onClick={() => setDeactivating(row.original)}>Deactivate</Button>
          ) : null,
      },
    ],
    [principal.userId, activeCount, canManage],
  );

  type InviteRow = { invite: Invite; status: InviteStatus };
  const inviteRows = useMemo<InviteRow[]>(
    () =>
      (invites.data ?? [])
        .map((invite) => ({ invite, status: effectiveInviteStatus(invite, now) }))
        .filter((row) => row.status === "PENDING" || row.status === "EXPIRED")
        .sort((a, b) => b.invite.createdAt.localeCompare(a.invite.createdAt)),
    [invites.data, now],
  );
  const inviteColumns = useMemo<ColumnDef<InviteRow, unknown>[]>(
    () => [
      { id: "email", header: "Email", enableSorting: false, cell: ({ row }) => <span className="text-[var(--color-text)]">{row.original.invite.email}</span> },
      { id: "sentBy", header: "Sent by", enableSorting: false, cell: ({ row }) => team.data?.find((user) => user.id === row.original.invite.invitedByUserId)?.name ?? "Unknown" },
      { id: "sent", header: "Sent", enableSorting: false, cell: ({ row }) => <AdminDate iso={row.original.invite.createdAt} /> },
      { id: "expires", header: "Expires", enableSorting: false, cell: ({ row }) => <AdminDate iso={row.original.invite.expiresAt} /> },
      { id: "status", header: "Status", enableSorting: false, cell: ({ row }) => (row.original.status === "PENDING" ? <Tag tone="blue">Pending</Tag> : <Tag tone="amber"><MailX size={12} aria-hidden /> Expired</Tag>) },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="inline-flex flex-wrap items-center gap-1">
            <ResendInviteButton invite={row.original.invite} />
            {row.original.status === "PENDING" ? <CopyInviteLinkButton invite={row.original.invite} /> : null}
            {row.original.status === "PENDING" ? <RevokeInviteButton invite={row.original.invite} /> : null}
          </span>
        ),
      },
    ],
    [team.data],
  );
  const inviteGroup = queryGroup(invites, team);

  return (
    <div className="bq-page">
      <PageHeader title="Team" subtitle="BenchQ staff with Super Admin access." actions={canManage ? <Button onClick={() => setIsInviting(true)}><UserPlus size={14} aria-hidden /> Invite staff</Button> : undefined} />
      <section aria-labelledby="staff-heading" className="mb-8">
        <h2 id="staff-heading" className="mb-3 text-h3 text-[var(--color-text)]">Staff</h2>
        <DataTable
          columns={staffColumns}
          data={team.data ?? []}
          getRowId={(user) => user.id}
          isLoading={team.isPending}
          error={team.error}
          onRetry={() => void team.refetch()}
          isRowSelectable={false}
          hasToolbar={false}
          label="Staff"
        />
      </section>
      <section aria-labelledby="staff-invites-heading">
        <h2 id="staff-invites-heading" className="mb-3 text-h3 text-[var(--color-text)]">Pending staff invites</h2>
        <DataTable
          columns={inviteColumns}
          data={inviteRows}
          getRowId={(row) => row.invite.id}
          isLoading={inviteGroup.status === "pending"}
          error={inviteGroup.status === "error" ? inviteGroup.error : null}
          onRetry={inviteGroup.retry}
          isRowSelectable={false}
          hasToolbar={false}
          label="Pending staff invites"
          emptyState={<EmptyState icon={MailX} variant="filtered" title="No pending invites" description="Staff you invite show here until they accept." />}
        />
      </section>
      {isInviting ? <InviteStaffDialog onClose={() => setIsInviting(false)} /> : null}
      {deactivating ? <DeactivateStaffDialog user={deactivating} onClose={() => setDeactivating(null)} /> : null}
    </div>
  );
}

function InviteStaffDialog({ onClose }: { onClose: () => void }) {
  const invite = useInviteStaff();
  const [email, setEmail] = useState("");
  const [isSubmitted, setIsSubmitted] = useState(false);
  const error = EMAIL.test(email.trim()) ? null : "Enter a valid email address.";
  return (
    <AdminDialog
      open
      onClose={onClose}
      title="Invite staff"
      description={<p>They join as a Super Admin, the only platform role. The invite is valid for 7 days.</p>}
      confirmLabel="Send invite"
      pendingLabel="Sending…"
      isPending={invite.isPending}
      error={errorMessage(invite.error)}
      onConfirm={() => {
        setIsSubmitted(true);
        if (!error) invite.mutate(email.trim(), { onSuccess: onClose });
      }}
    >
      <Field id="staff-email" label="Email" error={isSubmitted ? error : null}>
        <Input {...fieldAria("staff-email", isSubmitted ? error : null)} type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="off" />
      </Field>
    </AdminDialog>
  );
}

function DeactivateStaffDialog({ user, onClose }: { user: PlatformUser; onClose: () => void }) {
  const deactivate = useDeactivateStaff();
  return (
    <AdminDialog
      open
      onClose={onClose}
      title={`Deactivate ${user.name}?`}
      tone="danger"
      description={<p>They lose Super Admin access and can&apos;t sign in. Their past actions stay in the audit log.</p>}
      confirmLabel="Deactivate"
      pendingLabel="Deactivating…"
      isPending={deactivate.isPending}
      error={errorMessage(deactivate.error)}
      onConfirm={() => deactivate.mutate(user.id, { onSuccess: onClose })}
    />
  );
}
