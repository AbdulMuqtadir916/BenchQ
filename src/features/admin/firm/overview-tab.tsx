"use client";

import { isBde } from "@/lib/auth/roles";
import Link from "next/link";
import type { ReactNode } from "react";
import { SkeletonCard } from "@/components/app/skeleton-card";
import { Card } from "@/components/ui/card";
import { firmLedger, seatBlockReason } from "@/lib/derive/platform";
import { useHref } from "@/lib/routes/use-href";
import { AdminDate } from "../admin-time";
import { ActivityList } from "../activity-list";
import { CopyInviteLinkButton, ResendInviteButton } from "./invite-actions";
import { useFirmDetail, type FirmDetail } from "./use-firm-detail";

/** /admin/firms/[firmId] Overview tab (docs/04 §14.5). The shell shows the error and not-found. */
export function FirmOverviewTab() {
  const { detail } = useFirmDetail();
  if (!detail) {
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        <SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard />
      </div>
    );
  }
  return <Overview detail={detail} />;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-2 text-sm">
      <dt className="text-[var(--color-text-3)]">{label}</dt>
      <dd className="text-right text-[var(--color-text)]">{children}</dd>
    </div>
  );
}

function Usage({ label, used, limit, isOver, detail }: { label: string; used: number; limit: number; isOver: boolean; detail: string }) {
  return (
    <div className="py-2">
      <div className="flex items-baseline justify-between gap-4 text-sm">
        <span className="text-[var(--color-text-3)]">{label}</span>
        <span className={isOver ? "tabular font-[600] text-[var(--color-danger-fg)]" : "tabular text-[var(--color-text)]"}>
          {used} / {limit}
          {isOver ? <span className="ml-2 font-normal">over limit</span> : null}
        </span>
      </div>
      <p className="mt-0.5 text-caption text-[var(--color-text-3)]">{detail}</p>
    </div>
  );
}

function Overview({ detail }: { detail: FirmDetail }) {
  const toHref = useHref();
  const { firm, plan, usage, owner, data } = detail;
  const activeBdes = data.users.filter((user) => user.firmId === firm.id && user.isActive && isBde(user)).length;
  const pendingInvites = usage.seatsUsed - activeBdes;
  const recent = firmLedger(firm.id, data.ledger).slice(0, 5);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <h2 className="mb-2 text-h3 text-[var(--color-text)]">Profile</h2>
        <dl className="divide-y divide-[var(--color-border)]">
          <Row label="Name">{firm.name}</Row>
          <Row label="Slug"><span className="text-mono-sm">{firm.slug}</span></Row>
          <Row label="Primary timezone">{firm.primaryTimezone}</Row>
          <Row label="Client timezone">{firm.clientTimezone}</Row>
          <Row label="Contact phone">{firm.contactPhone ?? <span className="text-[var(--color-text-3)]">None</span>}</Row>
          <Row label="Created"><AdminDate iso={firm.createdAt} /></Row>
        </dl>
      </Card>

      <Card>
        <h2 className="mb-2 text-h3 text-[var(--color-text)]">Plan and usage</h2>
        <dl className="divide-y divide-[var(--color-border)]">
          <Row label="Plan">{plan?.name ?? "Unknown plan"}{detail.isCustom ? " · custom limits" : ""}</Row>
        </dl>
        <Usage label="BDE seats used" used={usage.seatsUsed} limit={usage.seatLimit} isOver={usage.isOverSeatLimit} detail={`${activeBdes} active BDE${activeBdes === 1 ? "" : "s"} + ${pendingInvites} pending BDE invite${pendingInvites === 1 ? "" : "s"}`} />
        <Usage label="Active candidates" used={usage.activeCandidates} limit={usage.candidateLimit} isOver={usage.isOverCandidateLimit} detail="On bench, interviewing or offer" />
        {usage.isOverLimit ? (
          <p className="mt-2 text-sm text-[var(--color-danger-fg)]">New additions are blocked. Existing users keep working.</p>
        ) : null}
      </Card>

      <Card>
        <h2 className="mb-2 text-h3 text-[var(--color-text)]">Owner</h2>
        {owner.kind === "active" ? (
          <dl className="divide-y divide-[var(--color-border)]">
            <Row label="Name">{owner.name}</Row>
            <Row label="Email">{owner.email}</Row>
            <Row label="Status">{owner.isActive ? "Active" : "Deactivated"}</Row>
          </dl>
        ) : owner.kind === "none" ? (
          <p className="text-sm text-[var(--color-text-3)]">No owner and no owner invite.</p>
        ) : (
          <div className="space-y-3">
            <dl className="divide-y divide-[var(--color-border)]">
              <Row label="Name">{owner.name ?? <span className="text-[var(--color-text-3)]">Not given</span>}</Row>
              <Row label="Email">{owner.email}</Row>
              <Row label="Status">
                {owner.kind === "pending" ? (
                  <>Invite pending, expires <AdminDate iso={owner.invite.expiresAt} /></>
                ) : (
                  <span className="text-[var(--color-warning-fg)]">Invite expired</span>
                )}
              </Row>
            </dl>
            <div className="flex flex-wrap items-center gap-2">
              <ResendInviteButton invite={owner.invite} blockedReason={owner.kind === "expired" && !usage.canAddSeat ? seatBlockReason(usage) : null} />
              {owner.kind === "pending" ? <CopyInviteLinkButton invite={owner.invite} /> : null}
            </div>
          </div>
        )}
      </Card>

      <Card>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-h3 text-[var(--color-text)]">Recent activity</h2>
          <Link href={toHref("admin.firms.detail.activity", { firmId: firm.id })} className="text-sm text-[var(--color-primary-subtle-fg)] hover:underline">View all</Link>
        </div>
        <ActivityList entries={recent} empty="No activity yet." />
      </Card>
    </div>
  );
}
