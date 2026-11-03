"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { cn } from "@/lib/cn";
import { isPendingRequest, useNotifications } from "@/lib/hooks/use-notifications";
import { isRouteActive, navFor, type RouteId } from "@/lib/routes/registry";
import { useHref } from "@/lib/routes/use-href";
import { useSignedInPrincipal } from "@/lib/stores/session-store";

/**
 * Notifications with its own sidebar of inboxes, from the registry's `notifications` section (only Requests for
 * now), like the Settings sections. An inbox opens beside it only when clicked; until then that side is empty.
 */
export function NotificationsShell({ subtitle, children }: { subtitle: string; children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const toHref = useHref();
  const principal = useSignedInPrincipal();
  const inboxes = navFor(principal, "notifications");
  const pendingCount = (useNotifications().data ?? []).filter(isPendingRequest).length;

  return (
    <div className="bq-page">
      <PageHeader title="Notifications" subtitle={subtitle} />
      <div className="grid gap-6 lg:grid-cols-[180px_1fr]">
        <nav aria-label="Notification inboxes" className="space-y-1 lg:sticky lg:top-4 lg:self-start">
          {inboxes.map((inbox) => {
            const Icon = inbox.nav?.icon;
            const isActive = isRouteActive(inbox.id as RouteId, pathname);
            const count = inbox.id.endsWith(".requests") ? pendingCount : 0;
            return (
              <Link
                key={inbox.id}
                href={toHref(inbox)}
                aria-current={isActive ? "page" : undefined}
                aria-label={count ? `${inbox.title}, ${count} awaiting approval` : inbox.title}
                className={cn(
                  "flex w-full items-center gap-2 rounded-[var(--radius-md)] px-3 py-2 text-left text-sm",
                  isActive
                    ? "bg-[var(--color-primary-subtle)] text-[var(--color-primary-subtle-fg)]"
                    : "text-[var(--color-text-2)] hover:bg-[var(--color-surface-2)]",
                )}
              >
                {Icon ? <Icon size={15} aria-hidden /> : null}
                <span className="flex-1">{inbox.title}</span>
                {count ? <span aria-hidden className="text-mono-sm text-[var(--color-primary)]">{count}</span> : null}
              </Link>
            );
          })}
        </nav>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
