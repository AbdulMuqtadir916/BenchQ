"use client";

import Link from "next/link";
import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Search, Users } from "lucide-react";
import type { Candidate } from "@/lib/schemas/candidate";
import { formatRelative } from "@/lib/format/timezone";
import { EASE_OUT } from "@/lib/motion";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tag, type TagTone } from "@/components/ui/tag";
import { EmptyState } from "@/components/app/empty-state";
import { ErrorState } from "@/components/app/error-state";
import { WorkAuthChip } from "@/components/app/work-auth-chip";
import { CandidateAvatar } from "@/components/app/candidate-avatar";
import { useHref } from "@/lib/routes/use-href";

export interface CandidateCardRow {
  candidate: Candidate;
  bde: string;
  apps: number;
  active: number;
  interviews: number;
  lastActivity: string | null;
}

interface GridProps {
  rows: CandidateCardRow[];
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
  showBde: boolean;
  status: { tone: (c: Candidate) => TagTone; label: (c: Candidate) => string };
  toolbar: React.ReactNode;
}

/** Card view of the bench — one card per candidate, whole card opens the profile. */
export function CandidateCardGrid({ rows, isLoading, error, onRetry, showBde, status, toolbar }: GridProps) {
  const toHref = useHref();
  const reduce = useReducedMotion() ?? false;
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const visible = q ? rows.filter((r) => `${r.candidate.fullName} ${r.candidate.primaryRole ?? ""} ${r.candidate.city ?? ""}`.toLowerCase().includes(q)) : rows;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full flex-1 sm:max-w-72">
          <Search size={14} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-3)]" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search candidates…" aria-label="Search candidates" className="pl-9" />
        </div>
        <span className="ml-auto text-mono-sm text-[var(--color-text-3)]" aria-live="polite">{visible.length} candidates</span>
        {toolbar}
      </div>

      {error ? (
        <ErrorState error={error} onRetry={onRetry} />
      ) : isLoading ? (
        <div role="status" aria-label="Loading candidates" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => <div key={i} className="bq-card space-y-3 p-4"><div className="flex gap-3"><Skeleton className="h-11 w-11" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-32" /><Skeleton className="h-3 w-24" /></div></div><Skeleton className="h-10 w-full" /></div>)}
        </div>
      ) : visible.length === 0 ? (
        rows.length ? (
          <EmptyState variant="filtered" icon={Search} title="No candidates match" description="Try a different name, role or city." />
        ) : (
          <EmptyState icon={Users} title="No candidates yet" description="Add a candidate to start building their bench profile." />
        )
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((r, i) => {
            const c = r.candidate;
            return (
              <motion.li key={c.id} className="flex" initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, delay: Math.min(i, 9) * 0.03, ease: EASE_OUT }}>
                <Link href={toHref("candidates.detail", { id: c.id })} className="bq-card flex w-full flex-col gap-3 p-4 transition-shadow hover:shadow-[var(--shadow-md)]">
                  <div className="flex items-start gap-3">
                    <CandidateAvatar name={c.fullName} colorKey={c.id} />
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-h3 text-[var(--color-text)]">{c.fullName}</h3>
                      <p className="truncate text-sm text-[var(--color-text-3)]">{[c.primaryRole, c.city].filter(Boolean).join(" · ")}</p>
                    </div>
                    <Tag tone={status.tone(c)} className="shrink-0">{status.label(c)}</Tag>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <WorkAuthChip workAuth={c.workAuth} expiry={c.workAuthExpiry} />
                    {c.rateTarget ? <Tag>${c.rateTarget}/hr</Tag> : null}
                    {c.yearsExperience ? <Tag>{c.yearsExperience} yrs</Tag> : null}
                  </div>
                  <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-border)] text-center">
                    {([["Apps", r.apps], ["Active", r.active], ["Interviews", r.interviews]] as const).map(([label, value]) => (
                      <div key={label} className="bg-[var(--color-surface)] py-2">
                        <dd className="tabular text-h3 text-[var(--color-text)]">{value}</dd>
                        <dt className="text-caption text-[var(--color-text-3)]">{label}</dt>
                      </div>
                    ))}
                  </dl>
                  <div className="mt-auto flex items-center justify-between text-caption text-[var(--color-text-3)]">
                    <span>{r.lastActivity ? `Active ${formatRelative(r.lastActivity)}` : "No activity yet"}</span>
                    {showBde ? <span className="truncate">{r.bde}</span> : null}
                  </div>
                </Link>
              </motion.li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
