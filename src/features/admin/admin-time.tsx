import { formatIst, formatRelative } from "@/lib/format/timezone";
import { cn } from "@/lib/cn";

/**
 * Admin timestamps (docs/04 §14): not US-facing, so no DualTimestamp — relative time ("3 hours ago")
 * with the full IST date on hover and for screen readers.
 */
export function AdminTime({ iso, className }: { iso: string; className?: string }) {
  const full = `${formatIst(iso, "d MMM yyyy, h:mm a")} IST`;
  return (
    <time dateTime={iso} title={full} className={cn("tabular whitespace-nowrap", className)}>
      {formatRelative(iso)}
      <span className="sr-only"> ({full})</span>
    </time>
  );
}

/** A date only, in IST: "15 Oct 2026". */
export function AdminDate({ iso, className }: { iso: string; className?: string }) {
  return (
    <time dateTime={iso} title={`${formatIst(iso, "d MMM yyyy, h:mm a")} IST`} className={cn("tabular whitespace-nowrap", className)}>
      {formatIst(iso, "d MMM yyyy")}
    </time>
  );
}
