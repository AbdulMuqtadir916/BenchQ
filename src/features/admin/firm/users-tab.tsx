"use client";

import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { MailX, UserX, Users } from "lucide-react";
import { DataTable } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { SkeletonTable } from "@/components/app/skeleton-table";
import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";
import { seatBlockReason } from "@/lib/derive/platform";
import { effectiveInviteStatus, type FirmUsage } from "@/lib/derive/tenancy";
import { useDeactivateUser, usePlatformTeam, useReactivateUser } from "@/lib/hooks/use-platform";
import type { User } from "@/lib/schemas/session";
import type { Invite, InviteStatus } from "@/lib/schemas/tenancy";
import { AdminDialog, errorMessage } from "../admin-dialog";
import { AdminDate, AdminTime } from "../admin-time";
import { CopyInviteLinkButton, ResendInviteButton, RevokeInviteButton } from "./invite-actions";
import { useFirmDetail, type FirmDetail } from "./use-firm-detail";

const ROLE_LABEL: Record<User["role"], string> = { OWNER: "Owner", MANAGER: "Manager", BDE: "BDE", VIEWER: "Viewer" };

/**
 * /admin/firms/[firmId]/users (docs/04 §14.5 Users tab): members, with Deactivate / Reactivate
 * (never on the OWNER, A10; reactivating is seat-blocked, A4), and pending or expired invites with
 * Resend / Revoke. No "invite member": firms invite their own (Phase M).
 */
export function FirmUsersTab() {
  const { detail } = useFirmDetail();
  if (!detail) return <SkeletonTable columns={5} />;
  return <FirmUsers detail={detail} />;
}

function FirmUsers({ detail }: { detail: FirmDetail }) {
  const { firm, data, usage, now } = detail;
  const staff = usePlatformTeam();
  const members = useMemo(() => data.users.filter((user) => user.firmId === firm.id), [data.users, firm.id]);
  const invites = useMemo(
    () =>
      data.invites
        .filter((invite) => invite.firmId === firm.id)
        .map((invite) => ({ invite, status: effectiveInviteStatus(invite, now) }))
        .filter((row) => row.status === "PENDING" || row.status === "EXPIRED")
        .sort((a, b) => b.invite.createdAt.localeCompare(a.invite.createdAt)),
    [data.invites, firm.id, now],
  );
  const nameOf = (userId: string) => data.users.find((user) => user.id === userId)?.name ?? staff.data?.find((admin) => admin.id === userId)?.name ?? "Unknown";

  return (
    <div className="space-y-8">
      <section aria-labelledby="members-heading">
        <h2 id="members-heading" className="mb-3 text-h3 text-[var(--color-text)]">Members</h2>
        <MembersTable members={members} usage={usage} />
      </section>
      <section aria-labelledby="invites-heading">
        <h2 id="invites-heading" className="mb-3 text-h3 text-[var(--color-text)]">Pending invites</h2>
        <InvitesTable rows={invites} usage={usage} nameOf={nameOf} />
      </section>
    </div>
  );
}

type MemberAction = { user: User; kind: "deactivate" | "reactivate" } | null;

function MembersTable({ members, usage }: { members: User[]; usage: FirmUsage }) {
  const [action, setAction] = useState<MemberAction>(null);
  const blocked = usage.canAddSeat ? null : seatBlockReason(usage);
  const columns = useMemo<ColumnDef<User, unknown>[]>(
    () => [
      { id: "name", header: "Name", enableSorting: false, cell: ({ row }) => <span className="text-[var(--color-text)]">{row.original.name}</span> },
      { id: "email", header: "Email", enableSorting: false, cell: ({ row }) => row.original.email },
      { id: "role", header: "Role", enableSorting: false, cell: ({ row }) => ROLE_LABEL[row.original.role] },
      {
        id: "status",
        header: "Status",
        enableSorting: false,
        cell: ({ row }) => (row.original.isActive ? <Tag tone="green">Active</Tag> : <Tag tone="neutral"><UserX size={12} aria-hidden /> Deactivated</Tag>),
      },
      {
        id: "lastActive",
        header: "Last active",
        enableSorting: false,
        cell: ({ row }) => (row.original.lastActiveAt ? <AdminTime iso={row.original.lastActiveAt} /> : <span className="text-[var(--color-text-3)]">Never</span>),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }) => {
          const user = row.original;
          if (user.role === "OWNER") return null; // A10: the owner can't be deactivated
          if (user.isActive) {
            return <Button variant="ghost" size="sm" onClick={() => setAction({ user, kind: "deactivate" })}>Deactivate</Button>;
          }
          // §0's over-limit exception: visible, disabled, the reason inline.
          return (
            <span className="inline-flex flex-wrap items-center gap-2">
              <Button variant="secondary" size="sm" disabled={Boolean(blocked)} aria-describedby={blocked ? `reactivate-${user.id}-reason` : undefined} onClick={() => setAction({ user, kind: "reactivate" })}>
                Reactivate
              </Button>
              {blocked ? <span id={`reactivate-${user.id}-reason`} className="text-caption text-[var(--color-warning-fg)]">{blocked}</span> : null}
            </span>
          );
        },
      },
    ],
    [blocked],
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={members}
        getRowId={(user) => user.id}
        isRowSelectable={false}
        hasToolbar={false}
        label="Members"
        emptyState={<EmptyState icon={Users} title="No users yet" description="The owner hasn't accepted their invite." />}
      />
      {action ? <MemberDialog action={action} onClose={() => setAction(null)} /> : null}
    </>
  );
}

