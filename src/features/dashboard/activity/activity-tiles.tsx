"use client";

import Link from "next/link";
import { ArrowDown, ArrowUp, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Change } from "./activity-insights";
import type { TrendBin } from "./activity-numbers";

/** A small line of the period's parts: the shape of the number, not a chart to read values from. */
function Sparkline({ bins, label }: { bins: TrendBin[]; label: string }) {
  const max = Math.max(1, ...bins.map((bin) => bin.count));
  const step = bins.length > 1 ? 100 / (bins.length - 1) : 100;
  const points = bins.map((bin, index) => `${index * step},${30 - (bin.count / max) * 26 - 2}`).join(" ");
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" role="img" aria-label={label} className="h-8 w-full text-[var(--color-chart-1)]">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function Delta({ change, versus }: { change: Change; versus: string }) {
  if (!change.text) return <span className="text-[var(--color-text-3)]">nothing {versus}</span>;
  const Arrow = change.trend === "down" ? ArrowDown : ArrowUp;
  return (
    <span className={cn("tabular inline-flex items-center gap-1", change.trend === "up" ? "text-[var(--color-success-fg)]" : change.trend === "down" ? "text-[var(--color-danger-fg)]" : "text-[var(--color-text-3)]")}>
      {change.trend !== "neutral" ? <Arrow size={12} aria-hidden /> : null}{change.text} <span className="text-[var(--color-text-3)]">{versus}</span>
    </span>
  );
}

const tile = "bq-card flex flex-col gap-1 p-4 transition-colors hover:border-[var(--color-border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]";

/** A headline number for the period, its change against the period before, and its shape. Opens the list behind it. */
export function KpiTile({ label, value, detail, change, versus, bins, href, icon: Icon }: {
  label: string; value: number; detail: string; change: Change; versus: string; bins: TrendBin[]; href: string; icon: LucideIcon;
}) {
  return (
    <Link href={href} className={tile} aria-label={`${label}: ${value}, ${detail}. Open the list`}>
      <span className="flex items-center justify-between gap-2 text-label text-[var(--color-text-3)]">{label}<Icon size={15} aria-hidden /></span>
      <span className="tabular text-h1 text-[var(--color-text)]">{value}</span>
      <Sparkline bins={bins} label={`${label} across the period`} />
      <span className="text-caption"><Delta change={change} versus={versus} /></span>
      <span className="text-caption text-[var(--color-text-3)]">{detail}</span>
    </Link>
  );
}

/** Of everyone being worked or placed, the share placed: a meter, so it reads as progress, not as a count. */
export function MeterTile({ label, percent, detail, href }: { label: string; percent: number | null; detail: string; href: string }) {
  return (
    <Link href={href} className={tile} aria-label={`${label}: ${percent === null ? "no candidates yet" : `${percent}%`}. Open the list`}>
      <span className="text-label text-[var(--color-text-3)]">{label}</span>
      <span className="tabular text-h1 text-[var(--color-text)]">{percent === null ? "—" : `${percent}%`}</span>
      <span className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--color-surface-3)]" aria-hidden>
        <span className="block h-full rounded-full bg-[var(--color-chart-2)]" style={{ width: `${percent ?? 0}%` }} />
      </span>
      <span className="mt-auto text-caption text-[var(--color-text-3)]">{detail}</span>
    </Link>
  );
}
