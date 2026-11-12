"use client";

import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2 } from "lucide-react";
import { STATUS_LABEL } from "@/components/app/applications/status-meta";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/cn";
import { deriveFunnel } from "@/lib/derive";
import type { Application } from "@/lib/schemas/application";
import { isReachedStage, type ListPeriod } from "@/lib/schemas/list-search";
import type { Attention, BenchHealth, Ratios, StageSpeed } from "./activity-insights";
import { linkSurface, type ListLinks } from "./activity-links";

export const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
export const Hint = ({ children }: { children: string }) => <p className="mt-1 text-caption text-[var(--color-text-3)]">{children}</p>;
const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]";
const chip = cn("inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text)] hover:bg-[var(--color-surface-2)]", focusRing);

/** What to act on first, as chips that open the list behind them. Empty is good news, and says so. */
export function AttentionChips({ items, links, onOpenBde }: { items: Attention[]; links: ListLinks; onOpenBde?: (bdeId: string) => void }) {
  if (items.length === 0) {
    return <p className="flex items-center gap-2 text-sm text-[var(--color-success-fg)]"><CheckCircle2 size={16} aria-hidden />Nothing needs attention right now.</p>;
  }
  const icon = <AlertTriangle size={14} aria-hidden className="text-[var(--color-warning-fg)]" />;
  return (
    <ul aria-label="Needs attention" className="flex flex-wrap gap-2">
      {items.map((item) => (
        <li key={item.kind === "quiet-bde" ? item.bde.id : item.kind}>
          {item.kind === "without-bde" ? <Link className={chip} href={links.candidates({ assignment: "needs-bde" })}>{icon}{plural(item.count, "candidate")} waiting for a BDE</Link>
            : item.kind === "aging" ? <Link className={chip} href={links.candidates({ bench: "over30" })}>{icon}{plural(item.count, "candidate")} on the bench 30+ days</Link>
              : onOpenBde ? <button type="button" className={chip} onClick={() => onOpenBde(item.bde.id)}>{icon}{item.bde.name}: nothing submitted this period</button>
                : <Link className={chip} href={links.candidates({ bde: item.bde.id })}>{icon}{item.bde.name}: nothing submitted this period</Link>}
        </li>
      ))}
    </ul>
  );
}

const ratioText = (value: number | null, unit = "%") => (value === null ? "—" : `${value}${unit}`);

