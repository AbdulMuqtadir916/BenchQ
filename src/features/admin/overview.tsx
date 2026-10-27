"use client";

import Link from "next/link";
import { ArrowRight, BellRing, Building2, CircleCheck, CircleDashed, CirclePause, ScrollText, Users } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { ErrorState } from "@/components/app/error-state";
import { GroupBody, GroupRowError } from "@/components/app/card-group";
import { SkeletonCard } from "@/components/app/skeleton-card";
import { SkeletonList } from "@/components/app/skeleton-list";
import { Card, CardHeader } from "@/components/ui/card";
import { useAudit, useCandidateUsage, usePlatformFirms, usePlatformInvites, usePlatformUsers } from "@/lib/hooks/use-platform";
import { useNow } from "@/lib/hooks/use-now";
import { hasPageFailed, queryGroup } from "@/lib/query/query-group";
import { firmsByStatus, needsAttention, seatTotals, type AttentionItem } from "@/lib/derive/platform";
import { useHref } from "@/lib/routes/use-href";
import type { FirmStatus } from "@/lib/schemas/tenancy";
import type { LedgerEntry } from "@/lib/schemas/analytics";
import type { Firm } from "@/lib/schemas/session";
import { AdminTime } from "./admin-time";
import { ActivityList } from "./activity-list";

const TITLE = "Overview";
const SUBTITLE = "What needs attention now, then the health of the platform.";

/**
 * /admin (docs/04 §14.2). Four card groups (§13): Needs attention (every platform record), Firms by
 * status (firms), Seats (firms, users, invites, candidates) and Recent platform activity (the ledger).
 * AI spend stays hidden until its contract is approved (07 Q29).
 */
export function AdminOverview() {
  const now = useNow();
  const firms = usePlatformFirms();
  const users = usePlatformUsers();
  const invites = usePlatformInvites();
  const candidates = useCandidateUsage();
  const audit = useAudit();

  const attention = queryGroup(firms, users, invites, candidates, audit);
  const byStatus = queryGroup(firms);
  const seats = queryGroup(firms, users, invites, candidates);
  const activity = queryGroup(audit);

  if (hasPageFailed(firms, users, invites, candidates, audit)) {
    return (
      <div className="bq-page">
        <PageHeader title={TITLE} subtitle={SUBTITLE} />
        <ErrorState variant="page" error={attention.error ?? new Error("The request failed.")} onRetry={attention.retry} />
      </div>
    );
  }

  const data = () => ({ firms: firms.data!, users: users.data!, invites: invites.data!, candidates: candidates.data!, ledger: audit.data! });

  return (
    <div className="bq-page">
      <PageHeader title={TITLE} subtitle={SUBTITLE} />

      <Card className="mb-6">
        <CardHeader>
          <h2 className="flex items-center gap-2 text-h3 text-[var(--color-text)]"><BellRing size={15} aria-hidden /> Needs attention</h2>
        </CardHeader>
        <GroupBody group={attention} skeleton={<SkeletonList rows={3} aria-label="Loading what needs attention" />}>
          {() => <AttentionList items={needsAttention(data(), now)} />}
        </GroupBody>
      </Card>

      <h2 className="bq-section-heading mb-3 text-h3 text-[var(--color-text)]">Firms by status</h2>
      <section aria-label="Firms by status" className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {byStatus.status === "error" ? (
          <GroupRowError group={byStatus} />
        ) : byStatus.status === "pending" ? (
          <><SkeletonCard /><SkeletonCard /><SkeletonCard /></>
        ) : (
          <StatusCards counts={firmsByStatus(firms.data!)} />
        )}
      </section>

      <h2 className="bq-section-heading mb-3 text-h3 text-[var(--color-text)]">BDE seats</h2>
      <section aria-label="BDE seats" className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {seats.status === "error" ? (
          <GroupRowError group={seats} />
        ) : seats.status === "pending" ? (
          <><SkeletonCard /><SkeletonCard /></>
        ) : (
          <SeatCards {...seatTotals(data(), now)} />
        )}
      </section>

      <RecentActivity group={activity} entries={() => audit.data!.slice(0, 10)} firms={firms.data} />
    </div>
  );
}

const STATUS_CARDS: { status: FirmStatus; label: string; Icon: typeof CircleCheck; tone: string }[] = [
  { status: "ACTIVE", label: "Active", Icon: CircleCheck, tone: "bg-[var(--color-success-bg)] text-[var(--color-success-fg)]" },
  { status: "ONBOARDING", label: "Onboarding", Icon: CircleDashed, tone: "bg-[var(--color-warning-bg)] text-[var(--color-warning-fg)]" },
  { status: "SUSPENDED", label: "Suspended", Icon: CirclePause, tone: "bg-[var(--color-danger-bg)] text-[var(--color-danger-fg)]" },
];

