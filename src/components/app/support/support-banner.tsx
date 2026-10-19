"use client";

import { useEffect, useRef } from "react";
import { Eye, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatIst } from "@/lib/format/timezone";
import { useExitSupportView, useExpireSupportView } from "@/lib/hooks/use-support-view";
import { useNow } from "@/lib/hooks/use-now";
import type { SupportView } from "@/lib/schemas/tenancy";
import { cn } from "@/lib/cn";

const WARN_MINUTES = 5;

/**
 * On every firm page while a support view is open (07 §4, docs/04 §14.10). Not dismissible. Counts
 * down; at 5 minutes left the time turns to the warning colour; at 0 the view has ended and the admin
 * goes back to the firm in admin. Fixed to the bottom of the screen so it never covers the page's own
 * header and is visible wherever the page scrolls.
 */
export function SupportBanner({ view, firmName, adminName }: { view: SupportView; firmName: string; adminName: string }) {
  const now = useNow(1000);
  const exit = useExitSupportView();
  const expire = useExpireSupportView(view.firmId);
  const leftMs = new Date(view.expiresAt).getTime() - now.getTime();
  const minutesLeft = Math.max(0, Math.ceil(leftMs / 60_000));
  const isWarning = minutesLeft <= WARN_MINUTES;
  const hasExpired = useRef(false);

  useEffect(() => {
    if (leftMs > 0 || hasExpired.current) return;
    hasExpired.current = true;
    void expire();
  }, [leftMs, expire]);

  return (
    <div role="region" aria-label="Support view" className="fixed inset-x-4 bottom-4 z-40 flex justify-center">
      <div className="bq-card flex w-full max-w-4xl flex-wrap items-center gap-x-3 gap-y-2 border-[var(--color-info-fg)] bg-[var(--color-info-bg)] px-4 py-2.5 shadow-[var(--shadow-md)]">
        <Eye size={16} aria-hidden className="shrink-0 text-[var(--color-info-fg)]" />
        <p className="min-w-0 flex-1 text-sm text-[var(--color-text)]">
          <strong>Support view of {firmName}</strong> · read-only · started {formatIst(view.startedAt, "h:mm a")} IST by {adminName} ·{" "}
          <span className={cn("tabular font-[600]", isWarning ? "text-[var(--color-warning-fg)]" : "text-[var(--color-text)]")} aria-live={isWarning ? "polite" : "off"}>
            {minutesLeft} min left
          </span>
        </p>
        <Button size="sm" variant="secondary" onClick={() => exit.mutate()} disabled={exit.isPending}>
          <LogOut size={14} aria-hidden /> {exit.isPending ? "Exiting…" : "Exit"}
        </Button>
      </div>
    </div>
  );
}
