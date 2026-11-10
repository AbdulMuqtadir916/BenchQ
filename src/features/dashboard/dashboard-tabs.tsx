"use client";

import type { ReactNode } from "react";
import { PageHeader } from "@/components/app/page-header";
import { cn } from "@/lib/cn";
import { useUrlState } from "@/lib/routes/use-url-state";
import { DashboardSearch, type DashboardSearchState } from "@/lib/schemas/dashboard-search";
import { OwnerActivityDashboard } from "./owner-activity-dashboard";

interface Tab {
  label: string;
  title: string;
  subtitle: string;
}

/**
 * The dashboard's two tabs, kept in the URL (`?view=`): the role's own overview first, then Activity. Activity is the
 * same drill-down for everyone who has it (a manager has only Activity: `activityOnly`); who sees which part of it is the scope's business (07 Q47).
 */
export function DashboardTabs({ overview, activity, activityOnly = false, children }: { overview: Tab; activity: Omit<Tab, "label">; activityOnly?: boolean; children: ReactNode }) {
  const [query, setQuery] = useUrlState(DashboardSearch);
  const isOverview = !activityOnly && query.view === "finance";
  const tab = (view: DashboardSearchState["view"], label: string) => (
    <button type="button" aria-pressed={query.view === view} onClick={() => setQuery({ view })}
      className={cn("rounded-[var(--radius-sm)] px-4 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]",
        query.view === view ? "bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm" : "text-[var(--color-text-3)] hover:text-[var(--color-text)]")}>
      {label}
    </button>
  );
  return (
    <div className="bq-page">
      <PageHeader title={isOverview ? overview.title : activity.title} subtitle={isOverview ? overview.subtitle : activity.subtitle}
        actions={activityOnly ? undefined : (
          <div role="group" aria-label="Dashboard views" className="inline-flex rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-1">
            {tab("finance", overview.label)}
            {tab("activity", "Activity dashboard")}
          </div>
        )} />
      <div aria-label={isOverview ? overview.label : "Activity dashboard"}>
        {isOverview ? children : <OwnerActivityDashboard />}
      </div>
    </div>
  );
}
