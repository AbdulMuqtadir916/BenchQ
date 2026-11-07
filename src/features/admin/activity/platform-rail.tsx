"use client";

import { useState } from "react";
import { Building2, Search, ShieldX } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { PlatformActivityOverview } from "@/lib/schemas/analytics";
import { Group, Indented, RailFrame, Row } from "@/features/activity/activity-rail";

/** Past this many firms, the list gets a search box. */
const SEARCH_FROM = 6;

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

export type PlatformPick = { kind: "all" } | { kind: "me" } | { kind: "failed" } | { kind: "firm"; firmId: string };

interface PlatformRailProps {
  overview: PlatformActivityOverview | undefined;
  picked: PlatformPick["kind"];
  rangeLabel: string;
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
  onPick: (pick: PlatformPick) => void;
}

/** The people list at the top of the platform: everything, the Super Admin's own, failed sign-ins, then each firm. */
export function PlatformRail({ overview, picked, rangeLabel, isLoading, error, onRetry, onPick }: PlatformRailProps) {
  const [query, setQuery] = useState("");
  const firms = (overview?.firms ?? []).filter((firm) => firm.name.toLowerCase().includes(query.trim().toLowerCase()));
  const firmCount = overview?.firms.length ?? 0;
  return (
    <RailFrame heading="Platform" count={firmCount} back={null} rangeLabel={rangeLabel} isLoading={isLoading} error={error} onRetry={onRetry}>
      {overview ? (
        <>
          <Row name="Whole platform" subtitle={plural(firmCount, "firm")} count={overview.total} icon={<Building2 size={16} />} isSelected={picked === "all"} onClick={() => onPick({ kind: "all" })} />
          <Row name={overview.me.name} avatar={overview.me.name} subtitle="Your actions" count={overview.me.actions} isSelected={picked === "me"} onClick={() => onPick({ kind: "me" })} />
          <Row name="Failed sign-ins" subtitle="Every firm" count={overview.failed} icon={<ShieldX size={16} className="text-[var(--color-danger-fg)]" />} isDanger isSelected={picked === "failed"} onClick={() => onPick({ kind: "failed" })} />
          <Group label="Firms">
            {firmCount > SEARCH_FROM ? (
              <div className="relative mb-1">
                <Search size={14} aria-hidden="true" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-3)]" />
                <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a firm…" aria-label="Find a firm" className="h-8 pl-8" />
              </div>
            ) : null}
            {firms.length ? (
              <Indented>
                {firms.map((firm) => (
                  <Row key={firm.id} name={firm.name} avatar={firm.name} subtitle={plural(firm.managers, "manager")} count={firm.actions} opens isSelected={false} onClick={() => onPick({ kind: "firm", firmId: firm.id })} />
                ))}
              </Indented>
            ) : <p className="px-2 py-3 text-sm text-[var(--color-text-3)]">{query ? `Nobody matches “${query.trim()}”.` : "No firms yet."}</p>}
          </Group>
        </>
      ) : null}
    </RailFrame>
  );
}