function MemberDialog({ action, onClose }: { action: NonNullable<MemberAction>; onClose: () => void }) {
  const deactivate = useDeactivateUser();
  const reactivate = useReactivateUser();
  const mutation = action.kind === "deactivate" ? deactivate : reactivate;
  const { user } = action;
  return (
    <AdminDialog
      open
      onClose={onClose}
      title={action.kind === "deactivate" ? `Deactivate ${user.name}?` : `Reactivate ${user.name}?`}
      tone={action.kind === "deactivate" ? "danger" : "primary"}
      description={
        action.kind === "deactivate" ? (
          <p>They can&apos;t sign in any more and their seat is freed. Their work stays. You can reactivate them while the firm has a free seat.</p>
        ) : (
          <p>They can sign in again, and take a seat.</p>
        )
      }
      confirmLabel={action.kind === "deactivate" ? "Deactivate" : "Reactivate"}
      pendingLabel={action.kind === "deactivate" ? "Deactivating…" : "Reactivating…"}
      isPending={mutation.isPending}
      error={errorMessage(mutation.error)}
      onConfirm={() => mutation.mutate(user.id, { onSuccess: onClose })}
    />
  );
}

type InviteRow = { invite: Invite; status: InviteStatus };

function InvitesTable({ rows, usage, nameOf }: { rows: InviteRow[]; usage: FirmUsage; nameOf: (userId: string) => string }) {
  const blocked = usage.canAddSeat ? null : seatBlockReason(usage);
  const columns = useMemo<ColumnDef<InviteRow, unknown>[]>(
    () => [
      { id: "name", header: "Name", enableSorting: false, cell: ({ row }) => row.original.invite.inviteeName ?? <span className="text-[var(--color-text-3)]">—</span> },
      { id: "email", header: "Email", enableSorting: false, cell: ({ row }) => <span className="text-[var(--color-text)]">{row.original.invite.email}</span> },
      { id: "role", header: "Role", enableSorting: false, cell: ({ row }) => (row.original.invite.role === "PLATFORM_ADMIN" ? "Super Admin" : ROLE_LABEL[row.original.invite.role]) },
      { id: "sentBy", header: "Sent by", enableSorting: false, cell: ({ row }) => nameOf(row.original.invite.invitedByUserId) },
      { id: "sent", header: "Sent", enableSorting: false, cell: ({ row }) => <AdminDate iso={row.original.invite.createdAt} /> },
      { id: "expires", header: "Expires", enableSorting: false, cell: ({ row }) => <AdminDate iso={row.original.invite.expiresAt} /> },
      {
        id: "status",
        header: "Status",
        enableSorting: false,
        cell: ({ row }) => (row.original.status === "PENDING" ? <Tag tone="blue">Pending</Tag> : <Tag tone="amber"><MailX size={12} aria-hidden /> Expired</Tag>),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="inline-flex flex-wrap items-center gap-1">
            <ResendInviteButton invite={row.original.invite} blockedReason={row.original.status === "EXPIRED" ? blocked : null} />
            {row.original.status === "PENDING" ? <CopyInviteLinkButton invite={row.original.invite} /> : null}
            {row.original.status === "PENDING" ? <RevokeInviteButton invite={row.original.invite} /> : null}
          </span>
        ),
      },
    ],
    [blocked, nameOf],
  );
  return (
    <DataTable
      columns={columns}
      data={rows}
      getRowId={(row) => row.invite.id}
      isRowSelectable={false}
      hasToolbar={false}
      label="Pending invites"
      emptyState={<EmptyState icon={MailX} variant="filtered" title="No pending invites" description="Invites the firm sends show here until they're accepted." />}
    />
  );
}