/** How far the period's applications got: each stage a bar, with the share of the stage before. Each opens its list. */
export function FunnelCard({ applications, ratios, period, links }: { applications: readonly Application[]; ratios: Ratios; period: ListPeriod; links: ListLinks }) {
  const funnel = deriveFunnel([...applications]);
  const max = Math.max(1, ...funnel.map((stage) => stage.count));
  return (
    <Card>
      <CardHeader><div><CardTitle>Pipeline</CardTitle><Hint>How far this period&apos;s applications got, and the share that made each step</Hint></div></CardHeader>
      <ul className="space-y-1">
        {funnel.map((stage) => (
          <li key={stage.status}>
            <Link href={links.applications({ period, reached: isReachedStage(stage.status) ? stage.status : "" })} className={cn("grid grid-cols-[7.5rem_1fr_4.5rem] items-center gap-3 px-2 py-1.5 text-sm", linkSurface)}
              aria-label={`${stage.count} reached ${STATUS_LABEL[stage.status]}. Open the list`}>
              <span className="truncate text-[var(--color-text-2)]">{STATUS_LABEL[stage.status]}</span>
              <span className="h-5 overflow-hidden rounded-[var(--radius-sm)] bg-[var(--color-surface-3)]">
                <span className="block h-full rounded-[var(--radius-sm)] bg-[var(--color-chart-1)]" style={{ width: `${Math.max(stage.count ? 2 : 0, (stage.count / max) * 100)}%` }} />
              </span>
              <span className="text-right text-mono-sm tabular text-[var(--color-text)]">
                {stage.count}{stage.conversionFromPreviousPct !== null ? <span className="ml-1.5 text-[var(--color-text-3)]">{Math.round(stage.conversionFromPreviousPct)}%</span> : null}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-[var(--color-border)] pt-4">
        <div><dt className="text-caption text-[var(--color-text-3)]">Submitted to interview</dt><dd className="text-h2 tabular text-[var(--color-text)]">{ratioText(ratios.submissionToInterviewPct)}</dd></div>
        <div><dt className="text-caption text-[var(--color-text-3)]">Interview to offer</dt><dd className="text-h2 tabular text-[var(--color-text)]">{ratioText(ratios.interviewToOfferPct)}</dd></div>
        <div><dt className="text-caption text-[var(--color-text-3)]">Applications per offer</dt><dd className="text-h2 tabular text-[var(--color-text)]">{ratioText(ratios.applicationsPerOffer, "")}</dd></div>
      </dl>
    </Card>
  );
}

/** How long the bench has waited: one bar in three bands, each opening those candidates, then the longest waits. */
export function BenchAgingCard({ health, links }: { health: BenchHealth; links: ListLinks }) {
  const bands = [
    { key: "under30" as const, label: "Under 30 days", value: health.aging.under30, fill: "bg-[var(--color-chart-2)]" },
    { key: "30to60" as const, label: "30 to 60 days", value: health.aging.from30to60, fill: "bg-[var(--color-warning-fg)]" },
    { key: "over60" as const, label: "Over 60 days", value: health.aging.over60, fill: "bg-[var(--color-danger-fg)]" },
  ];
  const total = Math.max(1, health.onBench);
  return (
    <Card>
      <CardHeader>
        <div><CardTitle>Bench aging</CardTitle><Hint>How long the candidates on the bench have waited</Hint></div>
        <Tag tone="neutral">{health.onBench} on the bench</Tag>
      </CardHeader>
      <div className="flex h-4 gap-0.5 overflow-hidden rounded-full bg-[var(--color-surface-3)]" aria-hidden>
        {bands.map((band) => (band.value ? <span key={band.key} className={band.fill} style={{ width: `${(band.value / total) * 100}%` }} /> : null))}
      </div>
      <ul className="mt-3 grid grid-cols-3 gap-2 [&>*]:min-w-0">
        {bands.map((band) => (
          <li key={band.key}>
            <Link href={links.candidates({ bench: band.key })} className={cn("block p-2", linkSurface)} aria-label={`${band.value} on the bench ${band.label.toLowerCase()}. Open the list`}>
              <span className="flex items-center gap-1.5 text-caption text-[var(--color-text-3)]"><span aria-hidden className={cn("size-2 rounded-full", band.fill)} />{band.label}</span>
              <span className="text-h2 tabular text-[var(--color-text)]">{band.value}</span>
            </Link>
          </li>
        ))}
      </ul>
      {health.longest.length ? (
        <ul className="mt-3 space-y-0.5 border-t border-[var(--color-border)] pt-3" aria-label="Longest on the bench">
          {health.longest.map(({ candidate, days }) => (
            <li key={candidate.id}>
              <Link href={links.candidate(candidate.id)} className={cn("flex items-center justify-between gap-3 px-2 py-1.5 text-sm", linkSurface)}>
                <span className="truncate text-[var(--color-text)]">{candidate.fullName}<span className="text-[var(--color-text-3)]"> · {candidate.primaryRole ?? "Role not set"}</span></span>
                <span className={cn("shrink-0 tabular", days > 60 ? "text-[var(--color-danger-fg)]" : "text-[var(--color-warning-fg)]")}>{days} days</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

/** Average days for each step, finished in the period, as one strip; the slowest is where applications wait. */
export function SpeedStrip({ speeds, daysToOffer }: { speeds: StageSpeed[]; daysToOffer: number | null }) {
  return (
    <Card>
      <CardHeader>
        <div><CardTitle>Time between stages</CardTitle><Hint>Average days, for the steps finished in this period</Hint></div>
        {daysToOffer !== null ? <Tag tone="blue">{daysToOffer} days to an offer</Tag> : null}
      </CardHeader>
      <ol className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {speeds.map((speed, index) => (
          <li key={speed.label} className={cn("flex items-center gap-2 rounded-[var(--radius-md)] border p-3",
            speed.isSlowest ? "border-[var(--color-warning-fg)] bg-[var(--color-warning-bg)]" : "border-[var(--color-border)] bg-[var(--color-surface-2)]")}>
            <div className="min-w-0 flex-1">
              <p className="truncate text-caption text-[var(--color-text-3)]">{speed.label}</p>
              <p className={cn("text-h2 tabular", speed.isSlowest ? "text-[var(--color-warning-fg)]" : "text-[var(--color-text)]")}>{speed.averageDays === null ? "—" : `${speed.averageDays}d`}</p>
              {speed.isSlowest ? <p className="text-caption text-[var(--color-warning-fg)]">slowest step</p> : null}
            </div>
            {index < speeds.length - 1 ? <ArrowRight size={14} aria-hidden className="hidden shrink-0 text-[var(--color-text-3)] md:block" /> : null}
          </li>
        ))}
      </ol>
    </Card>
  );
}

/** People ranked by what they submitted in the period, as bars. Each opens that person's level of the dashboard. */
export function RankedBars({ title, hint, rows, onSelect }: { title: string; hint: string; rows: { id: string; name: string; value: number; detail: string }[]; onSelect: (id: string) => void }) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <Card>
      <CardHeader><div><CardTitle>{title}</CardTitle><Hint>{hint}</Hint></div></CardHeader>
      {rows.length === 0 ? <p className="text-sm text-[var(--color-text-3)]">Nobody here yet.</p> : (
        <ul className="space-y-1">
          {rows.map((row) => (
            <li key={row.id}>
              <button type="button" onClick={() => onSelect(row.id)} className={cn("grid w-full grid-cols-[minmax(0,8rem)_1fr_auto] items-center gap-3 px-2 py-1.5 text-left text-sm", linkSurface)}>
                <span className="truncate text-[var(--color-text)]">{row.name}</span>
                <span className="h-5 overflow-hidden rounded-[var(--radius-sm)] bg-[var(--color-surface-3)]" aria-hidden>
                  <span className="block h-full rounded-[var(--radius-sm)] bg-[var(--color-chart-1)]" style={{ width: `${Math.max(row.value ? 2 : 0, (row.value / max) * 100)}%` }} />
                </span>
                <span className="whitespace-nowrap text-right text-mono-sm tabular text-[var(--color-text-2)]"><span className="text-[var(--color-text)]">{row.value}</span> · {row.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
