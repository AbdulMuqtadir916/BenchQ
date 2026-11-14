"use client";

import { useState, type ReactNode } from "react";
import { ArrowLeft, Building2, ChevronRight, Search, Users } from "lucide-react";
import { CandidateAvatar } from "@/components/app/candidate-avatar";
import { ErrorState } from "@/components/app/error-state";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/cn";
import type { LedgerPerson } from "@/lib/schemas/analytics";
import { managerRowLabel, ownerRowLabel, type Rail, type Selection, type Viewer } from "./rail";

/** Past this many people, the list gets a search box. */
const SEARCH_FROM = 6;

/** Rows that sit under the person above them: managers under the owner, BDEs under a manager. */
export const Indented = ({ children }: { children: ReactNode }) => (
  <div className="ml-5 border-l border-[var(--color-border-strong)] pl-2">{children}</div>
);

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

export function Row({ name, subtitle, count, avatar, icon, tag, isSelected, opens, isDanger, onClick }: {
  name: string;
  subtitle: string;
  count: number;
  avatar?: string;
  icon?: ReactNode;
  tag?: string;
  isSelected: boolean;
  opens?: boolean;
  isDanger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={isSelected ? "true" : undefined}
      onClick={onClick}
      className={cn("flex w-full items-center gap-2 rounded-[var(--radius-md)] px-2 py-2 text-left hover:bg-[var(--color-bg-subtle)]", isSelected && "bg-[var(--color-primary-subtle)] hover:bg-[var(--color-primary-subtle)]")}
    >
      {avatar ? <CandidateAvatar name={avatar} colorKey={avatar} size="sm" /> : <span aria-hidden="true" className="inline-flex h-7 w-7 shrink-0 items-center justify-center text-[var(--color-text-3)]">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className={cn("truncate text-sm", isDanger ? "text-[var(--color-danger-fg)]" : isSelected ? "font-medium text-[var(--color-primary-subtle-fg)]" : "text-[var(--color-text)]", isSelected && "font-medium")}>{name}</span>
          {tag ? <Tag tone="violet">{tag}</Tag> : null}
        </span>
        <span className="block truncate text-caption text-[var(--color-text-3)]">{subtitle}</span>
      </span>
      <span className="shrink-0 text-right">
        <span className={cn("block text-mono-sm", isDanger ? "text-[var(--color-danger-fg)]" : "text-[var(--color-text-2)]")}>{count}</span>
        <span className="block text-caption text-[var(--color-text-3)]">{count === 1 ? "action" : "actions"}</span>
      </span>
      {opens ? <ChevronRight size={14} aria-hidden="true" className="shrink-0 text-[var(--color-text-3)]" /> : null}
    </button>
  );
}

export const Group = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="mt-2">
    <p className="px-2 py-1 text-label text-[var(--color-text-3)]">{label}</p>
    {children}
  </div>
);

interface RailFrameProps {
  heading: string;
  count: number | null;
  back: { label: string; onClick: () => void } | null;
  rangeLabel: string;
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
  children: ReactNode;
}

/** The panel around a people list: its heading, the way back, and the loading and error states. */
export function RailFrame({ heading, count, back, rangeLabel, isLoading, error, onRetry, children }: RailFrameProps) {
  return (
    <aside aria-label="People" className="min-w-0 overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2 max-lg:max-h-72 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-8rem)] lg:self-start">
      <div className="border-b border-[var(--color-border)] px-2 pb-2">
        {back ? (
          <button type="button" onClick={back.onClick} className="mb-1 inline-flex items-center gap-1 text-sm text-[var(--color-text-3)] hover:text-[var(--color-text)]">
            <ArrowLeft size={14} aria-hidden="true" />
            {back.label}
          </button>
        ) : null}
        <div className="flex items-center justify-between gap-2">
          <h2 className="truncate text-sm font-medium text-[var(--color-text)]">{heading}</h2>
          {count !== null ? <span className="text-mono-sm text-[var(--color-text-3)]">{count}</span> : null}
        </div>
        <p className="text-caption text-[var(--color-text-3)]">Logged actions · {rangeLabel}</p>
      </div>
      <div className="pt-2">
        {isLoading ? (
          <div className="space-y-2 p-2" aria-label="Loading people">
            {[0, 1, 2].map((index) => <Skeleton key={index} className="h-10 w-full" />)}
          </div>
        ) : error ? (
          <ErrorState error={error} onRetry={onRetry} />
        ) : children}
      </div>
    </aside>
  );
}

