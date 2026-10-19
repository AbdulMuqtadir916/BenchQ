"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { ArrowLeft, Pencil, Link2, PauseCircle, PlayCircle } from "lucide-react";
import { ErrorState } from "@/components/app/error-state";
import { NotFoundState } from "@/components/app/not-found-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { activeNavId, routeById, type RouteId } from "@/lib/routes/registry";
import { useHref } from "@/lib/routes/use-href";
import { CustomLimitsBadge, FirmStatusBadge, OverLimitBadge } from "../firm-badges";
import { ChangeSlugDialog, EditFirmDialog, ReactivateFirmDialog, SuspendFirmDialog } from "./firm-actions";
import { useFirmDetail } from "./use-firm-detail";

const TABS: { id: RouteId; label: string }[] = [
  { id: "admin.firms.detail", label: "Overview" },
  { id: "admin.firms.detail.users", label: "Users" },
  { id: "admin.firms.detail.plan", label: "Plan" },
  { id: "admin.firms.detail.activity", label: "Activity" },
];

type Dialog = "edit" | "slug" | "suspend" | "reactivate" | null;

/**
 * /admin/firms/[firmId] and its tabs (docs/04 §14.5): the header (name, slug, status, over-limit and
 * custom-limits marks, actions that apply to the firm's state) and the tab nav, around the tab.
 * An unknown firm id is a not-found inside the admin shell. "View workspace" arrives with the support
 * view (P4).
 */
export function FirmShell({ children }: { children: ReactNode }) {
  const toHref = useHref();
  const pathname = usePathname() ?? "";
  const { firmId, group, isNotFound, detail } = useFirmDetail();
  const [dialog, setDialog] = useState<Dialog>(null);

  if (isNotFound) return <NotFoundState title="Firm not found" description="There is no firm with this id." backHref={toHref("admin.firms")} backLabel="Back to firms" />;

  const tabs = TABS.map((tab) => ({ ...tab, route: routeById(tab.id) }));
  const activeTab = activeNavId(tabs.map((tab) => tab.route), pathname);

  return (
    <div className="bq-page">
      <Link href={toHref("admin.firms")} className="mb-4 inline-flex items-center gap-1.5 text-sm text-[var(--color-text-3)] hover:text-[var(--color-text)]">
        <ArrowLeft size={14} aria-hidden /> Firms
      </Link>

      {group.status === "error" ? (
        <ErrorState variant="page" error={group.error} onRetry={group.retry} />
      ) : !detail ? (
        <div role="status" aria-busy="true" aria-label="Loading the firm" className="mb-6 space-y-2">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-4 w-40" />
        </div>
      ) : (
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-h1 text-[var(--color-text)]">{detail.firm.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-mono-sm text-[var(--color-text-3)]">{detail.firm.slug}</span>
              <FirmStatusBadge status={detail.firm.status} />
              {detail.usage.isOverLimit ? <OverLimitBadge /> : null}
              {detail.isCustom ? <CustomLimitsBadge /> : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setDialog("edit")}><Pencil size={14} aria-hidden /> Edit</Button>
            <Button variant="secondary" size="sm" onClick={() => setDialog("slug")}><Link2 size={14} aria-hidden /> Change slug</Button>
            {detail.firm.status === "ACTIVE" ? (
              <Button variant="secondary" size="sm" onClick={() => setDialog("suspend")}><PauseCircle size={14} aria-hidden /> Suspend</Button>
            ) : null}
            {detail.firm.status === "SUSPENDED" ? (
              <Button variant="secondary" size="sm" onClick={() => setDialog("reactivate")}><PlayCircle size={14} aria-hidden /> Reactivate</Button>
            ) : null}
          </div>
          {dialog === "edit" ? <EditFirmDialog firm={detail.firm} open onClose={() => setDialog(null)} /> : null}
          {dialog === "slug" ? <ChangeSlugDialog firm={detail.firm} open onClose={() => setDialog(null)} /> : null}
          {dialog === "suspend" ? <SuspendFirmDialog firm={detail.firm} open onClose={() => setDialog(null)} /> : null}
          {dialog === "reactivate" ? <ReactivateFirmDialog firm={detail.firm} open onClose={() => setDialog(null)} /> : null}
        </header>
      )}

      {group.status === "error" ? null : (
        <>
          <nav aria-label="Firm sections" className="bq-tabs mb-6">
            {tabs.map((tab) => (
              <Link key={tab.id} href={toHref(tab.id, { firmId })} aria-current={tab.id === activeTab ? "page" : undefined} className="bq-view-tab">
                {tab.label}
              </Link>
            ))}
          </nav>
          {children}
        </>
      )}
    </div>
  );
}
