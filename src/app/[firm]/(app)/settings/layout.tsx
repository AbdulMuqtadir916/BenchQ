"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSignedInUser } from "@/lib/stores/session-store";
import { isRouteActive, navFor, type RouteId } from "@/lib/routes/registry";
import { useHref } from "@/lib/routes/use-href";
import { PageHeader } from "@/components/app/page-header";
import { cn } from "@/lib/cn";

/** Settings sections from the route registry: each role sees only the sections it may open. */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const toHref = useHref();
  const role = useSignedInUser().role;
  const sections = navFor(role, "settings");

  return (
    <div className="bq-page">
      <PageHeader title="Settings" subtitle="Firm, team, templates, and your preferences." />
      <div className="grid gap-6 lg:grid-cols-[180px_1fr]">
        <nav aria-label="Settings sections" className="space-y-1 lg:sticky lg:top-4 lg:self-start">
          {sections.map((route) => {
            const Icon = route.nav?.icon;
            const isActive = isRouteActive(route.id as RouteId, pathname ?? "");
            return (
              <Link
                key={route.id}
                href={toHref(route)}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex w-full items-center gap-2 rounded-[var(--radius-md)] px-3 py-2 text-left text-sm",
                  isActive
                    ? "bg-[var(--color-primary-subtle)] text-[var(--color-primary-subtle-fg)]"
                    : "text-[var(--color-text-2)] hover:bg-[var(--color-surface-2)]",
                )}
              >
                {Icon ? <Icon size={15} aria-hidden /> : null}
                {route.title}
              </Link>
            );
          })}
        </nav>
        <div>{children}</div>
      </div>
    </div>
  );
}
