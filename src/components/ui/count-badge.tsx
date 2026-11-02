import { cn } from "@/lib/cn";

/**
 * The small round count on an icon or a nav item (the bell's unread count, Notifications' pending requests). Sizes
 * and colours come from the theme tokens: the smallest type step (`text-mono-sm`, 10px) in the sans face, on a 12px line
 * (`.text-mono-sm` is unlayered CSS, so `!` lets the utilities win). It is decorative: the control it sits on names
 * the count in its label.
 */
export function CountBadge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex min-w-4 items-center justify-center rounded-full border-2 border-[var(--color-surface)] bg-[var(--color-primary)] px-1 text-mono-sm !font-sans font-semibold !leading-3 text-[var(--color-primary-fg)]",
        className,
      )}
    >
      {count}
    </span>
  );
}
