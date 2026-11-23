import { cn } from "@/lib/cn";

/** The hover line for a score held at 40 (decided 2026-11-14, Q37): one short line, the first reason. */
export function heldLine(score: number, note: string | null | undefined): string | undefined {
  if (!note) return undefined;
  return `${score === 40 ? "Held at 40" : "Capped under 40"}: ${note}`;
}

/** MatchScore — compact score indicator with colour-coded bar and ring variants. `note`: why it is held at 40. */
export function MatchScore({
  score,
  note,
  className,
  variant = "bar",
}: {
  score: number;
  note?: string | null;
  className?: string;
  variant?: "bar" | "ring";
}) {
  const held = heldLine(score, note);
  const band =
    score >= 85
      ? "var(--color-success-fg)"
      : score >= 70
        ? "var(--color-primary)"
        : score >= 55
          ? "var(--color-warning-fg)"
          : "var(--color-text-3)";

  if (variant === "ring") {
    return (
      <span
        role="img"
        aria-label={`Match score ${score}${held ? `. ${held}` : ""}`}
        title={held}
        className={cn(
          "tabular flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 bg-[var(--color-surface)] text-[10px] font-semibold leading-none",
          className,
        )}
        style={{ borderColor: band, color: band }}
      >
        {score}
      </span>
    );
  }

  return (
    <div className={cn("flex items-center gap-2", className)} aria-label={`Match score ${score}${held ? `. ${held}` : ""}`} title={held}>
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-[var(--color-surface-3)]">
        <div className="h-full rounded-full" style={{ width: `${score}%`, background: band }} />
      </div>
      <span className="tabular text-mono-sm" style={{ color: band }}>
        {score}
      </span>
    </div>
  );
}