function StatusCards({ counts }: { counts: Record<FirmStatus, number> }) {
  const toHref = useHref();
  return (
    <>
      {STATUS_CARDS.map(({ status, label, Icon, tone }) => (
        <Link key={status} href={toHref("admin.firms", {}, { status })} className="bq-card block p-4 hover:border-[var(--color-border-strong)]">
          <div className="flex items-center justify-between gap-3">
            <span className="text-label text-[var(--color-text-3)]">{label}</span>
            <span className={`inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-md)] ${tone}`} aria-hidden><Icon size={14} /></span>
          </div>
          <div className="tabular mt-1 text-h1 text-[var(--color-text)]">{counts[status]}</div>
          <div className="mt-1 text-caption text-[var(--color-text-3)]">firm{counts[status] === 1 ? "" : "s"} · view list</div>
        </Link>
      ))}
    </>
  );
}

function SeatCards({ seatsUsed, seatLimit, activeUsers }: { seatsUsed: number; seatLimit: number; activeUsers: number }) {
  return (
    <>
      <div className="bq-card p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-label text-[var(--color-text-3)]">BDE seats used</span>
          <Building2 size={14} aria-hidden className="text-[var(--color-text-3)]" />
        </div>
        <div className="tabular mt-1 text-h1 text-[var(--color-text)]">{seatsUsed} / {seatLimit}</div>
        <div className="mt-1 text-caption text-[var(--color-text-3)]">active firms · BDEs + pending BDE invites</div>
      </div>
      <div className="bq-card p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-label text-[var(--color-text-3)]">Active users</span>
          <Users size={14} aria-hidden className="text-[var(--color-text-3)]" />
        </div>
        <div className="tabular mt-1 text-h1 text-[var(--color-text)]">{activeUsers}</div>
        <div className="mt-1 text-caption text-[var(--color-text-3)]">across all firms</div>
      </div>
    </>
  );
}

function attentionText(item: AttentionItem): { title: string; detail: string } {
  switch (item.kind) {
    case "over-limit":
      return { title: `Over its ${item.limit === "seats" ? "BDE seat" : "candidate"} limit`, detail: `${item.used} of ${item.allowed} ${item.limit === "seats" ? "BDE seats" : item.limit}, ${item.used - item.allowed} over` };
    case "owner-invite-expired":
      return { title: "Owner invite expired", detail: `${item.email}: resend it so the firm can go active` };
    case "stalled-onboarding":
      return { title: "Onboarding stalled", detail: `Created ${item.days} days ago; the owner hasn't accepted yet` };
    case "support-view-open":
      return { title: "Support view open", detail: `${item.entry.actorName}: ${item.entry.summary}` };
  }
}

function AttentionList({ items }: { items: AttentionItem[] }) {
  const toHref = useHref();
  if (items.length === 0) {
    return (
      <p className="flex items-center gap-2 py-2 text-sm text-[var(--color-text-3)]">
        <CircleCheck size={15} aria-hidden className="text-[var(--color-success-fg)]" /> Nothing needs attention.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-[var(--color-border)]">
      {items.map((item) => {
        const { title, detail } = attentionText(item);
        return (
          <li key={`${item.kind}-${item.firm.id}-${"limit" in item ? item.limit : ""}`}>
            <Link href={toHref("admin.firms.detail", { firmId: item.firm.id })} className="flex items-center gap-3 rounded-[var(--radius-sm)] py-2.5 hover:bg-[var(--color-surface-2)]">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-[var(--color-text)]">
                  <span className="font-[600]">{item.firm.name}</span> · {title}
                </span>
                <span className="block truncate text-caption text-[var(--color-text-3)]">{detail}</span>
              </span>
              {item.kind === "support-view-open" ? <AdminTime iso={item.entry.createdAt} className="text-caption text-[var(--color-text-3)]" /> : null}
              <ArrowRight size={14} aria-hidden className="shrink-0 text-[var(--color-text-3)]" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function RecentActivity({ group, entries, firms }: { group: ReturnType<typeof queryGroup>; entries: () => LedgerEntry[]; firms: Firm[] | undefined }) {
  const toHref = useHref();
  return (
    <Card>
      <CardHeader>
        <h2 className="flex items-center gap-2 text-h3 text-[var(--color-text)]"><ScrollText size={15} aria-hidden /> Recent platform activity</h2>
        <Link href={toHref("admin.audit")} className="text-sm text-[var(--color-primary-subtle-fg)] hover:underline">View all</Link>
      </CardHeader>
      <GroupBody group={group} skeleton={<SkeletonList rows={5} aria-label="Loading recent activity" />}>
        {() => <ActivityList entries={entries()} firms={firms} empty="No activity yet." />}
      </GroupBody>
    </Card>
  );
}