interface ActivityRailProps {
  rail: Rail | null;
  viewer: Viewer;
  selection: Selection;
  back: { label: string; to: Selection } | null;
  rangeLabel: string;
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
  onSelect: (selection: Selection) => void;
}

export function ActivityRail({ rail, viewer, selection, back, rangeLabel, isLoading, error, onRetry, onSelect }: ActivityRailProps) {
  const [query, setQuery] = useState("");
  const person = (row: LedgerPerson, subtitle: string, tag?: string) => (
    <Row key={row.userId} name={row.name} avatar={row.name} subtitle={subtitle} count={row.actions} tag={tag} isSelected={selection.person === row.userId} onClick={() => onSelect({ person: row.userId })} />
  );
  const matches = (name: string) => name.toLowerCase().includes(query.trim().toLowerCase());
  const searchBox = (placeholder: string) => (
    <div className="relative mb-1">
      <Search size={14} aria-hidden="true" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-3)]" />
      <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={placeholder} aria-label={placeholder} className="h-8 pl-8" />
    </div>
  );
  const noMatch = <p className="px-2 py-3 text-sm text-[var(--color-text-3)]">Nobody matches “{query.trim()}”.</p>;

  function body() {
    if (!rail) return null;
    if (rail.level === "own") {
      return rail.me ? person(rail.me, "Your actions") : null;
    }
    if (rail.level === "firm") {
      const managers = rail.managers.filter((row) => matches(row.person.name));
      const unassigned = rail.unassigned.filter((row) => matches(row.name));
      return (
        <>
          {rail.managers.length > SEARCH_FROM ? searchBox("Find a manager…") : null}
          <Row name="Whole firm" subtitle={plural(rail.managers.length, "manager")} count={rail.total} icon={<Building2 size={16} />} isSelected={!selection.person && !selection.team} onClick={() => onSelect({})} />
          {rail.owner ? person(rail.owner, ownerRowLabel(rail.owner, viewer)) : null}
          {managers.length ? (
            <Indented>
              {managers.map((row) => (
                <Row key={row.person.userId} name={row.person.name} avatar={row.person.name} subtitle={plural(row.bdes, "BDE")} count={row.actions} opens isSelected={false} onClick={() => onSelect({ team: row.person.userId })} />
              ))}
            </Indented>
          ) : null}
          {query && managers.length === 0 ? noMatch : null}
          {rail.you ? <Group label="You">{person(rail.you, "Your actions")}</Group> : null}
          {unassigned.length ? <Group label="Unassigned BDEs">{unassigned.map((row) => person(row, "No manager yet"))}</Group> : null}
          {rail.former.length ? <Group label="Former members">{rail.former.map((row) => person(row, "No longer here"))}</Group> : null}
        </>
      );
    }
    const bdes = rail.bdes.filter((row) => matches(row.name));
    return (
      <>
        <Row name="Everyone" subtitle={plural(rail.bdes.length + 1, "person").replace("persons", "people")} count={rail.actions} icon={<Users size={16} />} isSelected={!selection.person} onClick={() => onSelect(rail.isOwnTeam ? {} : { team: rail.manager.userId })} />
        <Group label="Manager">{person(rail.manager, managerRowLabel(rail.manager, viewer), "manager")}</Group>
        <Group label={`BDEs · ${rail.bdes.length}`}>
          {rail.bdes.length > SEARCH_FROM ? searchBox("Find a BDE…") : null}
          {rail.bdes.length === 0 ? <p className="px-2 py-2 text-sm text-[var(--color-text-3)]">No BDEs report to {rail.manager.name} yet.</p> : null}
          {bdes.length ? <Indented>{bdes.map((row) => person(row, "BDE"))}</Indented> : null}
          {query && bdes.length === 0 ? noMatch : null}
        </Group>
        {rail.former.length ? <Group label="Former members">{rail.former.map((row) => person(row, "Left this team"))}</Group> : null}
      </>
    );
  }

  const heading = rail?.level === "team" ? (rail.isOwnTeam ? "Your team" : `${rail.manager.name}'s team`) : rail?.level === "firm" ? "Managers" : "You";
  const headingCount = rail?.level === "team" ? rail.bdes.length + 1 : rail?.level === "firm" ? rail.managers.length : null;

  return (
    <RailFrame heading={heading} count={headingCount} back={back ? { label: back.label, onClick: () => onSelect(back.to) } : null} rangeLabel={rangeLabel} isLoading={isLoading} error={error} onRetry={onRetry}>
      {body()}
    </RailFrame>
  );
}
